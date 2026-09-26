# App Review reply — Guideline 2.1 Information Needed (2026-09-26)

Paste the block below into (a) the Resolution Center reply and (b) App Review Information → Notes.
Attach the physical-device screen recording to the Resolution Center reply.

---

Thank you for the review. Answers to each item are below. A screen recording captured on a physical iPhone running the latest iOS is attached.

**1. Screen recording**
Attached. Recorded on a physical iPhone. It starts with launching the app and shows the typical flow: browse the list → search a game (IGDB) → add it → open details → Mark as Completed → rate with stars and a one-line note → completion celebration → share card → tap a Pro card style (Poster) to open the paywall. The paywall shows the title, length and price of every subscription (MustPlay Pro Yearly $9.99/year with 7-day free trial, MustPlay Pro Monthly $1.99/month) and the Lifetime non-consumable ($19.99), plus working links to Terms of Use and Privacy Policy and a Restore Purchases button. The app has no accounts, so there is no registration, login or account deletion. There is no user-generated content shared between users: notes and ratings are private and stored only on the user's device.

**2. Purpose and target audience**
MustPlay is a personal "games bucket list". Players hear about games they want to play far faster than they can play them; the list ends up scattered across notes apps and screenshots. MustPlay lets a player save a game the moment they hear about it, keep the list in one place (Want to play / Playing / Completed), pick what to play next when they can't decide, and mark a game completed with a rating and a one-line memory, then share a completion card. Target audience: adult and teen gamers (rated 12+) who play on any platform. It is a single-user utility; there is no social network, chat or community.

**3. Setup and access**
No login, credentials or sample files are required. Launch the app → tap the "+" / search field → type any game title (e.g. "Hades", "Silksong") → tap a result to add it. Tap a list row to open details. "Mark as Completed" opens the rating sheet. When two or more already-released games are in "Want to play", a "What next?" card appears at the top of the list. Settings (gear icon) contains Restore Purchases, Terms and Privacy links. The free tier allows 10 games; adding an 11th opens the paywall (see item 7).

**4. External services**
- IGDB (Twitch) — game metadata and cover art, accessed through our own Cloudflare Worker proxy (https://mustplay-igdb.kbfoxtk.workers.dev) so no Twitch credentials ship in the app. Read-only.
- RevenueCat — In-App Purchase management and paywall rendering (StoreKit purchases are processed by Apple).
- OneSignal — push notifications (optional; permission is requested only after the user adds their first game). Used for reminders only, no marketing to third parties.
- Apple frameworks: SwiftUI, SwiftData (local storage), StoreKit via RevenueCat, UserNotifications.
No authentication provider, no analytics SDK, no AI service, no ads.

**5. Regional differences**
None. The app functions identically in all regions. Prices are localized by the App Store. UI is English only.

**6. Regulated industry / protected material**
The app is not in a regulated industry. Game titles, release dates and cover images are supplied by IGDB under its API terms (https://api-docs.igdb.com/#terms-of-use), which permit use in commercial apps with attribution; IGDB is credited in Settings → About ("Game data: IGDB"). We do not host or redistribute the images; they are loaded on demand from IGDB's CDN. No other third-party material is included.

**7. In-App Purchases**
All three products unlock the same "Pro" entitlement:
- MustPlay Pro Yearly — auto-renewable subscription, $9.99/year, 7-day free trial
- MustPlay Pro Monthly — auto-renewable subscription, $1.99/month
- MustPlay Pro Lifetime — non-consumable, $19.99 one-time
Pro removes the 10-game limit and unlocks the Poster, Retro and Minimal share-card styles. How to reach the purchase flow: (a) add an 11th game to the list, or (b) open any game's details → Mark as Completed → on the share card, tap a locked style (Poster / Retro / Minimal), or (c) Settings → MustPlay Pro → "Go Pro". The paywall lists all three products with price and duration, the Terms of Use and Privacy Policy links, and Restore Purchases. Subscriptions can be managed or cancelled in the App Store subscription settings.

Contact for any follow-up: the App Review contact listed in App Store Connect.
