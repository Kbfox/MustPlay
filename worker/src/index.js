/**
 * MustPlay IGDB proxy (Cloudflare Worker).
 *
 * Why this exists: IGDB authenticates with a Twitch client secret, which can't ship inside an
 * iOS app. The Worker holds the secret, mints/caches the app token, and forwards Apicalypse
 * queries. Identical queries are edge-cached so the app stays well under IGDB's 4 req/s.
 *
 *   POST /v4/games        body: Apicalypse query (text/plain)
 *   GET  /health
 *
 * Secrets: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, optional APP_KEY (checked against X-App-Key).
 */

const ALLOWED_ENDPOINTS = new Set(["games", "covers", "platforms", "search", "release_dates"]);
const MAX_BODY_BYTES = 2000;
const CACHE_TTL_SECONDS = 3600;

let tokenCache = { token: null, expiresAt: 0 };

async function getAppToken(env) {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Twitch token request failed: ${res.status}`);
  }
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

function queryIGDB(endpoint, body, token, env) {
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

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function withCORS(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-App-Key");
  return new Response(response.body, { status: response.status, headers });
}

function textResponse(status, message) {
  return withCORS(new Response(message, { status, headers: { "Content-Type": "text/plain" } }));
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return withCORS(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return textResponse(200, "ok");
    }
    if (!url.pathname.startsWith("/v4/")) {
      return textResponse(404, "Not found");
    }
    if (request.method !== "POST") {
      return textResponse(405, "Method not allowed");
    }
    if (env.APP_KEY && request.headers.get("X-App-Key") !== env.APP_KEY) {
      return textResponse(401, "Unauthorized");
    }
    if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
      return textResponse(500, "Worker secrets not configured");
    }

    const endpoint = url.pathname.slice("/v4/".length);
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return textResponse(403, "Endpoint not allowed");
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return textResponse(413, "Query too long");
    }

    // POST bodies aren't cacheable, so key the edge cache on a hash of the query.
    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/cache/${endpoint}/${await sha256Hex(body)}`, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      return withCORS(cached);
    }

    let token;
    try {
      token = await getAppToken(env);
    } catch (error) {
      return textResponse(502, `Upstream auth failed: ${error.message}`);
    }

    let upstream = await queryIGDB(endpoint, body, token, env);
    if (upstream.status === 401) {
      tokenCache = { token: null, expiresAt: 0 };
      token = await getAppToken(env);
      upstream = await queryIGDB(endpoint, body, token, env);
    }

    const payload = await upstream.text();
    const response = new Response(payload, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    if (upstream.ok) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return withCORS(response);
  },
};
