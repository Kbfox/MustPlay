# Devpost — Qloo Agentic Hackathon submission: MustPlay Scout

Fill the Devpost form from the sections below. Everything is in English (rules require it).
Standard Devpost fields first, then the hackathon-specific ones we expect (adjust if the form differs).

---

## Project name
MustPlay Scout

## Tagline (≤ 60 chars)
A taste agent that picks your next game from your own pile.

## Built with (tags)
swift, swiftui, swiftdata, cloudflare-workers, typescript, qloo, deepseek, igdb, revenuecat, onesignal

## Links
- Live demo (App Store, free, iOS 17+; Scout ships in 1.1.0, live since 14 Oct 2026): https://apps.apple.com/app/id6816116027
- Public repo (MIT): https://github.com/Kbfox/MustPlay
- Privacy policy: https://kbfox.github.io/mustplay-site/privacy.html

## Image gallery (upload in this order, 1179×2556 PNG, no device frame)
1. Scout intro with the four prompts
2. "Pick from my pile" result card with reason
3. "Find me something new" — three cards with Add to list
4. Taste profile card
5. Post-credits pairing (film + album) after a completion
6. Shareable taste poster

---

## About the project (Markdown body)

### Inspiration

Every gamer I know has the same problem: a backlog of twenty games and no idea which one to start. Steam's own numbers say roughly half of all purchased games are never launched. The "What next?" feature in MustPlay 1.0 picked randomly, and it worked — people liked having the decision made for them — but it had no idea *why* one game would fit better than another.

Agents are good at reasoning and terrible at taste. Ask an LLM what to play after Hades and you get the same five names everyone gets. What I wanted was an agent that knows what *this* player loves, and can say why a pick fits in words grounded in real data rather than vibes. That's exactly what Qloo's taste graph is for.

### What it does

Scout lives inside MustPlay, a shipped iOS gaming bucket-list app (App Store, October 2026). It reads the games you finished and rated highly, resolves them to Qloo entities, and asks Qloo's taste graph of 250M+ entities what fits. Four things it does that only work because of Qloo:

1. **Pick from my pile.** Ranks your *own* Want list against your loved games. Not "games like X" from the whole internet — the specific pile you already own, ordered by Qloo affinity, with a reason that names the shared tags and the game it connects to.
2. **Find me something new.** Taste-grounded discovery with natural-language constraints ("short and cozy, on Switch"). Constraints become Qloo tag filters; platforms and years are filtered locally; results come back with IGDB covers and a one-tap Add to list.
3. **What's my taste?** Qloo taste analysis over your loved games, rendered as a profile card and a shareable 1080×1920 poster with your top covers.
4. **Post-credits pick.** Finish a game and Scout pairs it with a film and an album via Qloo's cross-domain recommendations. Hades → *Everything Everywhere All at Once* and Kero Kero Bonito. No other API does this.

Every reason cites tags returned by Qloo. Scout is free for all users; nothing is gated.

### How I built it

- **iOS (SwiftUI, SwiftData, iOS 17+)**: `ScoutView` chat sheet with four quick prompts and free text, streaming cards over SSE; `TasteShareCard` poster rendered with ImageRenderer; Qloo entity ids cached on the game model so repeat questions skip resolution.
- **Cloudflare Worker (TypeScript)**: `POST /agent` runs a tool loop. The model (DeepSeek via an OpenAI-compatible API; Workers AI is a one-line fallback) gets five tools and decides the order:
  - `qloo_resolve` → `GET /search?types=urn:entity:videogame` (normalised title match, exact-name first)
  - `qloo_recommend` → `GET /v2/insights` with `signal.interests.entities`, optional `filter.tags`, `feature.explainability=true`; same-domain and cross-domain (`filter.type=urn:entity:movie|artist|book`)
  - `qloo_tags` → `GET /v2/tags` plus synthesised game-tag ids (`urn:tag:category:qloo:<slug>`) validated with a one-result insights call, because the tag search endpoint is weak for games
  - `qloo_taste` → `GET /v2/insights?filter.type=urn:tag&filter.parents.types=urn:entity:videogame&filter.tag.types=…`
  - `igdb_lookup` → covers, platforms and IGDB ids for anything Qloo recommends
  - plus `show_games` / `show_taste` / `show_crossover` to render cards. The Worker enforces that `show_taste` can only follow a real `qloo_taste` call, that reasons come after tool results, and that no card is shown without a resolvable title.
- **Guardrails**: canned prompts refuse to run without seeds (no 4★+ games yet, empty Want pile) and say what to do instead; tag filters fall back to tag *signals* and then drop with an honest note; Qloo responses are memoised in the isolate (the Cache API counts against the 50-subrequest budget).

### What Qloo made possible (and what I learned about the API)

- Coverage is excellent for games: 23 of 24 common titles resolved to an exact entity; the 24th was a diacritic.
- Game entities carry rich tag types (`category`, `gameplay_type`, `emotional_tone`, `audience`, `art_style`, `skill_level`), which is what makes "Hand-drawn, challenging, tight controls — the same brutal, rewarding lane as Celeste and Hades" possible without the model inventing anything.
- Cross-domain affinity from game seeds to films, artists and books is real and often delightful (Lore Olympus for Hades fans).
- Taste analysis needs `filter.parents.types` and `filter.tag.types` to stay on-topic; without them you get keyword noise.
- `filter.release_year` is ignored for games (filtered locally); `urn:tag:genre:media:*` ids match nothing for games, so constraints are built from `urn:tag:category:qloo:*` and friends.

### Challenges

- Making the agent *agentic* without letting it hallucinate: tool outputs are the only source of tags and titles, and the Worker post-validates every card.
- Llama 3.3 on Workers AI produced thin reasons and blew through the free daily budget in an afternoon of testing; switching to DeepSeek through the same OpenAI-compatible adapter fixed both.
- The hackathon guide says `urn:entity:video_game`; the API only accepts `urn:entity:videogame`. Logged in the repo's `docs/qloo-api-notes.md` with every other verified shape.

### Accomplishments

A shipped app got a genuinely new capability in two weeks, with Qloo as the differentiator rather than a decoration. The post-credits pairing is the thing people screenshot.

### What's next

Weighted signals (5★ counts more than 4★), a "why not?" follow-up that explains what was ruled out, and Scout-driven push nudges ("Three games in your pile fit your Celeste streak").

---

## What changed since September 30 (rules require this for existing projects)

MustPlay 1.0 (submitted to the App Store on 26 Sept, live 12 Oct) had no Qloo integration and no agent. Everything Scout-related was built after 12 Oct 2026 and ships in 1.1:

- Worker: `worker/src/agent.ts`, `qloo.ts`, `llm.ts`, `fixture.ts`, `env.ts`; `index.ts` rewritten in TypeScript with `POST /agent`
- iOS: `Services/ScoutClient.swift`, `Views/ScoutView.swift`, `Views/TasteShareCard.swift`; `BucketGame.qlooEntityID`; "Ask Scout" entry on the list; post-credits hand-off after completion
- Docs: `docs/qloo-hackathon-plan.md`, `docs/qloo-api-notes.md`; privacy policy and terms updated for Scout
- Git history from 12 Oct onward shows the full sequence.

## Testing instructions for judges

1. Install MustPlay from the App Store on an iPhone (iOS 17+): https://apps.apple.com/app/id6816116027 (free; Scout is in 1.1.0).
2. Tap **+** and add a few games you have finished; open each, mark **Completed** and rate 4–5 stars. Then add two or three games you mean to play (they stay in "Want to Play"). Two minutes is enough.
3. Tap **Ask Scout** on the list and try all four prompts. Free text works too: "something like Hollow Knight but shorter".
4. Complete any game to see the post-credits pairing.

No account or sign-in. Scout is free. Each answer takes 5–15 seconds.

Curl access for judges who prefer the API (same Worker the app uses; a request body example is in the README):

```
curl -N -X POST https://mustplay-igdb.kbfoxtk.workers.dev/agent \
  -H 'content-type: application/json' \
  --data '{"intent":"pick","messages":[{"role":"user","content":"What next?"}],
           "library":[{"igdb_id":1,"name":"Hades","status":"completed","rating":5},
                      {"igdb_id":2,"name":"Celeste","status":"completed","rating":5},
                      {"igdb_id":3,"name":"Dead Cells","status":"wantToPlay"},
                      {"igdb_id":4,"name":"Unpacking","status":"wantToPlay"}]}'
```
