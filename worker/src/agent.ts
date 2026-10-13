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
}

export interface CrossCard { type: qloo.EntityType; name: string; year?: number; reason: string; tags: string[] }

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
4. If the player states a constraint (cozy, short, roguelike, on Switch, 90s...), call qloo_tags to turn it into tag ids and pass them as tag_ids; use platforms from the library data for platform constraints.
5. Finish by calling show_games (or show_taste / show_crossover). Each reason is one sentence of 8–18 words that names at least one shared tag from the tool results AND one loved game it connects to, e.g. "Metroidvania and difficult, the same lane as Celeste and Hades." Never a single word. Never invent a tag.
6. Then write one short closing line (under 25 words). No markdown, no lists.

Hard rules: at most 3 cards unless asked for more. Do not recommend a game already completed. If nothing resolves, say so plainly and suggest rating a few finished games first.`;

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
  const byName = new Map(lib.map((g) => [g.name.toLowerCase(), g] as const));
  const resolved = new Map<string, qloo.QlooEntity>();   // name(lower) → entity
  const resolvedMap: Record<number, string> = {};
  for (const g of lib) if (g.qloo_id) resolved.set(g.name.toLowerCase(), { entity_id: g.qloo_id, name: g.name, type: "video_game", tags: [] });
  const seen = new Map<string, qloo.QlooEntity>();       // every entity returned by recommend, by lower name
  const focus = req.focus_igdb_id ? lib.find((g) => g.igdb_id === req.focus_igdb_id) : undefined;

  const messages: llm.Message[] = [
    { role: "system", content: SYSTEM },
    { role: "system", content: `Player library:\n${libraryBlock(lib)}` },
    ...req.messages.map((m) => ({ role: m.role, content: m.content }) as llm.Message),
  ];
  const task = intentPrompt(req.intent, focus);
  if (task) messages.push({ role: "user", content: task });

  if (!qloo.hasKey(env)) await emit({ type: "status", text: "Qloo key not set — using the built-in sample taste graph" });

  let shown = false;
  for (let step = 0; step < 7; step++) {
    const res = await llm.chat(env, messages, TOOLS);
    if (!res.toolCalls.length) {
      const content = res.content.trim();
      if (content) await emit({ type: "message", text: content });
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
            await emit({ type: "status", text: `Looking up ${names.length} title${names.length === 1 ? "" : "s"} on Qloo…` });
            const out: { name: string; entity_id: string | null; tags?: string[] }[] = [];
            for (const n of names) {
              const cached = resolved.get(n.toLowerCase());
              const e = cached ?? (await qloo.resolve(env, n, type));
              if (e) {
                resolved.set(n.toLowerCase(), e);
                const g = byName.get(n.toLowerCase());
                if (g) resolvedMap[g.igdb_id] = e.entity_id;
                out.push({ name: n, entity_id: e.entity_id, tags: e.tags.map((t) => t.name).slice(0, 6) });
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
            const items = await qloo.recommend(env, { seedIds: arr<string>(a.seed_ids), type, tagIds: a.tag_ids ? arr<string>(a.tag_ids) : undefined, minYear: a.min_year, maxYear: a.max_year, take });
            for (const e of items) seen.set(e.name.toLowerCase(), e);
            const libNames = new Set(lib.map((g) => g.name.toLowerCase()));
            let filtered = items;
            if (type === "video_game") {
              if (onlyLibrary) {
                const want = new Set(lib.filter((g) => g.status === "wantToPlay").map((g) => g.name.toLowerCase()));
                // Qloo may not echo back library titles when it recommends; fall back to matching names.
                filtered = items.filter((e) => want.has(e.name.toLowerCase()));
                if (!filtered.length) {
                  // Rank the pile ourselves: resolve want games and score by tag overlap with recommendations.
                  const tagPool = new Map<string, number>();
                  for (const e of items) for (const t of e.tags) tagPool.set(t.id, (tagPool.get(t.id) ?? 0) + (e.affinity ?? 0.5));
                  const scored: qloo.QlooEntity[] = [];
                  for (const g of lib.filter((g) => g.status === "wantToPlay")) {
                    const e = resolved.get(g.name.toLowerCase()) ?? (await qloo.resolve(env, g.name, "video_game"));
                    if (!e) continue;
                    resolved.set(g.name.toLowerCase(), e);
                    resolvedMap[g.igdb_id] = e.entity_id;
                    const score = e.tags.reduce((s, t) => s + (tagPool.get(t.id) ?? 0), 0);
                    scored.push({ ...e, affinity: Number(Math.min(0.99, score / Math.max(1, items.length)).toFixed(2)) });
                  }
                  filtered = scored.sort((x, y) => (y.affinity ?? 0) - (x.affinity ?? 0));
                  for (const e of filtered) seen.set(e.name.toLowerCase(), e);
                  if (Object.keys(resolvedMap).length) await emit({ type: "resolved", map: resolvedMap });
                }
              } else {
                filtered = items.filter((e) => !libNames.has(e.name.toLowerCase()));
              }
            }
            result = {
              note: onlyLibrary ? "ranked within the player's Want pile" : "library titles removed",
              items: filtered.slice(0, 12).map((e) => ({ name: e.name, year: e.year, affinity: e.affinity, tags: e.tags.map((t) => t.name).slice(0, 6) })),
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
            result = { tags: found.map((t) => ({ name: t.name, affinity: t.affinity })) };
            break;
          }
          case "show_games": {
            const picks = arr<{ name: string; reason: string }>(a.picks).filter((p) => p && typeof p.name === "string").slice(0, 5);
            await emit({ type: "status", text: "Fetching covers…" });
            const cards: GameCard[] = [];
            for (const p of picks) {
              const lower = p.name.toLowerCase();
              const g = byName.get(lower);
              const e = seen.get(lower) ?? resolved.get(lower);
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
              });
            }
            await emit({ type: "games", title: a.title, items: cards });
            shown = true;
            result = { shown: cards.map((c) => c.name) };
            break;
          }
          case "show_taste": {
            const names: string[] = arr<string>(a.tag_names).slice(0, 6);
            await emit({ type: "taste", summary: String(a.summary ?? ""), tags: names.map((n, i) => ({ name: n, affinity: Number((1 - i * 0.12).toFixed(2)) })) });
            shown = true;
            result = { ok: true };
            break;
          }
          case "show_crossover": {
            const picks = arr<{ type: qloo.EntityType; name: string; reason: string }>(a.picks).filter((p) => p && typeof p.name === "string").slice(0, 4);
            const items: CrossCard[] = picks.map((p) => {
              const e = seen.get(p.name.toLowerCase());
              return { type: p.type, name: e?.name ?? p.name, year: e?.year, reason: p.reason, tags: e?.tags.map((t) => t.name).slice(0, 4) ?? [] };
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
  if (!shown) await emit({ type: "message", text: "I couldn't line that up with Qloo this time. Try again, or rate a couple more finished games so I know your taste." });
}
