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

export type Intent = "pick" | "discover" | "taste" | "postcredits" | "chat";

export interface AgentRequest {
  intent?: Intent;
  messages: { role: "user" | "assistant"; content: string }[];
  library: LibraryGame[];
  /** For postcredits: the game just completed. */
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
5. Finish by calling show_games (or show_taste / show_crossover). Each reason is one sentence of 8–18 words that names at least one shared tag from the tool results AND one loved game it connects to, e.g. "Metroidvania and difficult, the same lane as Celeste and Hades." Never a single word. Never invent a tag.
6. Then write one short closing line (under 25 words) spoken to the player: name the mood or thread that ties the picks to a game they loved, in your own words. Never repeat tool notes or describe your steps. No markdown, no lists.

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
  if ((req.intent === "pick" || req.intent === "taste" || req.intent === "discover") && !loved.length) {
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
            await emit({ type: "status", text: onlyLibrary ? "Ranking your pile against your taste…" : `Asking Qloo's taste graph for ${type.replace("_", " ")}s…` });
            const take = onlyLibrary ? 40 : (a.take ?? 10);
            const { items, tagMode } = await qloo.recommend(env, {
              seedIds: arr<string>(a.seed_ids), type, tagIds: a.tag_ids ? arr<string>(a.tag_ids) : undefined,
              platform: typeof a.platform === "string" ? a.platform : undefined, minYear: a.min_year, maxYear: a.max_year, take,
            });
            for (const e of items) seen.set(key(e.name), e);
            const libNames = new Set(lib.map((g) => key(g.name)));
            let filtered = items;
            let note = tagMode === "filter" ? "tags applied as a hard filter" : tagMode === "signal" ? "tags did not match as a filter; applied as a soft bias instead" : tagMode === "dropped" ? "tags matched nothing and were dropped" : "no tag constraint";
            if (type === "video_game") {
              if (onlyLibrary) {
                const want = new Set(lib.filter((g) => g.status === "wantToPlay").map((g) => key(g.name)));
                // Qloo rarely echoes the player's own titles back, so rank the pile by how much each Want
                // game's tags overlap with what Qloo recommends from the loved games.
                filtered = items.filter((e) => want.has(key(e.name)));
                if (filtered.length < 2) {
                  const tagPool = new Map<string, number>();
                  for (const e of items) for (const t of e.tags) tagPool.set(t.id, (tagPool.get(t.id) ?? 0) + (e.affinity ?? 0.5));
                  const scored: qloo.QlooEntity[] = [];
                  for (const g of lib.filter((g) => g.status === "wantToPlay")) {
                    const e = await hydrate(g.name);
                    if (!e) continue;
                    resolvedMap[g.igdb_id] = e.entity_id;
                    const score = e.tags.reduce((s, t) => s + (tagPool.get(t.id) ?? 0), 0);
                    scored.push({ ...e, affinity: Number(Math.min(0.99, score / Math.max(1, items.length)).toFixed(2)) });
                  }
                  filtered = scored.sort((x, y) => (y.affinity ?? 0) - (x.affinity ?? 0));
                  for (const e of filtered) seen.set(key(e.name), e);
                  if (Object.keys(resolvedMap).length) await emit({ type: "resolved", map: resolvedMap });
                  note = "Want pile ranked by tag overlap with Qloo's recommendations from the loved games";
                } else {
                  note = "Want pile titles that Qloo itself recommends, affinity-ranked";
                }
              } else {
                filtered = items.filter((e) => !libNames.has(key(e.name)));
                note += "; library titles removed";
              }
            }
            result = {
              note,
              items: filtered.slice(0, 12).map((e) => ({ name: e.name, year: e.year, affinity: e.affinity, platforms: e.platforms?.slice(0, 5), tags: e.tags.map((t) => t.name).slice(0, 7) })),
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
            const found = await qloo.taste(env, arr<string>(a.seed_ids));
            tasteDone = found.length > 0;
            lastTaste = found.map((t) => ({ name: t.name, affinity: t.affinity }));
            result = { tags: found.map((t) => ({ name: t.name, affinity: t.affinity })) };
            break;
          }
          case "show_games": {
            const picks = arr<{ name: string; reason: string }>(a.picks).filter((p) => p && typeof p.name === "string").slice(0, 5);
            if (req.intent === "pick" && shown) {
              result = { error: "one pick is already shown; do not call show_games again, just write the closing line" };
              break;
            }
            // Hard rules the model must not be able to break: never a completed game; for "pick", only the Want pile.
            const rejected: string[] = [];
            const accepted = picks.filter((p) => {
              const g = byName.get(key(p.name));
              if (g?.status === "completed") { rejected.push(`${p.name} is already completed`); return false; }
              if (req.intent === "pick" && g?.status !== "wantToPlay") { rejected.push(`${p.name} is not in the Want pile`); return false; }
              return true;
            }).slice(0, req.intent === "pick" ? 1 : 5);
            if (!accepted.length) {
              const wantNames = lib.filter((g) => g.status === "wantToPlay").map((g) => g.name);
              result = { error: `no valid picks: ${rejected.join("; ")}.` + (req.intent === "pick" ? ` Choose exactly one of: ${wantNames.join(", ")}` : " Use names from qloo_recommend results that are not in the library.") };
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
              });
            }
            if (!cards.length) {
              result = { error: "no picks given; call show_games with names from the tool results" };
              break;
            }
            await emit({ type: "games", title: a.title, items: cards });
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
