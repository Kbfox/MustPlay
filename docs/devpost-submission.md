# Devpost submission draft — MustPlay (RevenueCat Shipaton 2026)

Registration must be done by the account owner (last name, country, agree to rules).
After registering: My projects → Create project → fill the fields below.

## Project name
MustPlay

## Tagline (≤ 60 chars)
Your gaming bucket list. Save, play, finish, share.

## App Store URL
(fill after approval) https://apps.apple.com/app/id6816116027

## Video
https://youtube.com/shorts/NfvZZCujkQU?feature=share

## Icon
MustPlay/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png

## Screenshots (1179×2556, no frame)
~/Desktop/mustplay-screenshots/devpost-1179x2556/01-home.png … 05-paywall.png

## Testing / promo
Pro yearly plan has a 7-day free trial, so judges can unlock every premium feature without a code. Promo codes will be added here once App Store Connect allows generating them (after approval).

## Categories to select
- Influencer Award — Gaming (Mr Lewis Blogs Gaming)
- RevenueCat Design Award
- HAMM Award
- Keep Them Coming Back Award — OneSignal (only if a Journey with a Push node is live before 09-30; otherwise do NOT select)

## Description (main "About the project")

### Inspiration
Every gamer has a backlog and nowhere good to keep it. Notes apps forget the cover art, storefront wishlists only work for one store, and tracker sites feel like spreadsheets. I wanted the "someday I'll play that" list to feel like a bucket list: something you enjoy looking at, and something that celebrates you when you cross an entry off.

### What it does
MustPlay is a gaming bucket list for iPhone. The whole app is built around five verbs:

- **Save** — search any game (IGDB catalogue, 300k+ titles, cover art included) and add it in two taps, right at the moment you hear about it.
- **Organize** — every game is Want to Play, Playing or Completed. Filter chips at the top, "Day N" counters on games you are playing, and a swipe to remove.
- **Complete** — mark a game done and MustPlay throws a small celebration: the cover pops, a COMPLETED stamp slams down, confetti falls. Milestones (1st, 5th, 10th, 25th, 50th, 100th completion) get their own line.
- **Rate** — 5 stars plus "one line for future you", so the list becomes a diary of what each game meant, not just a checkbox.
- **Share** — every completion produces a share card with the cover, stars, quote and date. Four styles: Dark (free), Poster, Retro and Minimal (Pro).

And one feature for the hardest part of a backlog, deciding: **What next?** Pick a mood (Surprise me / Waiting longest / A classic / Something new) and MustPlay rolls through your Want pile and lands on one game, with a single "Start playing" button.

### Monetization (RevenueCat)
Free tier: 10 games, Dark share card. MustPlay Pro: unlimited games and all share-card styles. Three packages in one RevenueCat offering: Yearly $9.99 with a 7-day free trial (default, "best value"), Monthly $1.99, Lifetime $19.99. The paywall is a RevenueCat Paywalls V2 template edited in the dashboard, so copy and pricing can change without an app update. It appears in two natural places: adding the 11th game, and tapping a locked share-card style. Entitlement `pro` gates everything. Apple server-to-server notifications are wired to RevenueCat.

### OneSignal
App ID: 507d16df-9c8c-4614-b2dc-3c680bc63705
Tags synced from the app: want_count, playing_count, completed_count, playing_since. Segments: "Playing 14d+", "Inactive 7d with backlog", "Milestone reached". Journey "Still playing? Rate it (14d)" nudges a user who has had the same game in Playing for two weeks to rate it or shelve it.
(Update this paragraph with what is actually live on submission day.)

### How I built it
SwiftUI + SwiftData, iOS 17+, XcodeGen project. Game data from IGDB through a Cloudflare Worker proxy that holds the Twitch credentials, so no secrets ship in the binary. RevenueCat SDK 5.x for purchases and the remote paywall; OneSignal SDK for tags and push. Share cards are rendered with ImageRenderer from the same SwiftUI views the app shows. The celebration is a Canvas-driven confetti system layered over a spring-animated cover.

### Challenges
- IGDB search ranking: a 1995 "Hades" outranked the 2020 one. Fixed by over-fetching and re-ranking locally by exact-title match, then rating count.
- Making a list app worth reopening. "What next?", Playing-day counters and completion milestones were all added after honest feedback that the first build was "just a list".
- Shipping solo on a compressed timeline: developer account activated 09-25, submitted for review 09-26.

### What's next
Release-day reminders for unreleased games on your list, iCloud sync, and a home-screen widget showing the game you are playing right now.

## Design Award blurb
Look at: the completion celebration (cover spring-in → stamp → confetti → automatic share sheet), the What next? roll animation, the four share-card styles (each a distinct typographic system: Dark, Poster, Retro, Minimal), and the custom large title that survives iOS 26 navigation. Everything is native SwiftUI with no third-party UI libraries.

## Influencer (Gaming) blurb
Entering the Gaming category (Mr Lewis Blogs Gaming). The brief was "save, organize, complete, rate, and share" and MustPlay maps one screen or gesture to each verb, with What next? added so managing a backlog feels like opening a present rather than doing chores.

## HAMM blurb
Free tier is generous enough to form the habit (10 games), the upgrade moment is the 11th game or the first share card the user is proud of. Yearly with a free trial is the anchor; Lifetime exists for people who hate subscriptions. Paywall is remotely editable through RevenueCat Paywalls, so pricing experiments need no release.
