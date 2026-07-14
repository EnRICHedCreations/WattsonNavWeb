# Wattson Navigator — Web (PWA)

Browser-based companion to the Android app, sharing the same Supabase backend
for group rides — a rider on the web app and a rider on the Kotlin app can
join the same group session.

**Read this before going further:** there is no web equivalent to the Android
app's foreground service. Browsers suspend JavaScript when a tab is
backgrounded or the screen locks, so this app cannot track position in the
background the way the native app does. It works well with the screen on and
the tab active; navigation tracking pauses the moment that's not true. This
is a platform limitation, not a bug to be fixed later.

## Stack

- Vite + React + TypeScript
- MapLibre GL JS 5.x — map rendering (note: ESM-only distribution, always
  `import * as maplibregl from 'maplibre-gl'`, never a default import)
- `@supabase/supabase-js` — group ride sessions, same tables as the Android app
- IndexedDB (via `idb-keyval`) — local caching, mirrors the Android app's Room cache
- Web Speech API (`SpeechSynthesis`) — voice guidance
- `vite-plugin-pwa` (Workbox) — service worker, offline app-shell caching, installability

## First-time setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in `VITE_ORS_API_KEY`,
   `VITE_NLR_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. **Read
   the security note in `.env.example` first** — unlike the Android app,
   these keys are plainly visible to anyone who opens devtools on this site.
   You can reuse the same Supabase project as the Android app to share group
   rides across platforms; run `supabase/group_rides.sql` from that project
   if you haven't already.
3. `npm run dev`

## Running tests

```
npm test
```

## Project status

**Batch 6 — group rides, feature-complete.** This is the batch I was most
careful about, having watched the equivalent Android batch cost many rounds
of real debugging. Every lesson from that got applied up front instead of
rediscovered:

- **RLS policies are already solved.** If this shares the Android app's
  Supabase project, `supabase/group_rides.sql`'s `realtime.messages` policies
  already cover this — no new migration needed.
- **Listener-before-subscribe ordering** isn't a footgun here the way it was
  on the Kotlin side — `supabase-js`'s idiomatic `.on().on().subscribe()`
  chaining pattern makes the correct order the *only* way to use the library
  normally.
- **Presence flicker is avoided architecturally, not patched after the
  fact.** `supabase-js` exposes a `sync` event backed by `presenceState()`
  returning full reconciled state, rather than raw join/leave diffs to
  accumulate manually — this was the actual root cause of the flicker bug
  on Android, and it's just not reachable here by construction.
- **Teammates render as `maplibregl.Marker` DOM elements**, identical
  technique to the puck — never touches the native-layer icon-image path
  that caused the confirmed, unexplained rendering bug on the Android side.
- **Camera UX matches the Android app's final design**: Recenter is always
  self-only; a separate one-shot **Show Team** button fits bounds around
  everyone. Starting or joining a group ride auto-starts navigation, since
  presence only broadcasts while actively navigating.

**Cross-platform by construction, not by luck:** `groupRideRepository.ts`'s
JSON shape for the stored route matches `RideRouteJson.kt` field-for-field —
same key names, same nesting, same `[lat, lon]` point ordering. A trip
planned on the Android app and one planned here produce byte-for-byte
compatible `route_json` payloads, so a leader on either platform can be
joined by a follower on the other.

New files: `lib/supabase/client.ts`, `lib/db/riderIdentity.ts`,
`lib/repository/groupRideRepository.ts`, `GroupRideControls.tsx`, plus
teammate-marker and group-ride-UI additions to `MapView.tsx`/`App.tsx`.

**What's genuinely still unverified**, stated plainly rather than assumed
away: none of this has been run against a live Supabase project from this
environment. The API usage is sourced directly from `@supabase/realtime-js`'s
own README rather than guessed, which is a meaningfully higher confidence
level than most of the Android group-ride code started with — but "matches
the docs" and "works against your actual project" are still two different
claims until you've run it.

## Batch plan — complete

1. ~~Scaffold: Vite/PWA config, GeoMath port~~
2. ~~Map screen — MapLibre GL JS, OpenFreeMap tiles, geolocation puck~~
3. ~~Routing/pitstop logic — API clients, PitstopPlanner port, IndexedDB caching~~
4. ~~Navigation UI — turn-by-turn banner, route overview, search~~
5. ~~Settings & trip history — IndexedDB-backed~~
6. ~~Group rides — Supabase Realtime, shared schema with the Android app~~

## Known gaps versus the Android app

- **No background tracking** (stated since Batch 1 — fundamental platform
  limit, not something later batches change)
- **CORS**: confirmed working for ORS in practice; NLR/OpenChargeMap/Overpass
  still unverified against a real deployment
- **No voice guidance, no rider photo** — text-only display name for now
- **No real device/production testing of the group ride flow yet**

## Known limitations (see also the Android app's own list)

- No background tracking (see above) — the core platform gap versus the native app
- API keys are client-visible (see `.env.example`)
- **CORS is unverified for all four external APIs** (ORS, NLR, OpenChargeMap,
  Overpass). The Android app never had to care about this — native HTTP
  clients aren't subject to browser CORS policy. If any of these don't send
  permissive CORS headers, requests will fail in the browser console with a
  CORS error that's easy to mistake for a code bug. This needs verifying on
  a real deployed origin before relying on it; a failure here isn't
  something `fetch`'s error handling alone can work around — it would need
  a small serverless proxy in front of whichever API blocks direct browser access.
- No offline map tiles beyond what Workbox has already cached from browsing
- Placeholder icon only (`public/favicon.svg`) — real 192/512px PNGs (plus a
  maskable variant) needed before genuine install/deployment testing
