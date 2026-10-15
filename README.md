# MustPlay

Your gaming bucket list. Save the games you must play, put them in order, mark them done, rate
them, and share a card. iOS 17+, SwiftUI + SwiftData.

Built for [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com/); live on the
[App Store](https://apps.apple.com/app/id6816116027). Version 1.1 adds **Scout**, a taste agent built on
[Qloo](https://www.qloo.com) for the [Qloo Agentic Hackathon](https://qloo.devpost.com) — see
[Scout](#scout--the-taste-agent) below. MIT licensed.

## Layout

```
project.yml                     XcodeGen spec → run `xcodegen generate` after editing
Config/                         xcconfig; Secrets.xcconfig is gitignored (see .example)
MustPlay/
  App/                          entry point, AppDelegate (OneSignal), AppConfig (Info.plist keys)
  Models/BucketGame.swift       SwiftData model
  Services/                     IGDBClient (via Worker), ScoutClient (SSE to the agent), PurchaseManager
                                (RevenueCat), NotificationManager (OneSignal + local), ImageLoader
  Views/                        RootView → BucketListView → GameDetailView → CompleteSheet / ShareCardSheet
                                ScoutView (agent chat), TasteShareCard (poster), WhatNextSheet,
                                SearchView, PaywallSheet, SettingsView
OneSignalNotificationServiceExtension/
worker/                         Cloudflare Worker (TypeScript): IGDB proxy + the Scout agent
  src/index.ts                  routes: /health, /v4/* (IGDB), /agent (SSE), /qloo/* (debug passthrough, only when APP_KEY is set)
  src/agent.ts                  tool loop, system prompt, card rendering, hard rules
  src/qloo.ts                   Qloo client: /search, /v2/insights, /v2/tags, taste analysis
  src/llm.ts                    chat-with-tools adapter: OpenAI-compatible (DeepSeek) or Workers AI
  src/igdb.ts                   IGDB proxy + lookup used to attach covers to Qloo picks
  src/fixture.ts                tiny sample taste graph used when QLOO_API_KEY is absent
docs/                           plans, verified Qloo API notes, privacy/terms, submission drafts
```

## First-time setup

1. **Xcode** (26+). Then generate the project:

   ```bash
   brew install xcodegen
   xcodegen generate
   open MustPlay.xcodeproj
   ```

2. **Keys** → edit `Config/Secrets.xcconfig` (never committed):

   | Key | Where |
   |---|---|
   | `RC_API_KEY_DEBUG` | RevenueCat → Project settings → API keys → Test Store (`test_…`) |
   | `RC_API_KEY_RELEASE` | same page → App Store app (`appl_…`), after the Apple account exists |
   | `ONESIGNAL_APP_ID` | OneSignal → Settings → Keys & IDs |
   | `IGDB_PROXY_URL` | the Worker URL from step 3 (`https:/$()/…` — keep the `$()`) |
   | `IGDB_APP_KEY` | optional; must equal the Worker's `APP_KEY` secret |
   | `DEVELOPMENT_TEAM` | Apple Team ID |

   Everything degrades gracefully when a key is empty, so the simulator build works from day one.

3. **IGDB proxy** (needs a Twitch app with 2FA + a free Cloudflare account):

   ```bash
   cd worker
   npm install
   npm run login
   npm run secrets      # pastes TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET into Cloudflare
   npm run deploy       # prints https://mustplay-igdb.<subdomain>.workers.dev
   ```

   Smoke test:

   ```bash
   curl -X POST https://mustplay-igdb.<subdomain>.workers.dev/v4/games \
     -d 'search "zelda"; fields name; limit 3;'
   ```

4. **RevenueCat dashboard**: entitlement `pro`; products `mustplay_pro_monthly`,
   `mustplay_pro_yearly`, `mustplay_pro_lifetime`; default offering; one Paywalls V2 paywall.

5. **OneSignal dashboard**: APNs `.p8` key (needs the Apple account), then Journeys keyed on tags
   `want_count`, `playing_count`, `playing_since`, `last_active` (set in `NotificationManager.syncTags`).

## Scout — the taste agent

Scout answers "what should I play next?" with Qloo's taste graph instead of guesses. It lives behind
the **Ask Scout** card on the list and fires automatically after you complete a game.

| Prompt | What Scout does | Qloo calls |
|---|---|---|
| Pick from my pile | ranks your own Want list against the games you loved | `/search` → `/v2/insights` (videogame) |
| Find me something new | taste-grounded discovery with constraints ("short and cozy, on Switch") | `/v2/tags` + `/v2/insights` with `filter.tags` |
| What's my taste? | profile card + shareable poster | `/v2/insights?filter.type=urn:tag` (taste analysis) |
| Post-credits pick | a film and an album that pair with the game you just finished | `/v2/insights` cross-domain (movie / artist / book) |

### Architecture

```
iPhone (SwiftUI)                         Cloudflare Worker                         Qloo (hackathon.api.qloo.com)
┌──────────────────┐  POST /agent        ┌────────────────────────────────┐        ┌──────────────────────┐
│ ScoutView        │ ───── JSON ───────▶ │ agent.ts  tool loop            │ ─────▶ │ /search              │
│  question +      │                     │   qloo_resolve ───────────────────────▶ │ /v2/insights         │
│  library snapshot│ ◀──── SSE ───────── │   qloo_recommend ─────────────────────▶ │ /v2/tags             │
│                  │  status / games /   │   qloo_tags                    │        └──────────────────────┘
│ cards with       │  taste / crossover /│   qloo_taste                   │ ─────▶ IGDB (covers, ids)
│ Start playing /  │  message / done     │   igdb_lookup                  │ ─────▶ LLM (DeepSeek or Workers AI)
│ Add to list      │                     │   show_games/taste/crossover   │
└──────────────────┘                     └────────────────────────────────┘
```

- The app sends the question plus a snapshot of the list: titles, status, star rating, platforms,
  release year, and any cached Qloo entity id. No account, no identifiers. Nothing is stored server-side
  beyond an in-isolate memo of Qloo responses.
- The model only ever sees tool results. The Worker enforces the rules the prompt states: `show_taste`
  must follow a real `qloo_taste`; "pick" accepts exactly one game and only from the Want pile; completed
  games are never recommended; cards without a resolvable title are dropped. Every card's `tags` come from
  Qloo, so reasons can cite them without inventing anything.
- What the live API actually returns (URNs, tag types, which filters work for games) is written down in
  [`docs/qloo-api-notes.md`](docs/qloo-api-notes.md).

### Try the agent in a browser

No iPhone needed: **https://kbfox.github.io/mustplay-site/scout.html** is a single static page that talks to
the same Worker as the app. Build a list (or load a sample), press one of the four prompts, and watch the
agent's steps stream in; a "Show raw events" toggle reveals the SSE protocol below. Source:
[Kbfox/mustplay-site](https://github.com/Kbfox/mustplay-site/blob/main/scout.html).

### Try the agent from a terminal

Same endpoint the app uses. Events stream as server-sent events.

```bash
curl -N -X POST https://mustplay-igdb.kbfoxtk.workers.dev/agent \
  -H 'content-type: application/json' \
  --data '{
    "intent": "pick",
    "messages": [{"role": "user", "content": "What should I play next?"}],
    "library": [
      {"igdb_id": 1, "name": "Hades",      "status": "completed",  "rating": 5},
      {"igdb_id": 2, "name": "Celeste",    "status": "completed",  "rating": 5},
      {"igdb_id": 3, "name": "Dead Cells", "status": "wantToPlay"},
      {"igdb_id": 4, "name": "Unpacking",  "status": "wantToPlay"},
      {"igdb_id": 5, "name": "Elden Ring", "status": "wantToPlay"}
    ]
  }'
```

`intent` is one of `pick`, `discover`, `taste`, `postcredits` (add `"focus_igdb_id"` for the game just
finished) or `chat` for free text such as `"something like Hollow Knight but shorter"`. Typical output:

```
data: {"type":"status","text":"Looking up 2 titles on Qloo…"}
data: {"type":"resolved","map":{"1":"BA00D00A-…","2":"FC14952D-…"}}
data: {"type":"status","text":"Ranking your pile against your taste…"}
data: {"type":"games","title":"Your next game","items":[{"igdb_id":3,"name":"Dead Cells",
       "reason":"Skill-based, hardcore and replayable, the exact loop that kept you hooked on Hades.",
       "in_library":true,"affinity":0.876,"tags":["2D Pixel Art","Hand-drawn Animation","Hardcore"],…}]}
data: {"type":"message","text":"Dead Cells it is — the same hard-but-fair loop that made Hades stick."}
data: {"type":"done"}
```

### Running the Worker yourself

```bash
cd worker
npm install
npx wrangler secret put QLOO_API_KEY     # hackathon key; without it the agent answers from fixture.ts
npx wrangler secret put LLM_API_KEY      # DeepSeek (or any OpenAI-compatible provider)
npm run deploy
```

`wrangler.toml` selects the model: `LLM_PROVIDER=openai-compatible` with `LLM_BASE_URL` / `LLM_MODEL`
(default DeepSeek `deepseek-chat`), or `LLM_PROVIDER=workers-ai` to use Cloudflare's Llama 3.3 with no
key. `npx wrangler dev --port 8788` runs it locally; put the secrets in `worker/.dev.vars`.

## Monetization

Free: 10 games, 1 card style. Pro (`pro` entitlement): unlimited list, more card styles. Scout is free
for everyone. Debug builds have a "Simulate Pro" toggle in Settings.

## Data

Game metadata © [IGDB](https://www.igdb.com). Taste data for Scout by [Qloo](https://www.qloo.com).
Attribution links live in Settings → About.
