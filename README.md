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

**Batch 4** — full navigation UI, wired end-to-end. `useNavigation` is the
central hook (direct port of `NavViewModel`): search, planning, starting/
stopping navigation, step tracking, off-route rerouting, and arrival
detection, all against the Batch 3 data layer. `MapView` became presentational
(driven entirely by props) and now renders the route line and pitstop
markers using plain `line`/`circle` GL layers — the same static-property
layer types that worked reliably on the Android side, deliberately avoiding
the data-driven `icon-image` pattern that caused the rendering bug there.
Pitstops are clickable via MapLibre's standard `map.on('click', layerId, ...)`
pattern.

New UI: `SearchBar` (reused for both starting point and destination),
`ChargeIntervalControl`, `ChargeStationFilterControl`, `RouteOverviewSheet`,
`TurnInstructionBanner`, `NextPitstopChip`, `PitstopInfoCard`, `ControlsPanel`.

State management uses a small custom store hook (`useStore`) rather than
plain `useState` — `NavViewModel`'s logic reads/writes state from async
callbacks (geolocation updates, network responses) where React's normal
closure-captured state would go stale; `useStore` exposes a `stateRef.current`
that's always current, mirroring `MutableStateFlow.value`/`.update{}`.

**Not built yet**: settings/trip-history persistence (state resets on reload
right now — no IndexedDB-backed settings yet, despite the cache module from
Batch 3 already existing for charge points specifically), voice guidance,
rider profile, group rides.

## Batch plan

1. ~~Scaffold: Vite/PWA config, GeoMath port~~ (Batch 1)
2. ~~Map screen — MapLibre GL JS, OpenFreeMap tiles, geolocation puck~~ (Batch 2)
3. ~~Routing/pitstop logic — API clients, PitstopPlanner port, IndexedDB caching~~ (Batch 3)
4. ~~Navigation UI — turn-by-turn banner, route overview, search~~ (this batch)
5. Settings & trip history — IndexedDB-backed, mirrors DataStore/Room behavior
6. Group rides — Supabase Realtime Presence/Broadcast, shared schema with
   the Android app (highest-risk batch, same as it was on the Kotlin side)

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
