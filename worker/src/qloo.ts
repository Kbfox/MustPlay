/**
 * Qloo Taste AI client (hackathon environment). Shapes below were verified against the live API
 * on 2026-10-13; see docs/qloo-api-notes.md for the probe log.
 *
 *   base URL   https://hackathon.api.qloo.com     (hackathon keys only work here)
 *   auth       X-Api-Key header
 *   GET /search?query=…&types=urn:entity:videogame     → { results: [entity] }   (note: "videogame", no underscore)
 *   GET /v2/insights?filter.type=…&signal.interests.entities=…
 *                                                       → { results: { entities: [entity + query.affinity] } }
 *   GET /v2/insights?filter.type=urn:tag&signal.interests.entities=…&filter.parents.types=urn:entity:videogame
 *                                                       → { results: { tags: [{ tag_id, name, subtype, query.affinity }] } }
 *   GET /v2/tags?filter.query=…                          → { results: { tags: [{ id, name, type }] } }
 *
 * Game entities carry tags of these types: category:qloo, genre:qloo, gameplay_type:qloo, audience:qloo,
 * emotional_tone:qloo, art_style:qloo, skill_level:qloo, platform:qloo. `filter.tags` works with those ids
 * (e.g. urn:tag:category:qloo:cozy); genre:media ids match nothing for games. `filter.release_year.*`
 * is ignored for games, so years are filtered locally from properties.release_date.
 *
 * Without QLOO_API_KEY the client answers from `fixture.ts` so the app can be built and demoed first.
 * Responses are edge-cached (private caching is allowed by the hackathon rules; nothing is committed).
 */
import { Env, HttpError } from "./env";
import * as fixture from "./fixture";

export type EntityType = "video_game" | "movie" | "tv_show" | "artist" | "book";
export const ENTITY_URN: Record<EntityType, string> = {
  video_game: "urn:entity:videogame",
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
  image_url?: string;     // Qloo-hosted artwork (games, films, albums)
  platforms?: string[];   // properties.platforms for games
  /** Explainability: which seed entities drove this result (top 3, scores sum to ~1 across seeds). */
  because?: { entity_id: string; score: number }[];
}
/** A seed with a relative weight for POST /v2/insights (weights must be objects with an `id`). */
export interface WeightedSeed { id: string; weight: number }
export interface TasteTag extends QlooTag { affinity: number }

/** Tag types that describe how a game plays and feels; used for taste analysis and constraint lookups. */
const GAME_TAG_TYPES = [
  "urn:tag:category:qloo",
  "urn:tag:gameplay_type:qloo",
  "urn:tag:genre:qloo",
  "urn:tag:emotional_tone:qloo",
  "urn:tag:audience:qloo",
  "urn:tag:art_style:qloo",
  "urn:tag:skill_level:qloo",
];

const CACHE_TTL_MS = 6 * 3600 * 1000;
const CACHE_MAX = 600;

// In-isolate memo instead of the Cache API: every Cache API call counts against the 50-subrequest
// budget of a Worker invocation, and one agent turn can make 20+ Qloo lookups.
const memo = new Map<string, { at: number; data: any }>();

async function get(env: Env, path: string, params: Record<string, string | number | undefined>): Promise<any> {
  const url = new URL(path, env.QLOO_BASE_URL);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const cacheKey = url.toString();
  const hit = memo.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const res = await fetch(url, { headers: { "X-Api-Key": env.QLOO_API_KEY ?? "", Accept: "application/json" } });
  const body = await res.text();
  if (!res.ok) throw new HttpError(502, `qloo ${path} -> ${res.status}`, body.slice(0, 500));
  const data = JSON.parse(body);
  if (memo.size >= CACHE_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(cacheKey, { at: Date.now(), data });
  return data;
}

/** POST variant for bodies GET can't express (weighted seeds). Same memo, keyed on path + body. */
async function post(env: Env, path: string, body: Record<string, unknown>): Promise<any> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== "") clean[k] = v;
  const json = JSON.stringify(clean);
  const cacheKey = `POST ${path} ${json}`;
  const hit = memo.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const res = await fetch(new URL(path, env.QLOO_BASE_URL), {
    method: "POST",
    headers: { "X-Api-Key": env.QLOO_API_KEY ?? "", Accept: "application/json", "Content-Type": "application/json" },
    body: json,
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `qloo POST ${path} -> ${res.status}`, text.slice(0, 500));
  const data = JSON.parse(text);
  if (memo.size >= CACHE_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(cacheKey, { at: Date.now(), data });
  return data;
}

export function hasKey(env: Env): boolean {
  return !!env.QLOO_API_KEY;
}

/** Lower-case, strip diacritics and punctuation, collapse spaces: "God of War Ragnarök" ≈ "God of War: Ragnarok". */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slug(text: string): string {
  return normalizeName(text).replace(/\s+/g, "_");
}

function normalizeTags(raw: any): QlooTag[] {
  const tags = Array.isArray(raw) ? raw : [];
  return tags
    .map((t: any) => ({ id: String(t.id ?? t.tag_id ?? ""), name: String(t.name ?? ""), type: t.type ? String(t.type) : t.subtype ? String(t.subtype) : undefined }))
    .filter((t: QlooTag) => t.id && t.name);
}

/** Tags worth showing to a player: genre / mood / style types, not plot keywords or platform metadata. */
const DISPLAY_TAG_TYPES = [":category:", ":genre:", ":subgenre:", ":gameplay_type:", ":emotional_tone:", ":audience:", ":art_style:", ":skill_level:", ":style:", ":theme:", ":mood:", ":aesthetic_property:", ":characteristic:"];
function displayTags(tags: QlooTag[]): QlooTag[] {
  const kept = tags.filter((t) => DISPLAY_TAG_TYPES.some((k) => t.id.includes(k)));
  return kept.length ? kept : tags.slice(0, 6);
}

function typeOf(raw: any, fallback: EntityType): EntityType {
  const urn: string = raw?.subtype ?? (Array.isArray(raw?.types) ? raw.types[0] : raw?.type) ?? "";
  for (const [k, v] of Object.entries(ENTITY_URN)) if (urn === v || urn.startsWith(v)) return k as EntityType;
  return fallback;
}

function yearOf(raw: any): number | undefined {
  const p = raw?.properties ?? {};
  const d = p.release_year ?? p.release_date ?? p.publication_year ?? p.publication_date;
  if (d === undefined || d === null) return undefined;
  const y = parseInt(String(d).slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

function becauseOf(raw: any): QlooEntity["because"] {
  const list = raw?.query?.explainability?.["signal.interests.entities"];
  if (!Array.isArray(list)) return undefined;
  const out = list
    .map((x: any) => ({ entity_id: String(x?.entity_id ?? x?.id ?? ""), score: typeof x?.score === "number" ? x.score : NaN }))
    .filter((x) => x.entity_id && Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => ({ entity_id: x.entity_id, score: Number(x.score.toFixed(2)) }));
  return out.length ? out : undefined;
}

function normalizeEntity(raw: any, fallback: EntityType): QlooEntity {
  const p = raw?.properties ?? {};
  return {
    entity_id: String(raw.entity_id ?? raw.id ?? ""),
    name: String(raw.name ?? ""),
    type: typeOf(raw, fallback),
    affinity: typeof raw?.query?.affinity === "number" ? Number(raw.query.affinity.toFixed(3)) : undefined,
    popularity: typeof raw.popularity === "number" ? raw.popularity : undefined,
    year: yearOf(raw),
    tags: displayTags(normalizeTags(raw.tags)),
    description: p.description ? String(p.description).slice(0, 240) : undefined,
    image_url: p.image?.url ? String(p.image.url) : undefined,
    platforms: Array.isArray(p.platforms) ? p.platforms.map(String) : undefined,
    because: becauseOf(raw),
  };
}

/** Resolve a title to a Qloo entity. Normalised exact name match wins, else the most popular hit. */
export async function resolve(env: Env, name: string, type: EntityType = "video_game"): Promise<QlooEntity | null> {
  if (!hasKey(env)) return fixture.resolve(name, type);
  const data = await get(env, "/search", { query: name, types: ENTITY_URN[type], take: 5 });
  const results: any[] = data?.results ?? [];
  if (!results.length) return null;
  const needle = normalizeName(name);
  const exact = results.find((r) => normalizeName(String(r.name ?? "")) === needle);
  const best = exact ?? [...results].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];
  return normalizeEntity(best, type);
}

export interface RecommendInput {
  seedIds: string[];      // unweighted fallback (GET)
  seeds?: WeightedSeed[]; // when given, POST with per-seed weights
  excludeIds?: string[];  // entity ids never to return (the player's library)
  type: EntityType;
  tagIds?: string[];
  platform?: string;      // free text, matched against properties.platforms ("Switch", "PS5", "PC")
  minYear?: number;
  maxYear?: number;
  take?: number;
}

export interface RecommendResult {
  items: QlooEntity[];
  /** How the tag constraint was applied, so the agent can say so honestly. */
  tagMode: "filter" | "signal" | "dropped" | "none";
}

const PLATFORM_ALIASES: Record<string, string[]> = {
  switch: ["nintendo switch"],
  "switch 2": ["nintendo switch 2"],
  pc: ["pc", "windows", "mac", "linux"],
  mac: ["mac"],
  ps5: ["playstation 5"],
  ps4: ["playstation 4"],
  playstation: ["playstation"],
  xbox: ["xbox"],
  "series x": ["xbox series"],
  ios: ["ios", "iphone", "ipad"],
  iphone: ["ios", "iphone"],
  android: ["android"],
  "steam deck": ["pc"],
};

function platformMatches(entity: QlooEntity, platform?: string): boolean {
  if (!platform) return true;
  if (!entity.platforms?.length) return true; // unknown: don't drop
  const want = PLATFORM_ALIASES[platform.trim().toLowerCase()] ?? [platform.trim().toLowerCase()];
  const have = entity.platforms.map((p) => p.toLowerCase());
  return want.some((w) => have.some((h) => h.includes(w)));
}

/** Recommendations grounded in the seed entities. Works across domains (games → movies, etc.). */
export async function recommend(env: Env, input: RecommendInput): Promise<RecommendResult> {
  if (!hasKey(env)) return { items: fixture.recommend(input), tagMode: input.tagIds?.length ? "filter" : "none" };

  const seeds = (input.seeds ?? []).filter((s) => s && s.id);
  const exclude = (input.excludeIds ?? []).filter(Boolean);
  const take = Math.min(50, Math.max(20, (input.take ?? 10) * 3)); // over-fetch: platform/year filtered locally
  const hasSeeds = seeds.length > 0 || input.seedIds.length > 0;
  const base: Record<string, string | number | undefined> = {
    "filter.type": ENTITY_URN[input.type],
    "signal.interests.entities": input.seedIds.length ? input.seedIds.join(",") : undefined,
    "filter.exclude.entities": exclude.length ? exclude.join(",") : undefined,
    "feature.explainability": "true",
    take,
  };
  // Weighted seeds go over POST; the GET form can't carry weights.
  const insights = (extra: Record<string, string>): Promise<any> =>
    seeds.length
      ? post(env, "/v2/insights", {
          "filter.type": ENTITY_URN[input.type],
          "signal.interests.entities": seeds.map((s) => ({ id: s.id, weight: s.weight })),
          "filter.exclude.entities": exclude.length ? exclude.join(",") : undefined,
          "feature.explainability": true,
          take,
          ...extra,
        })
      : get(env, "/v2/insights", { ...base, ...extra });
  const parse = (data: any): QlooEntity[] =>
    ((data?.results?.entities ?? []) as any[]).map((e) => normalizeEntity(e, input.type)).filter((e) => e.entity_id && e.name);

  let items: QlooEntity[] = [];
  let tagMode: RecommendResult["tagMode"] = "none";
  const tagIds = (input.tagIds ?? []).filter(Boolean);
  if (tagIds.length) {
    items = parse(await insights({ "filter.tags": tagIds.join(",") }));
    tagMode = "filter";
    if (!items.length) {
      // Hard filter matched nothing (tag may not apply to this domain): bias instead of filter.
      items = parse(await insights({ "signal.interests.tags": tagIds.join(",") }));
      tagMode = items.length ? "signal" : "dropped";
    }
  }
  if (!items.length) {
    if (!hasSeeds) return { items: [], tagMode };
    items = parse(await insights({}));
  }

  const filtered = items
    .filter((e) => platformMatches(e, input.platform))
    .filter((e) => (input.minYear && e.year ? e.year >= input.minYear : true))
    .filter((e) => (input.maxYear && e.year ? e.year <= input.maxYear : true));
  return { items: filtered.slice(0, input.take ?? 10), tagMode };
}

/**
 * Turn a mood / genre word into Qloo tag ids that apply to games.
 * /v2/tags search is weak for game tags, so candidates are also synthesised per tag type
 * (urn:tag:category:qloo:cozy …) and validated with a one-result insights call.
 */
export async function tags(env: Env, query: string, take = 6): Promise<QlooTag[]> {
  if (!hasKey(env)) return fixture.tags(query);
  const found: QlooTag[] = [];
  const data = await get(env, "/v2/tags", { "filter.query": query, "filter.tag.types": GAME_TAG_TYPES.join(","), take });
  for (const t of normalizeTags(data?.results?.tags ?? [])) found.push(t);

  const s = slug(query);
  if (s) {
    const candidates = ["category", "genre", "gameplay_type", "emotional_tone"].map((kind) => `urn:tag:${kind}:qloo:${s}`);
    const checks = await Promise.all(
      candidates.map(async (id) => {
        if (found.some((t) => t.id === id)) return null;
        try {
          const d = await get(env, "/v2/insights", { "filter.type": ENTITY_URN.video_game, "filter.tags": id, take: 1 });
          return (d?.results?.entities ?? []).length ? ({ id, name: query.trim(), type: id.split(":").slice(0, 3).join(":") } as QlooTag) : null;
        } catch {
          return null;
        }
      })
    );
    for (const t of checks) if (t) found.unshift(t); // synthesised exact ids are the most literal match
  }
  return found.slice(0, take);
}

/** Taste analysis: which game tags characterise the seed set, with affinity. */
export async function taste(env: Env, seedIds: string[], take = 14, seeds?: WeightedSeed[]): Promise<TasteTag[]> {
  if (!hasKey(env)) return fixture.taste(seedIds);
  const weighted = (seeds ?? []).filter((s) => s && s.id);
  if (!seedIds.length && !weighted.length) return [];
  const common = {
    "filter.type": "urn:tag",
    "filter.parents.types": ENTITY_URN.video_game,
    "filter.tag.types": GAME_TAG_TYPES.filter((t) => !t.includes(":genre:")).join(","),
    take,
  };
  const data = weighted.length
    ? await post(env, "/v2/insights", { ...common, "signal.interests.entities": weighted.map((s) => ({ id: s.id, weight: s.weight })) })
    : await get(env, "/v2/insights", { ...common, "signal.interests.entities": seedIds.join(",") });
  const results: any[] = data?.results?.tags ?? [];
  const seen = new Set<string>();
  return results
    .map((t) => ({
      id: String(t.tag_id ?? t.id ?? ""),
      name: String(t.name ?? ""),
      type: t.subtype ? String(t.subtype) : undefined,
      affinity: typeof t?.query?.affinity === "number" ? Number(t.query.affinity.toFixed(3)) : 0,
    }))
    .filter((t) => t.id && t.name && !seen.has(t.name.toLowerCase()) && (seen.add(t.name.toLowerCase()), true));
}
