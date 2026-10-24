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

## No Service Worker (removed October 2026)

The app used to have a `public/sw.js` precaching the dispatch page's shell
cache-first for offline/PWA support. It was removed: both pages are useless
without a live connection (dispatch needs QT, fuel farm needs Supabase), so
there was never a real offline mode to support — only a recurring "stale
shell" bug where installed/previously-visited clients kept serving old
CSS/HTML until someone remembered to bump `CACHE_NAME` on deploy. That
bump-discipline requirement is gone along with the service worker.

`public/sw.js` still exists, but only as a one-time cleanup script: it
clears any caches it finds, unregisters itself, and reloads open tabs, so
that anyone with the old service worker already installed gets flushed back
to normal network requests. `fuel_dispatch.html` no longer registers it.
Once existing installs have had time to cycle through this (the old SW has
to actually run its `activate` handler once), `sw.js` and its `<link
rel="manifest">`/service-worker-adjacent bits can be deleted outright if the
PWA "add to home screen" affordance isn't worth keeping either.

## QT Password Rotation (considered, deferred)

QT periodically forces a password reset on the TTMSO account (happened
2026-10-24, caused a production outage). Today, recovering from this is
fully manual: reset the password at https://go.qttechnologies.com/ (or call
QT support per the troubleshooting doc if the account is locked), then
update `QT_PASSWORD` in Vercel (Development + Production env vars) and
redeploy for Production to pick it up.

We discussed building self-service recovery directly into the app: a shared
password gate on the dispatch/farm pages (reusing `QT_PASSWORD` itself,
since it's already posted physically near the line office computer — no
new exposure), plus an "Update QT Password" form that verifies the current
password and pushes the new one to Vercel via its API (needs a
`VERCEL_API_TOKEN` secret) and triggers a redeploy automatically. Deferred
for now — manually updating the Vercel env var and redeploying works fine
and is simple; revisit this if password rotations become frequent enough
that the manual process is a real burden.

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
- **CORS header mismatch in `api/dispatch.js`**: sends
  `Access-Control-Allow-Origin: *` together with
  `Access-Control-Allow-Credentials: true` — browsers reject that
  combination per spec, so the credentials header is silently ignored.
  Harmless today since no cookies cross the browser boundary, but worth
  cleaning up so the headers reflect what's actually true.
