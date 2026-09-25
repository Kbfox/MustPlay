# MustPlay

Your gaming bucket list. Save the games you must play, put them in order, mark them done, rate
them, and share a card. iOS 17+, SwiftUI + SwiftData.

Built for [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com/).

## Layout

```
project.yml                     XcodeGen spec → run `xcodegen generate` after editing
Config/                         xcconfig; Secrets.xcconfig is gitignored (see .example)
MustPlay/
  App/                          entry point, AppDelegate (OneSignal), AppConfig (Info.plist keys)
  Models/BucketGame.swift       SwiftData model
  Services/                     IGDBClient (via Worker), PurchaseManager (RevenueCat),
                                NotificationManager (OneSignal + local), ImageLoader
  Views/                        RootView → BucketListView → GameDetailView → CompleteSheet / ShareCardSheet
                                SearchView, PaywallSheet, SettingsView
OneSignalNotificationServiceExtension/
worker/                         Cloudflare Worker that proxies IGDB (keeps the Twitch secret server-side)
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

## Monetization

Free: 10 games, 1 card style. Pro (`pro` entitlement): unlimited list, more card styles, iCloud sync,
widget. Debug builds have a "Simulate Pro" toggle in Settings.

## Data

Game metadata © [IGDB](https://www.igdb.com). Attribution link lives in Settings → About.
