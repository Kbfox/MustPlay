/**
 * IGDB proxy. IGDB authenticates with a Twitch client secret, which can't ship inside an iOS app.
 * The Worker holds the secret, mints/caches the app token, and forwards Apicalypse queries.
 * Identical queries are edge-cached so the app stays well under IGDB's 4 req/s.
 *
 *   POST /v4/games        body: Apicalypse query (text/plain)
 *
 * `lookupGame` is the same pipeline used internally by the Scout agent to attach covers and
 * IGDB ids to games that Qloo recommends.
 */
import { Env, text } from "./env";

const ALLOWED_ENDPOINTS = new Set(["games", "covers", "platforms", "search", "release_dates"]);
const MAX_BODY_BYTES = 2000;
const CACHE_TTL_SECONDS = 3600;

let tokenCache: { token: string | null; expiresAt: number } = { token: null, expiresAt: 0 };

async function getAppToken(env: Env): Promise<string> {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: "POST" });
  if (!res.ok) throw new Error(`Twitch token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function queryIGDB(endpoint: string, body: string, token: string, env: Env): Promise<Response> {
  return fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "text/plain",
    },
    body,
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Runs an Apicalypse query with token refresh and edge caching. Returns the raw JSON text. */
async function runQuery(env: Env, ctx: ExecutionContext, endpoint: string, body: string): Promise<{ status: number; payload: string }> {
  const cache = caches.default;
  const cacheKey = new Request(`https://igdb-cache.invalid/${endpoint}/${await sha256Hex(body)}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return { status: 200, payload: await cached.text() };

  let token = await getAppToken(env);
  let upstream = await queryIGDB(endpoint, body, token, env);
  if (upstream.status === 401) {
    tokenCache = { token: null, expiresAt: 0 };
    token = await getAppToken(env);
    upstream = await queryIGDB(endpoint, body, token, env);
  }
  const payload = await upstream.text();
  if (upstream.ok) {
    const response = new Response(payload, {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
    });
    ctx.waitUntil(cache.put(cacheKey, response));
  }
  return { status: upstream.status, payload };
}

export async function handleProxy(request: Request, env: Env, ctx: ExecutionContext, endpoint: string): Promise<Response> {
  if (request.method !== "POST") return text(405, "Method not allowed");
  if (!ALLOWED_ENDPOINTS.has(endpoint)) return text(403, "Endpoint not allowed");
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return text(500, "Worker secrets not configured");

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return text(413, "Query too long");

  try {
    const { status, payload } = await runQuery(env, ctx, endpoint, body);
    return new Response(payload, {
      status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    return text(502, `Upstream auth failed: ${(error as Error).message}`);
  }
}

// MARK: - Internal lookup for the agent

export interface IGDBGameLite {
  igdb_id: number;
  name: string;
  cover_image_id?: string;
  year?: number;
  platforms: string[];
  summary?: string;
  rating_count: number;
}

interface IGDBRaw {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
  platforms?: { abbreviation?: string; name?: string }[];
  summary?: string;
  total_rating_count?: number;
}

const FIELDS = "fields id,name,cover.image_id,first_release_date,platforms.abbreviation,platforms.name,summary,total_rating_count;";

/** Same ranking the app uses: exact title first, then most-rated. */
export async function lookupGame(env: Env, ctx: ExecutionContext, name: string): Promise<IGDBGameLite | null> {
  const escaped = name.replace(/[\\"]/g, "").slice(0, 80);
  const body = `search "${escaped}";\n${FIELDS}\nwhere version_parent = null & parent_game = null;\nlimit 10;`;
  const { status, payload } = await runQuery(env, ctx, "games", body);
  if (status !== 200) return null;
  const raw = JSON.parse(payload) as IGDBRaw[];
  const needle = escaped.trim().toLowerCase();
  const ranked = raw
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const ae = a.g.name.toLowerCase() === needle ? 1 : 0;
      const be = b.g.name.toLowerCase() === needle ? 1 : 0;
      if (ae !== be) return be - ae;
      const ac = a.g.total_rating_count ?? 0, bc = b.g.total_rating_count ?? 0;
      if (ac !== bc) return bc - ac;
      return a.i - b.i;
    });
  const best = ranked[0]?.g;
  if (!best) return null;
  const seen = new Set<string>();
  const platforms = (best.platforms ?? [])
    .map((p) => p.abbreviation ?? p.name)
    .filter((p): p is string => !!p && !seen.has(p) && (seen.add(p), true));
  return {
    igdb_id: best.id,
    name: best.name,
    cover_image_id: best.cover?.image_id,
    year: best.first_release_date ? new Date(best.first_release_date * 1000).getUTCFullYear() : undefined,
    platforms,
    summary: best.summary?.slice(0, 300),
    rating_count: best.total_rating_count ?? 0,
  };
}
