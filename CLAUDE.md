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

## Arrival Tracking / Live ADS-B ETA (added October 2026)

Dispatch cards show Arrival as well as Departure, a live countdown to arrival
for `Planned` flights, and time-on-ground plus a departure countdown for `In`
flights. QT's `TimeOnGround` field is the *scheduled* turn
(`DepartureDate − ArrivalDate`, present on Planned flights too), not elapsed
time, so elapsed is computed client-side from `ArrivalDate`. Inbound ETAs are
enriched by `/api/flight_track` using adsb.lol — chosen over airplanes.live
(its API is now gated behind emailing them for access) and FlightRadar24
(the real API is a separate paid product from the personal subscription
already in use).

adsb.lol is free, keyless and has no SLA, and the page polls every 30s from
several clients at once, so the endpoint makes one shared 250nm point-query
around KMSO per 60s window (not per tail, not per client), cached in memory
and in the `adsb_point_cache` Supabase table across cold starts, and falls
back to stale cache or an empty result on failure. When a tail isn't in ADS-B
range (most of a flight's transit), the card just shows QT's own time with no
`live` badge.

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
