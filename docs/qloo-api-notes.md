# Qloo API notes

## Verified against the live hackathon API (2026-10-13)

These override anything below that disagrees.

- Video game URN is **`urn:entity:videogame`** (no underscore). The hackathon guide page says `video_game`; the API rejects it with a 400 listing the allowed values.
- `GET /search?query=…&types=urn:entity:videogame&take=5` → `{ results: [ { name, entity_id, types[], popularity, properties{ description, image.url, platforms[], release_date, external{ igdb{id: slug}, steam, metacritic } }, tags[ { tag_id, name, type } ] } ] }`. Note `tag_id`, not `id`, on search results. Exact-title coverage on 24 common games: 23/24 (miss = diacritics, fixed by normalising).
- `GET /v2/insights?filter.type=urn:entity:videogame&signal.interests.entities=<uuid,…>&feature.explainability=true&take=N` → `{ success, results: { entities: [ { name, entity_id, type:"urn:entity", subtype:"urn:entity:videogame", popularity, properties{…}, tags[{tag_id,name,type}], query: { affinity, explainability{ "signal.interests.entities": [{entity_id, score}] } } } ] }, query }`. Affinity is a real 0–1 number.
- Game entities carry tag types: `category:qloo`, `genre:qloo`, `gameplay_type:qloo`, `audience:qloo`, `emotional_tone:qloo`, `art_style:qloo`, `skill_level:qloo`, `platform:qloo`, `player_mode:qloo`. **`filter.tags` works with those ids** (`urn:tag:category:qloo:metroidvania`, `urn:tag:category:qloo:cozy`, `urn:tag:emotional_tone:qloo:relaxing`). `urn:tag:genre:media:*` ids return nothing for games.
- `/v2/tags?filter.query=cozy` is nearly useless for games (returns place/decor tags; with game tag types it returns `audience:qloo:*` oddities). Synthesising `urn:tag:{category,genre,gameplay_type,emotional_tone}:qloo:<slug>` and validating with a `take=1` insights call works.
- `signal.interests.tags=<tag id>` biases results instead of filtering; usable fallback when `filter.tags` matches nothing.
- `filter.release_year.min/max` is silently ignored for games (returned 2018 titles with min=2020). Filter locally on `properties.release_date`.
- Taste analysis: `filter.type=urn:tag&signal.interests.entities=…&filter.parents.types=urn:entity:videogame&filter.tag.types=urn:tag:category:qloo,urn:tag:gameplay_type:qloo,urn:tag:emotional_tone:qloo,urn:tag:audience:qloo,urn:tag:art_style:qloo,urn:tag:skill_level:qloo` → `{ results: { tags: [ { tag_id, name, subtype, query:{affinity} } ] } }`. Without the parents/types filters the result is noisy keyword tags.
- Cross-domain works with game seeds: `filter.type=urn:entity:movie|artist|book` returns affinity-ranked films (`properties.release_year`), soundtrack-adjacent artists, and books (Lore Olympus for Hades). Movie tags are mostly plot keywords; show only genre/style/theme/mood types.
- `/v2/tags/types?filter.parents.types=urn:entity:videogame` lists the tag types above.
- Platform tag slugs seen: `pc`, `nintendo_switch`, `playstation_4`, `playstation_5`, `xbox_one`, `xbox_series_x`, `xbox_series_x_s`, `ios_iphone_ipad_`. We filter platforms locally via `properties.platforms` names instead.
- Ops: Cloudflare Workers count every `fetch` and every Cache API call against a 50-subrequest limit per invocation; the Worker memoises Qloo responses in memory instead of the Cache API. Workers AI free tier is 10,000 neurons/day (hit on 2026-10-13 after ~40 agent turns of testing).

---


Compiled 2026-10-12 from docs.qloo.com reference pages (get-search, insights-api-deep-dive, get-tags,
taste-analysis, available-parameters-by-entity-type, parameters, basic-insights-use-case).
Anything not stated explicitly by the docs is marked "(unverified)" — confirm against a live response.

Base URL: `https://api.qloo.com`. Auth header: `X-Api-Key: <key>` (examples write it `x-api-key`).
All list-valued query params are comma-separated (OpenAPI `style: form, explode: false`).

**Watch out:** the video-game URN is `urn:entity:videogame` (no underscore). `urn:entity:video_game`
appears nowhere in the spec and will not match.

---

## 1. GET /search — entity lookup by name

Query parameters (exact names from the OpenAPI spec):

| Param | Type / default | Notes |
|---|---|---|
| `query` | string | Text to search against. |
| `types` | array (comma-sep) | Category to search. Enum below. |
| `filter.tags` | array | Filter results by a tag, e.g. `urn:tag:genre:action`. |
| `operator.filter.tags` | `union` (default) / `intersection` | all vs any of `filter.tags`. |
| `filter.popularity` | number 0–1 | Minimum popularity an entity must have. |
| `filter.exists` | array, `^external\.\w+$` | e.g. `external.resy`, `external.michelin`. |
| `filter.location` / `filter.radius` / `filter.rating` / `filter.address` | — | Place-oriented; `filter.radius` is miles, default 10, max 100. |
| `page` / `take` / `sort_by` | int default 1 max 100 / int < 200, no default / `match` (default), `distance`, `popularity` | |

`types` enum (verbatim): `urn:entity:artist`, `urn:entity:book`, `urn:entity:brand`, `urn:entity:locality`
(partially supported), `urn:entity:movie`, `urn:entity:person`, `urn:entity:place`, `urn:entity:podcast`,
`urn:entity:tv_show`, `urn:entity:videogame`, `urn:heatmap`, `urn:entity:audience` (deprecated).
The description also lists search-only legacy types not usable in `/v2/insights`: `urn:entity:actor`,
`urn:entity:album`, `urn:entity:author`, `urn:entity:director`, `urn:entity:locality`.

Response (200) schema as published:

```
{ "success": boolean, "duration": number (seconds), "results": [ <entity>, ... ] }
```

`results` is a top-level **array** (not `results.entities`). Each item is `Common.yml` + one of
`UniqueToArtist / UniqueToGeolocational / UniqueToMovie / UniqueToTV / UniqueToVideogame`; the spec page
does not inline those schemas or the example (`examples/entity.yml` is an external include). So per-entity
fields are **(unverified)** for /search; assume the Insights entity shape of section 2 (`name`, `entity_id`,
`type: "urn:entity"`, `subtype` e.g. `urn:entity:movie`, `properties`, `popularity`, `tags[]{id,name,type}`,
`disambiguation`, `external`). A `types` array on entities is not shown anywhere.

Error body (404 "No results", 429 "Rate limit exceeded"):
`{ "code": number, "reason": string, "message": string }` — doc example:
`{"code": 400, "reason": "Bad Request", "message": "entity_ids must be specified."}`.

---

## 2. GET /v2/insights — recommendations

Required: `filter.type` plus at least one valid filter or signal.

`filter.type` enum (verbatim): `urn:entity:artist`, `urn:entity:book`, `urn:entity:brand`,
`urn:entity:locality`, `urn:entity:movie`, `urn:entity:person`, `urn:entity:place`, `urn:entity:podcast`,
`urn:entity:tv_show`, `urn:entity:videogame`, `urn:heatmap`, `urn:entity:audience` (deprecated).
`urn:tag` is also accepted (Taste Analysis, section 5) though it is absent from this enum.

### Signal params
| Param | Values / format |
|---|---|
| `signal.interests.entities` | comma-separated entity UUIDs. GET: IDs only, no weights. POST: same string, or array of `{"entity": <id>, "weight": <n>}`; weights > 0, relative. |
| `signal.interests.entities.weight` / `signal.interests.tags.weight` | number >= 0 or `very_low`/`low`/`mid`/`medium`/`high`/`very_high`. Entities one: "influenced by the relevance of entities (in-domain or cross-domain)". |
| `signal.interests.tags` | comma-separated tag IDs. POST may send `[{"tag": "urn:tag:genre:media:horror", "weight": 7}, ...]`. |
| `operator.signal.interests.tags` | `union` (any tag; highest-affinity tag scores) or `intersection` (all tags; scores merged). Empty behaves as intersection. |
| `signal.demographics.age` | comma-sep of `24_and_younger`, `25_to_29`, `30_to_34`, `35_to_44`, `45_to_54`, `55_and_older`, `35_and_younger`, `36_to_55`. |
| `signal.demographics.gender` | `male` / `female`. |
| `signal.demographics.audiences` (+ `.weight`) | comma-sep audience IDs (from `/v2/audiences`), e.g. `urn:audience:communities`. |

### Filter params useful for media (video game / movie / book / artist)
| Param | Notes |
|---|---|
| `filter.tags` | array of tag IDs; `operator.filter.tags` = `union` (default) / `intersection`. |
| `filter.exclude.tags` | comma-sep tag IDs; operator is `operator.exclude.tags` (`union` default / `intersection`). |
| `filter.results.entities` | comma-sep entity IDs — "often used to assess the affinity of an entity towards input" (score a known set). |
| `filter.results.entities.query` | name string (GET) to resolve entities by name. |
| `filter.exclude.entities` | comma-sep entity IDs removed from results. |
| `filter.popularity.min` / `filter.popularity.max` | float 0–1, percentile (0.98 = 98th). |
| `filter.release_year.min` / `.max` | integer. Parameter guide lists it for **Movie and TV Show only**, not Video Game (see section 3). |
| `filter.release_date.min` / `.max` | YYYY-MM-DD; no entity type listed. `filter.publication_year.min/.max`: Book only. |
| `filter.rating.min` / `.max`, `filter.content_rating`, `filter.release_country` (+ `operator.filter.release_country`) | Movie, TV Show. Ratings 0–5; content rating e.g. `PG-13`, `R,TV-14`. |
| `filter.exists` | `properties.image` or `properties.description` — only entities having that property. |
| `filter.external.exists` + `operator.filter.external.exists` | `resy`/`michelin`/`tablet` — place-oriented despite being listed for media types. |
| `filter.parents.types` | enum of `urn:audience:*` values in the OpenAPI spec; the Taste Analysis page uses it with `urn:entity:movie` etc. when `filter.type=urn:tag`. |

### Ranking / output
`bias.trends` (`off`, `very_low`, `low`, `mid`, `medium` (default), `high`, `very_high`);
`bias.content_based` (0–1, default 0.5); `sort_by` (`affinity` default, `distance`, `rating`, `quality`);
`diversify.by` + `diversify.take`; `backfill.cross_domain.take` (1–20, default 20);
`backfill.content_based.take` (1–10, default 10); `feature.explainability` (boolean, default false).

### Pagination
`take` default 20, **max 50**. `page` 1–100, default 1 (recommended). `offset` skips N results from 0.

### Response shape
Spec: `{ "success": boolean, "results": { "entities": [ ... ], "duration": number } }` — item schema
untyped in the spec. The Basic Insights page shows a real (truncated) response; verbatim first result,
with long arrays elided as in the docs:

```json
// GET https://api.qloo.com/v2/insights/?filter.type=urn:entity:movie&filter.tags=urn:tag:genre:media:comedy&filter.release_year.min=2022
{
    "success": true,
    "results": {
        "entities": [
            {
                "name": "Everything Everywhere All at Once",
                "entity_id": "F0D354AA-BA7E-49D2-8ABA-9A8250F5C852",
                "type": "urn:entity",
                "subtype": "urn:entity:movie",
                "properties": {
                    "release_year": 2022,
                    "release_date": "2022-04-08",
                    "description": "A middle-aged Chinese immigrant is swept up into an insane adventure ...",
                    "content_rating": "R",
                    "duration": 139,
                    "image": { "url": "https://staging.images.qloo.com/i/F0D354AA-BA7E-49D2-8ABA-9A8250F5C852-420x-outside.jpg" },
                    "akas": [ { "value": "Minden, mindenhol, mindenkor", "languages": ["hu"] }, "..." ],
                    "production_companies": ["A24", "AGBO", "IAC Films"], "release_country": ["United States"],
                    "short_descriptions": [ { "value": "...", "languages": ["nb"] } ], "websites": ["..."]
                },
                "popularity": 0.9984116946335868,
                "tags": [
                    { "id": "urn:tag:streaming_service:media:neon_tv", "name": "Neon Tv", "type": "urn:tag:streaming_service:media" },
                    { "id": "urn:tag:keyword:media:multiverse", "name": "Multiverse", "type": "urn:tag:keyword:media" }, "..." ],
                "query": { "measurements": { "audience_growth": -0.04072975141723856 } },
                "disambiguation": "2022, Daniel Scheinert, Daniel Kwan",
                "external": {
                    "wikidata": [ { "id": "q83808444" } ], "letterboxd": [ { "id": "everything-everywhere-all-at-once" } ],
                    "metacritic": [ { "id": "everything-everywhere-all-at-once", "critic_rating": 81, "user_rating": 7.8 } ],
                    "imdb": [ { "id": "tt6710474", "user_rating": 7.8, "user_rating_count": 549113 } ]
                }
            }
        ]
    },
    "duration": 34
}
```

Field notes: entity tags are `{id, name, type}` (not `tag_id`). `query.affinity` is **not** shown in any
fetched example (that request had no signal, so `query` only held `measurements`); the spec only mentions
"the overall `query.affinity` ranking" in heatmap text. Expect `query.affinity` (0–1) per entity when a
`signal.*` is supplied — **(unverified)**. Video-game `properties` keys are undocumented here (unverified;
expect at least `release_year`, `description`, `image.url`).

---

## 3. Valid params by `filter.type` (Entity Type Parameter Guide)

Common to Video Game, Movie, Artist, Book (and TV Show): `filter.type` (required), `bias.trends`,
`filter.exclude.entities`, `filter.exclude.tags`, `operator.exclude.tags`, `filter.external.exists`,
`operator.filter.external.exists`, `filter.parents.types`, `filter.popularity.min`, `filter.popularity.max`,
`filter.results.entities`, `filter.results.entities.query`, `filter.tags`, `operator.filter.tags`,
`offset`, `take`, `signal.demographics.age`, `signal.demographics.audiences`,
`signal.demographics.audiences.weight`, `signal.demographics.gender`, `signal.interests.entities`,
`signal.interests.tags`.

Type-specific additions:
- **Video Game**: none beyond the common set. `filter.release_year.*` is **not** listed for video games —
  filter by year client-side via `properties.release_year` (unverified that games carry it).
- **Movie**: `filter.content_rating`, `filter.release_year.min/.max`, `filter.release_country`,
  `operator.filter.release_country`, `filter.rating.min/.max`.
- **Artist**: none beyond the common set.
- **Book**: `filter.publication_year.min/.max`.
- **TV Show**: Movie's set plus `filter.finale_year.min/.max`, `filter.latest_known_year.min/.max`.
- **Tag** (`filter.type=urn:tag`): `diversify.by`, `diversify.take`, `offset`, `take`
  (plus the signals/filters the Taste Analysis page lists — section 5).

The per-type tables omit `page`, `feature.explainability`, `filter.exists`, `sort_by`, `signal.interests.*.weight`
although the OpenAPI spec documents them globally — "probably accepted" (unverified per type). Actor/Author/Director are deprecated → Person.

---

## 4. GET /v2/tags — tag search

Purpose: find tags usable in `filter.tags`, `filter.exclude.tags`, `signal.interests.tags`.

| Param | Type / default | Notes |
|---|---|---|
| `filter.query` | string | Partial string match on tag name, e.g. `vegan`. |
| `filter.tag.types` | array (comma-sep) | Exact-match tag types, e.g. `urn:tag:genre:media`. Tag Types API lists valid ones per entity type. |
| `filter.parents.types` | string (comma-sep) | Spec enum is `urn:audience:*` only; Taste Analysis uses `urn:entity:movie` etc. — media entity types here are (unverified). |
| `filter.results.tags` | array | Comma-sep tag IDs to score/inspect. |
| `filter.popularity.min` / `.max` | 0–1 | |
| `feature.typo_tolerance` | bool, default false | |
| `feature.semantic_search` | bool, default false | Beta; meaning-based match with `filter.query`. |
| `take` | int, default 20, max 50 | |
| `page` | int 1–100, default 1 | `offset` also accepted. |

Response: `{ "success": boolean, "duration": number, "results": { "tags": [ ... ] } }`; item schema untyped,
no example shown. Tag IDs seen in docs: `urn:tag:genre:media:comedy`, `urn:tag:genre:media:horror`,
`urn:tag:keyword:media:multiverse`, `urn:tag:streaming_service:media:neon_tv`, `urn:tag:style:qloo:indie`.
Pattern: `urn:tag:<category>:<domain>:<value>`. Expect items shaped like Taste Analysis tags
(`tag_id`, `name`, `types[]`, `subtype`, `tag_value`) — (unverified for /v2/tags).

---

## 5. Taste Analysis — tag distribution for seed entities

Same endpoint, `filter.type=urn:tag`, plus at least one of: `signal.interests.entities`,
`signal.interests.tags`, `signal.demographics.audiences`, `signal.location` / `signal.location.query`,
`filter.tag.types`, `filter.parents.types`. Docs recommend combining `filter.tag.types` with
`signal.interests.entities` for targeted analysis; demographics weight the tag affinities.

Request for "what tags describe this set of games" (composed from the rules above, not a doc example):```
GET /v2/insights?filter.type=urn:tag&signal.interests.entities=<uuid1>,<uuid2>&filter.tag.types=urn:tag:genre:media&filter.parents.types=urn:entity:videogame&take=50
```
Use `diversify.by=subtype` + `diversify.take=N` to cap per tag subtype (genre vs keyword vs theme).
Doc's verbatim example (no signal, metadata only):
```
curl --location 'https://api.qloo.com/v2/insights?filter.type=urn%3Atag&filter.tag.types=urn%3Atag%3Akeyword%3Amedia&filter.parents.types=urn%3Aentity%3Amovie%2C%20urn%3Aentity%3Atv_show' --header 'x-api-key: x-api-key'
```
```json
{ "success": true, "duration": 25,
  "results": { "tags": [ {
        "tag_id": "urn:tag:keyword:media:brady_bunch",
        "name": "Brady Bunch",
        "types": ["urn:entity:tv_show", "urn:entity:writer", "urn:entity:director", "urn:entity:tv_episode", "urn:entity:actor", "urn:entity:movie"],
        "subtype": "urn:tag:keyword:media",
        "tag_value": "urn:tag:keyword:media:brady_bunch",
        "query": {}
  } ] } }
```
With a signal present, `query` presumably carries the affinity score (`query.affinity`) — (unverified; the only example has no signal and an empty `query`).

---

## 6. Cross-domain recommendations and explainability

- **Cross-domain is implicit**: `filter.type` sets the output domain; `signal.interests.entities` may be
  any entity type (the `.weight` description explicitly says "in-domain or cross-domain"). E.g.
  `filter.type=urn:entity:movie&signal.interests.entities=<videogame uuids>` → movies for a gamer's taste.
  The pages fetched show no complete cross-domain example request (unverified in practice, but the
  Insights deep-dive describes it as the core use case).
- `backfill.cross_domain.take` (1–20, default 20): max cross-domain backfill results appended when
  primary results are insufficient. `backfill.content_based.take` (1–10, default 10) is the analogous
  cap for content-based similarity backfill.
- `signal.interests.entities.weight` / `signal.interests.tags.weight`: tune how strongly entity vs tag
  signals drive affinity (`very_low` … `very_high` or a number >= 0).
- **`feature.explainability=true`** (default false). Per result: `query.explainability` lists which input
  entities (e.g. from `signal.interests.entities`) contributed, normalized 0–1; entities scoring >= 0.1
  always included, lower ones may be dropped. Top-level `query.explainability` gives the average
  influence of each input across top-N subsets (top 3, 5, 10, all). On failure a
  `query.explainability.warning` is returned and results still come back. Exact key layout inside
  `query.explainability` (e.g. keyed by entity_id) is not shown — (unverified).
