/**
 * Qloo Taste AI client (hackathon environment).
 *
 *   base URL   https://hackathon.api.qloo.com     (hackathon keys only work here)
 *   auth       X-Api-Key header
 *   GET /search?query=…&types=urn:entity:video_game    → entity ids
 *   GET /v2/insights?filter.type=…&signal.interests.entities=…   → recommendations with affinity
 *   GET /v2/tags?filter.query=…                                   → tag ids for filters
 *   GET /v2/insights?filter.type=urn:tag&signal.interests.entities=… → taste analysis (tag distribution)
 *
 * Without QLOO_API_KEY the client answers from `fixture.ts` so the app flow can be built and demoed
 * before the key arrives. Responses are edge-cached (private cache is allowed by the hackathon rules;
 * Qloo data is never written to the repo).
 */
import { Env, HttpError } from "./env";
import * as fixture from "./fixture";

export type EntityType = "video_game" | "movie" | "tv_show" | "artist" | "book";
// The hackathon guide says `urn:entity:video_game`; the OpenAPI spec says `urn:entity:videogame`.
// Keep both: send the guide's form, and recognise either when parsing. Verify once the key arrives.
export const VIDEO_GAME_URN_ALT = "urn:entity:videogame";
export const ENTITY_URN: Record<EntityType, string> = {
  video_game: "urn:entity:video_game",
  movie: "urn:entity:movie",
  tv_show: "urn:entity:tv_show",
  artist: "urn:entity:artist",
  book: "urn:entity:book",
};

export interface QlooTag { id: string; name: string; type?: string }
export interface QlooEntity {
  entity_id: string;
  name: string;
  type: EntityType;
  affinity?: number;      // 0–1 from query.affinity when returned by insights
  popularity?: number;
  year?: number;
  tags: QlooTag[];
  description?: string;
}
export interface TasteTag extends QlooTag { affinity: number }

const CACHE_TTL = 6 * 3600;

async function get(env: Env, path: string, params: Record<string, string | number | undefined>): Promise<any> {
  const url = new URL(path, env.QLOO_BASE_URL);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const cache = caches.default;
  const cacheKey = new Request(`https://qloo-cache.invalid${url.pathname}?${url.searchParams}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  const res = await fetch(url, { headers: { "X-Api-Key": env.QLOO_API_KEY ?? "", Accept: "application/json" } });
  const body = await res.text();
  if (!res.ok) throw new HttpError(502, `qloo ${path} -> ${res.status}`, body.slice(0, 500));
  const data = JSON.parse(body);
  await cache.put(cacheKey, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` } }));
  return data;
}

export function hasKey(env: Env): boolean {
  return !!env.QLOO_API_KEY;
}

function normalizeTags(raw: any): QlooTag[] {
  const tags = Array.isArray(raw) ? raw : [];
  return tags
    .map((t: any) => ({ id: String(t.id ?? t.tag_id ?? ""), name: String(t.name ?? ""), type: t.type ? String(t.type) : undefined }))
    .filter((t: QlooTag) => t.id && t.name)
    .slice(0, 12);
}

function typeOf(raw: any, fallback: EntityType): EntityType {
  const urn: string = raw?.subtype ?? raw?.type ?? (Array.isArray(raw?.types) ? raw.types[0] : "") ?? "";
  if (urn === VIDEO_GAME_URN_ALT || urn.startsWith(VIDEO_GAME_URN_ALT)) return "video_game";
  for (const [k, v] of Object.entries(ENTITY_URN)) if (urn === v || urn.startsWith(v)) return k as EntityType;
  return fallback;
}

function yearOf(raw: any): number | undefined {
  const d: string | undefined = raw?.properties?.release_date ?? raw?.properties?.release_year ?? raw?.properties?.publication_date;
  if (!d) return undefined;
  const y = parseInt(String(d).slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

function normalizeEntity(raw: any, fallback: EntityType): QlooEntity {
  return {
    entity_id: String(raw.entity_id ?? raw.id ?? ""),
    name: String(raw.name ?? ""),
    type: typeOf(raw, fallback),
    affinity: typeof raw?.query?.affinity === "number" ? raw.query.affinity : undefined,
    popularity: typeof raw.popularity === "number" ? raw.popularity : undefined,
    year: yearOf(raw),
    tags: normalizeTags(raw.tags),
    description: raw?.properties?.description ? String(raw.properties.description).slice(0, 240) : undefined,
  };
}

/** Resolve a title to a Qloo entity. Exact (case-insensitive) name match wins, else the most popular hit. */
export async function resolve(env: Env, name: string, type: EntityType = "video_game"): Promise<QlooEntity | null> {
  if (!hasKey(env)) return fixture.resolve(name, type);
  const data = await get(env, "/search", { query: name, types: ENTITY_URN[type], take: 5 });
  const results: any[] = data?.results ?? data?.entities ?? [];
  if (!results.length) return null;
  const needle = name.trim().toLowerCase();
  const exact = results.find((r) => String(r.name ?? "").toLowerCase() === needle);
  const best = exact ?? [...results].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];
  return normalizeEntity(best, type);
}

export interface RecommendInput {
  seedIds: string[];
  type: EntityType;
  tagIds?: string[];
  minYear?: number;
  maxYear?: number;
  take?: number;
}

/** Recommendations grounded in the seed entities. Works across domains (games → movies, etc.). */
export async function recommend(env: Env, input: RecommendInput): Promise<QlooEntity[]> {
  if (!hasKey(env)) return fixture.recommend(input);
  const data = await get(env, "/v2/insights", {
    "filter.type": ENTITY_URN[input.type],
    "signal.interests.entities": input.seedIds.length ? input.seedIds.join(",") : undefined,
    "filter.tags": input.tagIds?.length ? input.tagIds.join(",") : undefined,
    "filter.release_year.min": input.minYear,
    "filter.release_year.max": input.maxYear,   // movies/TV only per the spec; ignored for games
    "feature.explainability": "true",
    take: Math.min(50, input.take ?? 10),
  });
  const entities: any[] = data?.results?.entities ?? data?.entities ?? [];
  return entities.map((e) => normalizeEntity(e, input.type)).filter((e) => e.entity_id && e.name);
}

/** Tag lookup for natural-language constraints ("cozy", "roguelike", "short"). */
export async function tags(env: Env, query: string, take = 8): Promise<QlooTag[]> {
  if (!hasKey(env)) return fixture.tags(query);
  const data = await get(env, "/v2/tags", { "filter.query": query, take });
  const results: any[] = data?.results?.tags ?? data?.results ?? [];
  return normalizeTags(results);
}

/** Taste analysis: which tags characterise the seed set, with affinity. */
export async function taste(env: Env, seedIds: string[], take = 12): Promise<TasteTag[]> {
  if (!hasKey(env)) return fixture.taste(seedIds);
  const data = await get(env, "/v2/insights", {
    "filter.type": "urn:tag",
    "signal.interests.entities": seedIds.join(","),
    take,
  });
  const results: any[] = data?.results?.tags ?? data?.results?.entities ?? [];
  return results
    .map((t) => ({
      id: String(t.id ?? t.tag_id ?? t.entity_id ?? ""),
      name: String(t.name ?? ""),
      type: t.type ? String(t.type) : undefined,
      affinity: typeof t?.query?.affinity === "number" ? t.query.affinity : typeof t.affinity === "number" ? t.affinity : 0,
    }))
    .filter((t) => t.id && t.name);
}
