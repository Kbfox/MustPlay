/**
 * Scout: the MustPlay agent. A tool loop over Qloo (taste) + IGDB (game metadata).
 *
 * The app sends the user's library and a question. The agent resolves the games the player loves
 * into Qloo entities, asks Qloo what those entities point to, and answers with cards whose reasons
 * come from Qloo's tags, not from the model's imagination.
 */
import { Env } from "./env";
import * as llm from "./llm";
import * as qloo from "./qloo";
import * as igdb from "./igdb";

export interface LibraryGame {
  igdb_id: number;
  name: string;
  status: "wantToPlay" | "playing" | "completed";
  rating?: number;        // 1–5, completed games only
  year?: number;
  platforms?: string[];
  qloo_id?: string;       // cached from an earlier resolve
}

export type Intent = "pick" | "discover" | "taste" | "postcredits" | "whynot" | "chat";

export interface AgentRequest {
  intent?: Intent;
  messages: { role: "user" | "assistant"; content: string }[];
  library: LibraryGame[];
  /** For postcredits: the game just completed. For whynot: the Want-pile game being asked about. */
  focus_igdb_id?: number;
}

export interface GameCard {
  igdb_id?: number;
  name: string;
  cover_image_id?: string;
  year?: number;
  platforms?: string[];
  reason: string;
  in_library: boolean;
  qloo_id?: string;
  affinity?: number;
  tags: string[];
  image_url?: string;     // Qloo artwork, used when there's no IGDB cover
  because?: string[];     // loved games this result is closest to, from Qloo explainability (names only)
}

export interface CrossCard { type: qloo.EntityType; name: string; year?: number; reason: string; tags: string[]; image_url?: string }

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "games"; title?: string; items: GameCard[] }
  | { type: "taste"; summary: string; tags: { name: string; affinity: number }[] }
  | { type: "crossover"; items: CrossCard[] }
  | { type: "resolved"; map: Record<number, string> }   // igdb_id → qloo entity id, for the app to cache
  | { type: "message"; text: string }
  | { type: "error"; text: string }
  | { type: "done" };

const SYSTEM = `You are Scout, the taste agent inside MustPlay, an iPhone app where players keep a bucket list of games.
You have tools backed by Qloo's taste graph (250M+ cultural entities). Use them; never guess what someone likes.

How to work:
1. The player's library is given below. "Loved" games = completed with rating >= 4, or currently playing. "Want" games = status wantToPlay.
2. First call qloo_resolve on the loved games (and the want games when picking from the pile) to get Qloo entity ids. Skip games it cannot resolve.
3. Then call qloo_recommend with the loved ids as seeds. For "pick from my pile" use only_library=true so results are ranked against the Want pile. For "find something new" leave it false and exclude the library.
4. If the player states a mood or genre (cozy, roguelike, horror, relaxing...), call qloo_tags with ONE word at a time and pass the returned ids as tag_ids. For a platform ("on Switch", "PS5") pass platform. For an era pass min_year / max_year. If the tool result says the tag constraint was dropped, say so briefly in the closing line.
5. qloo_recommend items may carry "because": the loved games each result is closest to, from Qloo's explainability (strongest first, with a share score). You may cite it ("closest to your Celeste"). Never cite a game that is not listed there.
6. Finish by calling show_games (or show_taste / show_crossover). Each reason is one sentence of 8–18 words that names at least one shared tag from the tool results AND one loved game it connects to, e.g. "Metroidvania and difficult, the same lane as Celeste and Hades." Never a single word. Never invent a tag.
7. Then write one short closing line (under 25 words) spoken to the player: name the mood or thread that ties the picks to a game they loved, in your own words. Never repeat tool notes or describe your steps. No markdown, no lists.

Hard rules: for "find something new" show 3 cards whenever the tools return 3 or more candidates; for "pick from my pile" show exactly 1. Do not recommend a game already completed. If nothing resolves, say so plainly and suggest rating a few finished games first.`;

const TOOLS: llm.ToolSpec[] = [
  {
    name: "qloo_resolve",
    description: "Look up games (or movies/artists/books) by title in Qloo and return their entity ids with tags.",
    parameters: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, description: "Titles to resolve, max 12" },
        type: { type: "string", enum: ["video_game", "movie", "tv_show", "artist", "book"], description: "Default video_game" },
      },
      required: ["names"],
    },
  },
  {
    name: "qloo_recommend",
    description: "Ask Qloo's taste graph for entities people who love the seed entities also love. Returns affinity-ranked results with tags.",
    parameters: {
      type: "object",
      properties: {
        seed_ids: { type: "array", items: { type: "string" }, description: "Qloo entity ids of loved games" },
        type: { type: "string", enum: ["video_game", "movie", "tv_show", "artist", "book"], description: "What to recommend. Default video_game" },
        tag_ids: { type: "array", items: { type: "string" }, description: "Optional Qloo tag ids from qloo_tags to constrain results" },
        platform: { type: "string", description: "Platform the player named, e.g. Switch, PS5, PC, Xbox, iOS" },
        min_year: { type: "integer" },
        max_year: { type: "integer" },
        only_library: { type: "boolean", description: "true = rank the player's Want pile; false = discover beyond the library" },
        take: { type: "integer", description: "Default 10" },
      },
      required: ["seed_ids"],
    },
  },
  {
    name: "qloo_tags",
    description: "Turn a mood or genre word into Qloo tag ids (e.g. 'cozy', 'roguelike', 'short').",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "qloo_taste",
    description: "Taste analysis: which tags characterise the seed games, with affinity scores.",
    parameters: { type: "object", properties: { seed_ids: { type: "array", items: { type: "string" } } }, required: ["seed_ids"] },
  },
  {
    name: "show_games",
    description: "Show game cards to the player. Use names exactly as returned by the tools.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional short heading" },
        picks: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" }, reason: { type: "string" } }, required: ["name", "reason"] },
        },
      },
      required: ["picks"],
    },
  },
  {
    name: "show_taste",
    description: "Show the player's taste profile card.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One sentence, second person, under 20 words" },
        tag_names: { type: "array", items: { type: "string" }, description: "Up to 6 tag names from qloo_taste, strongest first" },
      },
      required: ["summary", "tag_names"],
    },
  },
  {
    name: "show_crossover",
    description: "Show non-game picks (movie / artist / book) that pair with the player's taste.",
    parameters: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: { type: { type: "string", enum: ["movie", "tv_show", "artist", "book"] }, name: { type: "string" }, reason: { type: "string" } },
            required: ["type", "name", "reason"],
          },
        },
      },
      required: ["picks"],
    },
  },
];

/** Keep closing lines short: at most two sentences / ~45 words, and never the model's step-by-step narration. */
function clip(text: string): string {
  const cleaned = text.replace(/^(first|then|next|finally)[,\s][^.!?]*[.!?]\s*/gi, "").trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned];
  let out = "";
  for (const sentence of sentences) {
    if ((out + sentence).split(/\s+/).length > 45 && out) break;
    out += sentence;
  }
  return out.trim() || cleaned;
}

/** Llama sometimes passes array arguments as JSON strings; accept both. */
function arr<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return value.split(",").map((s) => s.trim()).filter(Boolean) as T[]; }
  }
  return [];
}

function libraryBlock(lib: LibraryGame[]): string {
  const line = (g: LibraryGame) =>
    `- ${g.name}${g.year ? ` (${g.year})` : ""} | ${g.status}${g.rating ? ` | ${g.rating}★` : ""}${g.platforms?.length ? ` | ${g.platforms.slice(0, 3).join("/")}` : ""}`;
  const loved = lib.filter((g) => (g.status === "completed" && (g.rating ?? 0) >= 4) || g.status === "playing");
  const want = lib.filter((g) => g.status === "wantToPlay");
  const other = lib.filter((g) => !loved.includes(g) && !want.includes(g));
  return [
    `Loved (${loved.length}):`, ...loved.map(line),
    `Want to play (${want.length}):`, ...want.map(line),
    other.length ? `Other completed (${other.length}): ${other.map((g) => g.name).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function intentPrompt(intent: Intent | undefined, focus?: LibraryGame): string {
  switch (intent) {
    case "pick": return "Task: pick ONE game from my Want pile to play next, based on what I loved. One card, then one line.";
    case "discover": return "Task: find up to 3 games NOT in my library that fit my taste. Use any constraint I state.";
    case "taste": return "Task: run qloo_taste on my loved games and show my taste profile.";
    case "whynot": return `Task: The player asks why ${focus?.name ?? "this game"} wasn't picked. Call qloo_recommend with only_library=true, then explain ${focus?.name ?? "the game"}'s rank: which tags it shares with the taste pool (shared_tags), which of its tags Qloo does not associate with the loved games (other_tags), and what the top pick has that ${focus?.name ?? "it"} lacks. Call show_games with ${focus?.name ?? "the game"} as the single pick whose reason is that explanation (2 sentences max), then one closing line. Never invent tags.`;
    case "postcredits": return `Task: I just finished ${focus?.name ?? "a game"}. Using it (and my other loved games) as seeds, recommend ONE movie and ONE album artist or book that pair with it. Use show_crossover.`;
    default: return "";
  }
}

export async function run(env: Env, req: AgentRequest, ctx: ExecutionContext, emit: (e: AgentEvent) => Promise<void>): Promise<void> {
  const lib = req.library ?? [];
  const key = qloo.normalizeName;
  const byName = new Map(lib.map((g) => [key(g.name), g] as const));
  const resolved = new Map<string, qloo.QlooEntity>();   // name(lower) → entity
  const resolvedMap: Record<number, string> = {};
  // Only trust cached ids that look like Qloo's UUIDs; anything else (e.g. fixture ids) is re-resolved.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const trustCache = qloo.hasKey(env);
  for (const g of lib) if (g.qloo_id && trustCache && UUID.test(g.qloo_id)) resolved.set(key(g.name), { entity_id: g.qloo_id, name: g.name, type: "video_game", tags: [] });
  // A cached id is a stub with no tags. Fill it in from /search when tags are needed (ranking, cards).
  const hydrate = async (name: string): Promise<qloo.QlooEntity | undefined> => {
    const k = key(name);
    const cur = resolved.get(k);
    if (cur && cur.tags.length) return cur;
    const full = await qloo.resolve(env, name, "video_game");
    if (full) { resolved.set(k, full); return full; }
    return cur;
  };
  const seen = new Map<string, qloo.QlooEntity>();       // every entity returned by recommend, by lower name
  const focus = req.focus_igdb_id ? lib.find((g) => g.igdb_id === req.focus_igdb_id) : undefined;

  // Seed weights are decided here, never by the model.
  const entityIdOf = (g: LibraryGame): string | undefined => resolvedMap[g.igdb_id] ?? resolved.get(key(g.name))?.entity_id;
  const gameFor = (entityId: string): LibraryGame | undefined => lib.find((g) => entityIdOf(g) === entityId);
  const weightFor = (entityId: string): number => {
    const g = gameFor(entityId);
    if (!g) return 1;
    if (req.intent === "postcredits" && focus && g.igdb_id === focus.igdb_id) return 10;
    if (g.status === "completed" && (g.rating ?? 0) >= 5) return 5;
    if (g.status === "completed" && (g.rating ?? 0) === 4) return 3;
    if (g.status === "playing") return 2;
    return 1;
  };
  /**
   * Only ids this run has actually seen go to Qloo: the model sometimes passes titles ("Hades") or made-up UUIDs as
   * seed_ids, which the POST endpoint rejects with a 400. Titles that were resolved are mapped to their ids.
   */
  const knownId = (raw: string): string | undefined => {
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    const id = raw.trim();
    for (const e of resolved.values()) if (e.entity_id.toLowerCase() === id.toLowerCase()) return e.entity_id;
    for (const e of seen.values()) if (e.entity_id.toLowerCase() === id.toLowerCase()) return e.entity_id;
    return resolved.get(key(id))?.entity_id;
  };
  const seedsFrom = (ids: string[]): qloo.WeightedSeed[] =>
    [...new Set(ids.map(knownId).filter((id): id is string => !!id))].map((id) => ({ id, weight: weightFor(id) }));
  /** Explainability → "Celeste 0.51" strings for the model (library games only). */
  const becauseText = (e: qloo.QlooEntity): string[] | undefined => {
    const out = (e.because ?? []).map((b) => { const g = gameFor(b.entity_id); return g ? `${g.name} ${b.score.toFixed(2)}` : null; }).filter((x): x is string => !!x);
    return out.length ? out : undefined;
  };
  const becauseNames = (e?: qloo.QlooEntity): string[] | undefined => {
    const out = (e?.because ?? []).map((b) => gameFor(b.entity_id)?.name).filter((x): x is string => !!x);
    return out.length ? out : undefined;
  };

  const messages: llm.Message[] = [
    { role: "system", content: SYSTEM },
    { role: "system", content: `Player library:\n${libraryBlock(lib)}` },
    ...req.messages.map((m) => ({ role: m.role, content: m.content }) as llm.Message),
  ];
  const task = intentPrompt(req.intent, focus);
  if (task) messages.push({ role: "user", content: task });

  // Cheap guards before spending a model call: the canned prompts need seeds to work from.
  const loved = lib.filter((g) => (g.status === "completed" && (g.rating ?? 0) >= 4) || g.status === "playing");
  const want = lib.filter((g) => g.status === "wantToPlay");
  if (req.intent === "pick" && !want.length) {
    await emit({ type: "message", text: "Your Want pile is empty. Add a few games you mean to play and I'll rank them against what you loved." });
    return;
  }
  if (req.intent === "whynot" && (!focus || focus.status !== "wantToPlay")) {
    await emit({ type: "message", text: "Ask about a game in your Want pile." });
    return;
  }
  if ((req.intent === "pick" || req.intent === "taste" || req.intent === "discover" || req.intent === "whynot") && !loved.length) {
    await emit({ type: "message", text: "I don't know your taste yet. Mark a game as Playing, or rate a finished one 4 stars or more, then ask again." });
    return;
  }

  if (!qloo.hasKey(env)) await emit({ type: "status", text: "Qloo key not set — using the built-in sample taste graph" });

  let shown = false;
  let spoke = false;
  let tasteDone = false;
  let lastTaste: { name: string; affinity: number }[] = [];
  for (let step = 0; step < 7; step++) {
    const res = await llm.chat(env, messages, TOOLS);
    if (!res.toolCalls.length) {
      const content = clip(res.content.trim());
      if (content) { await emit({ type: "message", text: content }); spoke = true; }
      if (shown || content) break;
      // The model answered nothing and showed nothing: nudge once.
      messages.push({ role: "user", content: "Use the tools now. Start with qloo_resolve." });
      continue;
    }
    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });

    for (const call of res.toolCalls) {
      let result: unknown;
      try {
        const a = call.arguments as any;
        switch (call.name) {
          case "qloo_resolve": {
            const type = (a.type ?? "video_game") as qloo.EntityType;
            const names: string[] = arr<string>(a.names).slice(0, 12);
            const fresh = names.filter((n) => !resolved.has(key(n)));
            if (fresh.length > 0) await emit({ type: "status", text: `Looking up ${fresh.length} title${fresh.length === 1 ? "" : "s"} on Qloo…` });
            else await emit({ type: "status", text: `Using cached Qloo matches for ${names.length} title${names.length === 1 ? "" : "s"}` });
            const out: { name: string; entity_id: string | null; tags?: string[] }[] = [];
            for (const n of names) {
              const cached = resolved.get(key(n));
              const e = cached ?? (await qloo.resolve(env, n, type));
              if (e) {
                resolved.set(key(n), e);
                const g = byName.get(key(n));
                if (g) resolvedMap[g.igdb_id] = e.entity_id;
                out.push({ name: n, entity_id: e.entity_id, tags: e.tags.length ? e.tags.map((t) => t.name).slice(0, 6) : undefined });
              } else out.push({ name: n, entity_id: null });
            }
            if (Object.keys(resolvedMap).length) await emit({ type: "resolved", map: resolvedMap });
            result = { resolved: out };
            break;
          }
          case "qloo_recommend": {
            const type = (a.type ?? "video_game") as qloo.EntityType;
            const onlyLibrary = a.only_library === true || a.only_library === "true";
            const seeds = seedsFrom(arr<string>(a.seed_ids));
            const seedIds = seeds.map((x) => x.id);
            if (!seeds.length) {
              result = { error: "seed_ids must be entity ids returned by qloo_resolve. Call qloo_resolve on the loved games first." };
              break;
            }
            const weighted = new Set(seeds.map((x) => x.weight)).size >= 2;
            await emit({ type: "status", text: onlyLibrary ? (weighted ? "Ranking your pile against your taste (5★ games weigh more)…" : "Ranking your pile against your taste…") : `Asking Qloo's taste graph for ${type.replace("_", " ")}s…` });
            const take = onlyLibrary ? 40 : (a.take ?? 10);
            // Discover: never return the player's own games (library titles are also removed by name below).
            const excludeIds = !onlyLibrary && type === "video_game" ? lib.map(entityIdOf).filter((x): x is string => !!x) : undefined;
            const { items, tagMode } = await qloo.recommend(env, {
              seedIds, seeds, excludeIds, type, tagIds: a.tag_ids ? arr<string>(a.tag_ids) : undefined,
              platform: typeof a.platform === "string" ? a.platform : undefined, minYear: a.min_year, maxYear: a.max_year, take,
            });
            for (const e of items) seen.set(key(e.name), e);
            const libNames = new Set(lib.map((g) => key(g.name)));
            let filtered = items;
            let note = tagMode === "filter" ? "tags applied as a hard filter" : tagMode === "signal" ? "tags did not match as a filter; applied as a soft bias instead" : tagMode === "dropped" ? "tags matched nothing and were dropped" : "no tag constraint";
            if (type === "video_game") {
              if (onlyLibrary) {
                const wantGames = lib.filter((g) => g.status === "wantToPlay");
                const want = new Set(wantGames.map((g) => key(g.name)));
                // Tag pool from the (weighted) recommendations, plus which seed each tag's weight came from,
                // so a Want game's "because" can be traced back to the loved games via Qloo's explainability.
                const tagPool = new Map<string, number>();
                const tagSeeds = new Map<string, Map<string, number>>();
                for (const e of items) for (const t of e.tags) {
                  const w = e.affinity ?? 0.5;
                  tagPool.set(t.id, (tagPool.get(t.id) ?? 0) + w);
                  const per = tagSeeds.get(t.id) ?? new Map<string, number>();
                  for (const b of e.because ?? []) per.set(b.entity_id, (per.get(b.entity_id) ?? 0) + w * b.score);
                  tagSeeds.set(t.id, per);
                }
                const scorePile = async (g: LibraryGame): Promise<qloo.QlooEntity | null> => {
                  const e = await hydrate(g.name);
                  if (!e) return null;
                  resolvedMap[g.igdb_id] = e.entity_id;
                  const score = e.tags.reduce((s, t) => s + (tagPool.get(t.id) ?? 0), 0);
                  const per = new Map<string, number>();
                  for (const t of e.tags) for (const [id, v] of tagSeeds.get(t.id) ?? []) per.set(id, (per.get(id) ?? 0) + v);
                  const total = [...per.values()].reduce((s, v) => s + v, 0);
                  const because = total > 0
                    ? [...per.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([entity_id, v]) => ({ entity_id, score: Number((v / total).toFixed(2)) }))
                    : undefined;
                  rawScore.set(key(e.name), score);
                  return { ...e, because };
                };
                const rawScore = new Map<string, number>();
                // Raw overlap sums run far above the pool size (e.g. 255 vs 209 over 40 items), so dividing by the
                // pool size saturated every Want game at 0.99. Scale relative to the best game in the pile instead.
                const ranked = (list: qloo.QlooEntity[]): qloo.QlooEntity[] => {
                  const max = Math.max(0, ...list.map((e) => rawScore.get(key(e.name)) ?? 0));
                  return list
                    .map((e) => ({ ...e, affinity: max > 0 ? Number((0.99 * (rawScore.get(key(e.name)) ?? 0) / max).toFixed(2)) : 0 }))
                    .sort((x, y) => (y.affinity ?? 0) - (x.affinity ?? 0));
                };
                // Qloo rarely echoes the player's own titles back, so rank the pile by how much each Want
                // game's tags overlap with what Qloo recommends from the loved games.
                filtered = items.filter((e) => want.has(key(e.name)));
                if (filtered.length < 2) {
                  const scored: qloo.QlooEntity[] = [];
                  for (const g of wantGames) { const e = await scorePile(g); if (e) scored.push(e); }
                  filtered = ranked(scored);
                  note = "Want pile ranked by tag overlap with Qloo's recommendations from the loved games";
                } else {
                  note = "Want pile titles that Qloo itself recommends, affinity-ranked";
                  if (req.intent === "whynot") {
                    // The asked-about game must appear: rank the rest of the pile by tag overlap below Qloo's own picks.
                    const have = new Set(filtered.map((e) => key(e.name)));
                    const rest: qloo.QlooEntity[] = [];
                    for (const g of wantGames) if (!have.has(key(g.name))) { const e = await scorePile(g); if (e) rest.push(e); }
                    filtered = [...filtered, ...ranked(rest)];
                    note += "; the rest of the pile follows, ranked by tag overlap";
                  }
                }
                for (const e of filtered) seen.set(key(e.name), e);
                if (Object.keys(resolvedMap).length) await emit({ type: "resolved", map: resolvedMap });
                result = {
                  note,
                  items: filtered.slice(0, 12).map((e, i) => ({
                    rank: i + 1, name: e.name, year: e.year, affinity: e.affinity, platforms: e.platforms?.slice(0, 5),
                    tags: e.tags.map((t) => t.name).slice(0, 7),
                    shared_tags: e.tags.filter((t) => tagPool.has(t.id)).map((t) => t.name).slice(0, 6),
                    other_tags: e.tags.filter((t) => !tagPool.has(t.id)).map((t) => t.name).slice(0, 4),
                    because: becauseText(e),
                  })),
                };
                break;
              } else {
                filtered = items.filter((e) => !libNames.has(key(e.name)));
                note += "; library titles removed";
              }
            }
            result = {
              note,
              items: filtered.slice(0, 12).map((e) => ({ name: e.name, year: e.year, affinity: e.affinity, platforms: e.platforms?.slice(0, 5), tags: e.tags.map((t) => t.name).slice(0, 7), because: becauseText(e) })),
            };
            break;
          }
          case "qloo_tags": {
            const found = await qloo.tags(env, String(a.query ?? ""));
            result = { tags: found.map((t) => ({ id: t.id, name: t.name })) };
            break;
          }
          case "qloo_taste": {
            await emit({ type: "status", text: "Reading your taste profile…" });
            const tasteSeeds = seedsFrom(arr<string>(a.seed_ids));
            if (!tasteSeeds.length) {
              result = { error: "seed_ids must be entity ids returned by qloo_resolve. Call qloo_resolve on the loved games first." };
              break;
            }
            const found = await qloo.taste(env, tasteSeeds.map((x) => x.id), 14, tasteSeeds);
            tasteDone = found.length > 0;
            lastTaste = found.map((t) => ({ name: t.name, affinity: t.affinity }));
            result = { tags: found.map((t) => ({ name: t.name, affinity: t.affinity })) };
            break;
          }
          case "show_games": {
            const picks = arr<{ name: string; reason: string }>(a.picks).filter((p) => p && typeof p.name === "string").slice(0, 5);
            if ((req.intent === "pick" || req.intent === "whynot") && shown) {
              result = { error: "one card is already shown; do not call show_games again, just write the closing line" };
              break;
            }
            // Hard rules the model must not be able to break: never a completed game; for "pick", only the Want pile.
            const rejected: string[] = [];
            const accepted = picks.filter((p) => {
              const g = byName.get(key(p.name));
              if (g?.status === "completed") { rejected.push(`${p.name} is already completed`); return false; }
              if (req.intent === "pick" && g?.status !== "wantToPlay") { rejected.push(`${p.name} is not in the Want pile`); return false; }
              if (req.intent === "whynot" && (!g || !focus || g.igdb_id !== focus.igdb_id)) { rejected.push(`${p.name} is not the game being asked about`); return false; }
              return true;
            }).slice(0, req.intent === "pick" || req.intent === "whynot" ? 1 : 5);
            if (!accepted.length) {
              const wantNames = lib.filter((g) => g.status === "wantToPlay").map((g) => g.name);
              const hint = req.intent === "pick" ? ` Choose exactly one of: ${wantNames.join(", ")}`
                : req.intent === "whynot" ? ` Show exactly one card: ${focus?.name}, with the explanation as its reason.`
                : " Use names from qloo_recommend results that are not in the library.";
              result = { error: `no valid picks: ${rejected.join("; ")}.` + hint };
              break;
            }
            await emit({ type: "status", text: "Fetching covers…" });
            const cards: GameCard[] = [];
            for (const p of accepted) {
              const lower = key(p.name);
              const g = byName.get(lower);
              let e = seen.get(lower) ?? resolved.get(lower);
              if (g && e && !e.tags.length) e = (await hydrate(g.name)) ?? e;
              let meta: igdb.IGDBGameLite | null = null;
              if (!g) meta = await igdb.lookupGame(env, ctx, p.name).catch(() => null);
              cards.push({
                igdb_id: g?.igdb_id ?? meta?.igdb_id,
                name: g?.name ?? meta?.name ?? p.name,
                cover_image_id: meta?.cover_image_id,
                year: g?.year ?? meta?.year ?? e?.year,
                platforms: g?.platforms ?? meta?.platforms,
                reason: p.reason,
                in_library: !!g,
                qloo_id: e?.entity_id,
                affinity: e?.affinity,
                tags: e?.tags.map((t) => t.name).slice(0, 4) ?? [],
                image_url: e?.image_url,
                because: becauseNames(e),
              });
            }
            if (!cards.length) {
              result = { error: "no picks given; call show_games with names from the tool results" };
              break;
            }
            await emit({ type: "games", title: req.intent === "whynot" && focus ? `Why not ${focus.name}?` : a.title, items: cards });
            shown = true;
            result = { shown: cards.map((c) => c.name), ...(rejected.length ? { rejected } : {}) };
            break;
          }
          case "show_taste": {
            if (!tasteDone) {
              result = { error: "call qloo_taste with the loved games' entity ids first, then show_taste with its tag names" };
              break;
            }
            const names: string[] = arr<string>(a.tag_names).slice(0, 6);
            await emit({ type: "taste", summary: String(a.summary ?? ""), tags: names.map((n, i) => {
              const real = lastTaste.find((t) => key(t.name) === key(n));
              return { name: n, affinity: Number((real ? real.affinity : 1 - i * 0.12).toFixed(3)) };
            }) });
            shown = true;
            result = { ok: true };
            break;
          }
          case "show_crossover": {
            const picks = arr<{ type: qloo.EntityType; name: string; reason: string }>(a.picks).filter((p) => p && typeof p.name === "string").slice(0, 4);
            if (!picks.length) {
              result = { error: "no picks given" };
              break;
            }
            const items: CrossCard[] = picks.map((p) => {
              const e = seen.get(key(p.name));
              return { type: p.type, name: e?.name ?? p.name, year: e?.year, reason: p.reason, tags: e?.tags.map((t) => t.name).slice(0, 4) ?? [], image_url: e?.image_url };
            });
            await emit({ type: "crossover", items });
            shown = true;
            result = { ok: true };
            break;
          }
          default:
            result = { error: `unknown tool ${call.name}` };
        }
      } catch (e) {
        console.error(`tool ${call.name} failed`, String(e), JSON.stringify(call.arguments).slice(0, 300));
        result = { error: String(e) };
      }
      console.log(`tool ${call.name}`, JSON.stringify(call.arguments).slice(0, 200));
      messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  if (!shown && !spoke) await emit({ type: "message", text: "I couldn't line that up with Qloo this time. Try again, or rate a couple more finished games so I know your taste." });
}
