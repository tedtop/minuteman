# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For setup, local dev, deploy commands, project structure, and the API endpoint
list, see `README.md` — this file only covers things Claude needs to know
that aren't already there.

## Project Overview

"Minuteman Fuel Dashboard" — a two-page web app for monitoring fuel dispatch
operations and fuel farm tank levels at KMSO. Vercel serverless functions
(`api/`) back two static frontend pages (`public/fuel_dispatch.html`,
`public/fuel_farm.html`), with Supabase (Postgres) for persistence. No
client-side framework or build step — plain HTML/CSS/JS served as static
files, each page having its own `<page>.css` alongside the shared
`common.css`.

## Architecture

- **`fuel_dispatch.html`**: polls `/api/dispatch` every 30s (`POLL_INTERVAL`)
  for live QT Technologies dispatch data. Key functions:
  `initializeSession()` (called on load — sets up session state from
  `/api/config`, no login step), `fetchDispatchData()`, `displayDispatchData()`,
  `startMonitoring()`/`stopMonitoring()`.
- **`fuel_farm.html`**: tank level tracking (`T1`–`T7`, `LF`) backed by
  `/api/fuel_farm/tanks` and `/api/fuel_farm/tank-history`. Tank
  configuration (capacities, usable min/max) lives in
  `api/fuel_farm/tanks.js`, not the database — only readings are persisted.
- **Auth**: there is no user-facing login. `/api/config` hands the client
  `QT_COMPANY_LOCATION_ID`/`QT_USER_ID`, and `api/dispatch.js` uses those to
  call QT's `GetDispatchDetail` directly — confirmed to work without a QT
  session cookie. `api/dispatch.js` does maintain its own server-side QT
  session (cached in the `qt_session` Supabase table) for the cases where QT
  does demand one; see the comments in that file for the login/cookie flow.
  `api/login.js` is unused dead code, deliberately kept on disk in case QT's
  behavior reverts.
- **Shared weather**: `public/weather-widget.js` renders the
  temperature/METAR panel on both pages and dispatches a `weather:update`
  window event; `fuel_dispatch.html` listens for it to drive the fuel
  density estimate.

## PWA Service Worker Caching

`public/sw.js` precaches the app shell (`fuel_dispatch.html`,
`fuel_dispatch.css`, `common.css`, `manifest.json`) under `CACHE_NAME` and
serves them **cache-first** — `caches.match(event.request) || fetch(...)`.
This means once a file is cached, installed PWAs keep serving that exact
version forever, even after a new deploy, until `CACHE_NAME` changes (which
triggers `cache.addAll` again on `install` and deletes the old cache on
`activate`). Note `fuel_farm.html`/`fuel_farm.css` are *not* precached —
only the dispatch page has offline support today (see Known Issues below).

**Bump `CACHE_NAME` once, right before a production deploy that includes
changes to any precached file** — not on every local commit. Only what's
live when you actually deploy matters to installed PWAs, so bumping
per-commit during local iteration just churns the value pointlessly; a
single bump covering everything since the last deploy is enough.

Instead of a sequential version number, suffix `fuel-dispatch-` with a short
random hex string (e.g. `fuel-dispatch-685d8cb3`, 8 hex chars from a UUID) —
there's nothing to track or keep in sync, just generate a fresh one each time
a bump is needed. Forgetting the bump entirely is the real risk — it's a
recurring source of "stale shell" bugs (e.g. old API endpoints, missing UI
elements) on phones that have the app added to the home screen.

## Fuel Farm Enhancements (TODO)
- **Enhanced Tank Level Visual Indicators**: color-code the tank fill zones —
  red for unusable fuel areas (below usable minimum), yellow for
  caution/overflow (above usable maximum), green for normal operating range.
  Not implemented yet; tank cards currently render as a single fill color.
- **Mobile-Friendly Level Input**: the level input is a plain
  `inputmode="decimal"` number field. Consider a dial/slider or
  increment/decrement buttons for better mobile UX.

## Known Issues / Notes

Found during an August 2026 cleanup pass, not yet acted on:

- **Unauthenticated API surface**: `/api/config` has no auth and returns
  `QT_COMPANY_LOCATION_ID`/`QT_USER_ID` to any caller; `/api/dispatch`
  accepts just those two IDs and proxies live QT dispatch data with no
  further credential. Anyone who finds the URL can `curl` live flight/fuel
  data. Likely an intentional simplicity tradeoff (the auth refactor
  explicitly dropped QT login), but worth a conscious decision — a shared
  bearer token or IP allowlist would close it cheaply if it ever matters.
- **`api/login.js` is dead code** — unused since `GetDispatchDetail` was
  found to work without a session cookie, kept on disk deliberately per its
  own header comment in case that ever changes.
- **`fuel_farm.html` has no offline/PWA support** — `sw.js` only precaches
  the dispatch page's shell. Decide if that's intentional (office display vs.
  mobile use) or an oversight worth fixing.
- **CORS header mismatch in `api/dispatch.js`**: sends
  `Access-Control-Allow-Origin: *` together with
  `Access-Control-Allow-Credentials: true` — browsers reject that
  combination per spec, so the credentials header is silently ignored.
  Harmless today since no cookies cross the browser boundary, but worth
  cleaning up so the headers reflect what's actually true.
