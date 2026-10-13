/**
 * Stand-in taste graph used only when QLOO_API_KEY is absent (local dev / before the key arrives).
 * Hand-written, deliberately small. Recommendation = tag overlap with the seed set. The ids are
 * fake ("fx:…") so nothing here can be mistaken for Qloo data.
 */
import type { EntityType, QlooEntity, QlooTag, RecommendInput, TasteTag } from "./qloo";

type Row = { name: string; type: EntityType; year: number; tags: string[]; popularity: number };

const T = (slug: string, name: string): QlooTag => ({ id: `urn:tag:genre:media:${slug}`, name, type: "urn:tag:genre:media" });
const TAGS: Record<string, QlooTag> = {
  roguelike: T("roguelike", "Roguelike"),
  action: T("action", "Action"),
  indie: T("indie", "Indie"),
  platformer: T("platformer", "Platformer"),
  metroidvania: T("metroidvania", "Metroidvania"),
  rpg: T("rpg", "RPG"),
  open_world: T("open_world", "Open World"),
  story: T("story_rich", "Story Rich"),
  cozy: T("cozy", "Cozy"),
  puzzle: T("puzzle", "Puzzle"),
  souls: T("soulslike", "Soulslike"),
  pixel: T("pixel_art", "Pixel Art"),
  mythology: T("mythology", "Mythology"),
  difficult: T("difficult", "Difficult"),
  short: T("short", "Short"),
  atmospheric: T("atmospheric", "Atmospheric"),
  scifi: T("science_fiction", "Science Fiction"),
  fantasy: T("fantasy", "Fantasy"),
  horror: T("horror", "Horror"),
  strategy: T("strategy", "Strategy"),
  farming: T("farming", "Farming"),
  narrative: T("narrative", "Narrative"),
  surreal: T("surreal", "Surreal"),
  multiplayer: T("multiplayer", "Multiplayer"),
};

const ROWS: Row[] = [
  { name: "Hades", type: "video_game", year: 2020, tags: ["roguelike", "action", "indie", "mythology", "story"], popularity: 0.97 },
  { name: "Hades II", type: "video_game", year: 2025, tags: ["roguelike", "action", "indie", "mythology"], popularity: 0.9 },
  { name: "Celeste", type: "video_game", year: 2018, tags: ["platformer", "indie", "pixel", "difficult", "story"], popularity: 0.93 },
  { name: "Hollow Knight", type: "video_game", year: 2017, tags: ["metroidvania", "indie", "difficult", "atmospheric", "souls"], popularity: 0.96 },
  { name: "Hollow Knight: Silksong", type: "video_game", year: 2025, tags: ["metroidvania", "indie", "difficult", "atmospheric"], popularity: 0.95 },
  { name: "Dead Cells", type: "video_game", year: 2018, tags: ["roguelike", "metroidvania", "action", "pixel", "difficult"], popularity: 0.9 },
  { name: "Elden Ring", type: "video_game", year: 2022, tags: ["souls", "open_world", "rpg", "difficult", "fantasy"], popularity: 0.98 },
  { name: "Sekiro: Shadows Die Twice", type: "video_game", year: 2019, tags: ["souls", "action", "difficult", "atmospheric"], popularity: 0.92 },
  { name: "Bloodborne", type: "video_game", year: 2015, tags: ["souls", "horror", "difficult", "atmospheric"], popularity: 0.91 },
  { name: "The Legend of Zelda: Breath of the Wild", type: "video_game", year: 2017, tags: ["open_world", "action", "fantasy"], popularity: 0.97 },
  { name: "The Legend of Zelda: Tears of the Kingdom", type: "video_game", year: 2023, tags: ["open_world", "action", "fantasy", "puzzle"], popularity: 0.95 },
  { name: "Stardew Valley", type: "video_game", year: 2016, tags: ["cozy", "farming", "indie", "pixel", "rpg"], popularity: 0.95 },
  { name: "Animal Crossing: New Horizons", type: "video_game", year: 2020, tags: ["cozy", "multiplayer"], popularity: 0.9 },
  { name: "A Short Hike", type: "video_game", year: 2019, tags: ["cozy", "indie", "short", "atmospheric"], popularity: 0.8 },
  { name: "Unpacking", type: "video_game", year: 2021, tags: ["cozy", "puzzle", "indie", "short", "narrative"], popularity: 0.82 },
  { name: "Spiritfarer", type: "video_game", year: 2020, tags: ["cozy", "indie", "narrative", "story"], popularity: 0.84 },
  { name: "Portal 2", type: "video_game", year: 2011, tags: ["puzzle", "scifi", "story", "short"], popularity: 0.94 },
  { name: "Outer Wilds", type: "video_game", year: 2019, tags: ["puzzle", "scifi", "atmospheric", "story", "indie"], popularity: 0.9 },
  { name: "Disco Elysium", type: "video_game", year: 2019, tags: ["rpg", "story", "narrative", "surreal"], popularity: 0.89 },
  { name: "The Witcher 3: Wild Hunt", type: "video_game", year: 2015, tags: ["rpg", "open_world", "story", "fantasy"], popularity: 0.97 },
  { name: "Baldur's Gate 3", type: "video_game", year: 2023, tags: ["rpg", "story", "fantasy", "strategy"], popularity: 0.97 },
  { name: "Inside", type: "video_game", year: 2016, tags: ["platformer", "atmospheric", "short", "surreal", "indie"], popularity: 0.86 },
  { name: "Slay the Spire", type: "video_game", year: 2019, tags: ["roguelike", "strategy", "indie"], popularity: 0.9 },
  { name: "Balatro", type: "video_game", year: 2024, tags: ["roguelike", "strategy", "indie"], popularity: 0.92 },
  { name: "Cuphead", type: "video_game", year: 2017, tags: ["platformer", "difficult", "indie", "action"], popularity: 0.88 },
  { name: "Resident Evil 4", type: "video_game", year: 2023, tags: ["horror", "action"], popularity: 0.9 },
  // Cross-domain rows
  { name: "Everything Everywhere All at Once", type: "movie", year: 2022, tags: ["surreal", "story", "action", "indie"], popularity: 0.9 },
  { name: "Spider-Man: Into the Spider-Verse", type: "movie", year: 2018, tags: ["action", "story", "indie"], popularity: 0.93 },
  { name: "Princess Mononoke", type: "movie", year: 1997, tags: ["fantasy", "atmospheric", "story", "mythology"], popularity: 0.9 },
  { name: "Arrival", type: "movie", year: 2016, tags: ["scifi", "story", "atmospheric", "puzzle"], popularity: 0.88 },
  { name: "The Lighthouse", type: "movie", year: 2019, tags: ["horror", "atmospheric", "surreal"], popularity: 0.8 },
  { name: "Kiki's Delivery Service", type: "movie", year: 1989, tags: ["cozy", "story"], popularity: 0.85 },
  { name: "The Green Knight", type: "movie", year: 2021, tags: ["fantasy", "mythology", "atmospheric", "difficult"], popularity: 0.78 },
  { name: "Darren Korb", type: "artist", year: 2011, tags: ["indie", "mythology", "atmospheric"], popularity: 0.6 },
  { name: "Lena Raine", type: "artist", year: 2018, tags: ["indie", "platformer", "atmospheric", "cozy"], popularity: 0.6 },
  { name: "Boards of Canada", type: "artist", year: 1998, tags: ["atmospheric", "surreal", "scifi"], popularity: 0.75 },
  { name: "Circe", type: "book", year: 2018, tags: ["mythology", "story", "fantasy"], popularity: 0.85 },
  { name: "Piranesi", type: "book", year: 2020, tags: ["surreal", "atmospheric", "puzzle", "story"], popularity: 0.82 },
  { name: "Project Hail Mary", type: "book", year: 2021, tags: ["scifi", "story", "puzzle"], popularity: 0.88 },
  { name: "The House in the Cerulean Sea", type: "book", year: 2020, tags: ["cozy", "fantasy", "story"], popularity: 0.8 },
];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function toEntity(row: Row, affinity?: number): QlooEntity {
  return {
    entity_id: `fx:${row.type}:${slug(row.name)}`,
    name: row.name,
    type: row.type,
    affinity,
    popularity: row.popularity,
    year: row.year,
    tags: row.tags.map((t) => TAGS[t]),
  };
}

function rowFor(id: string): Row | undefined {
  return ROWS.find((r) => `fx:${r.type}:${slug(r.name)}` === id);
}

export function resolve(name: string, type: EntityType): QlooEntity | null {
  const needle = name.trim().toLowerCase();
  const exact = ROWS.find((r) => r.type === type && r.name.toLowerCase() === needle);
  const loose = exact ?? ROWS.find((r) => r.type === type && (r.name.toLowerCase().includes(needle) || needle.includes(r.name.toLowerCase())));
  return loose ? toEntity(loose) : null;
}

export function recommend(input: RecommendInput): QlooEntity[] {
  const seeds = input.seedIds.map(rowFor).filter((r): r is Row => !!r);
  const seedTags = new Map<string, number>();
  for (const s of seeds) for (const t of s.tags) seedTags.set(t, (seedTags.get(t) ?? 0) + 1);
  const wanted = new Set((input.tagIds ?? []).map((id) => id.split(":").pop() ?? ""));
  const seedNames = new Set(seeds.map((s) => s.name));

  return ROWS.filter((r) => r.type === input.type && !seedNames.has(r.name))
    .filter((r) => (input.minYear ? r.year >= input.minYear : true) && (input.maxYear ? r.year <= input.maxYear : true))
    .filter((r) => (wanted.size ? r.tags.some((t) => wanted.has(t)) : true))
    .map((r) => {
      let overlap = 0;
      for (const t of r.tags) overlap += seedTags.get(t) ?? 0;
      const denom = Math.max(1, seeds.length) * Math.max(1, r.tags.length);
      const affinity = Math.min(0.99, 0.35 + (overlap / denom) * 1.2 + r.popularity * 0.1);
      return { r, overlap, affinity };
    })
    .filter((x) => seeds.length === 0 || x.overlap > 0)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, input.take ?? 10)
    .map((x) => toEntity(x.r, Number(x.affinity.toFixed(2))));
}

export function tags(query: string): QlooTag[] {
  const q = query.toLowerCase();
  return Object.values(TAGS).filter((t) => t.name.toLowerCase().includes(q) || t.id.includes(q.replace(/\s+/g, "_"))).slice(0, 8);
}

export function taste(seedIds: string[]): TasteTag[] {
  const seeds = seedIds.map(rowFor).filter((r): r is Row => !!r);
  const counts = new Map<string, number>();
  for (const s of seeds) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => ({ ...TAGS[t], affinity: Number((n / Math.max(1, seeds.length)).toFixed(2)) }))
    .slice(0, 12);
}
