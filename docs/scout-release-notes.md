# MustPlay 1.1.1 — Scout learns what you don't like

## App Store "What's New" (en-GB)

Scout gets sharper:

• Why not? — after a pick, ask why another game in your pile lost. Scout shows which of its tags match your taste and which ones Qloo doesn't tie to the games you loved.
• Deep cuts — hidden gems in your lane that you've probably never heard of, badged "Under the radar".
• Games you rated 1–2 stars now teach Scout what to avoid.
• Every card says which of your own games it's closest to.
• 5-star games weigh more than 4-star ones when Scout reads your taste.
• Post-credits pairings now include series and podcasts.
• New here? "Tell Scout three games you loved" gets you started in a minute.

Scout stays free for everyone.

## App Review notes (App 审核信息 → 备注)

Version 1.1.1 extends Scout (the optional in-app assistant added in 1.1). Nothing changed in purchases; Scout is still free and needs no account. Same backend and privacy policy as 1.1 (https://kbfox.github.io/mustplay-site/privacy.html, "Scout recommendations"). To test: tap "Ask Scout" on the list → "Tell Scout three games you loved" (search any three games), then try "Pick from my pile", "Deep cuts" and the "Why not …?" chips under a pick. Each answer takes 6–15 seconds.

---

# MustPlay 1.1 — Scout

## App Store "What's New" (en-GB, ≤4000 chars)

Meet Scout, the taste agent inside MustPlay.

Scout reads the games you finished and loved, asks Qloo's taste graph of 250M+ titles, films and albums what fits, and answers with cards you can act on:

• Pick from my pile — ranks your Want list against what you actually loved and tells you why.
• Find me something new — games you'd never search for, with constraints like "short and cozy, on Switch".
• What's my taste? — a profile built from your finished games, as a shareable poster.
• Post-credits pick — finish a game and Scout pairs it with a film or an album.

Every reason cites real taste data, not guesses. Scout is free for everyone.

Also: Qloo credit in Settings, small fixes.

## App Review notes (App 审核信息 → 备注)

Version 1.1 adds "Scout", an optional in-app assistant reachable from the "Ask Scout" card on the main list and after completing a game. It is free and requires no account.

How it works: the app sends the user's question plus a snapshot of their list (game titles, status, star ratings, platforms, release years; no personal data, no identifiers) to our Cloudflare Worker. The Worker queries Qloo's Taste AI API (https://docs.qloo.com) for entity lookups and recommendations, uses an LLM (DeepSeek, OpenAI-compatible API) to phrase the answer, and streams cards back. Nothing is stored server-side beyond a short in-memory cache of Qloo responses. Our privacy policy (https://kbfox.github.io/mustplay-site/privacy.html, "Scout recommendations" section) and terms describe this.

To test: add a few games via +, mark one Completed with 4–5 stars (or use any list), tap "Ask Scout" → "Pick from my pile" / "Find me something new" / "What's my taste?". Each answer takes 5–15 seconds. The "Pair with a film" prompt appears after a game is completed.

Nothing changed in purchases: the 10-game free limit and Pro (RevenueCat) are unchanged. Scout itself is not gated.

## TestFlight "What to Test" (外部组 Public)

Scout — the new taste agent. Try all four prompts from "Ask Scout" and the post-credits pairing after completing a game. Tell us whether the picks make sense for your taste and whether any reason feels wrong.

## TestFlight Beta App Review 备注

Same as the App Review notes above. Sign-in not required.
