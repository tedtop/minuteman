# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a single-page HTML application called "Fuel Dispatch Monitor" that provides a web interface for monitoring fuel dispatch operations for aircraft. The application is designed to integrate with QT Technologies' aviation fuel dispatch API.

## Architecture

- **Single-file application**: The entire application is contained in `fuel_dispatch_app.html`
- **Frontend-only**: Pure HTML, CSS, and JavaScript with no build system or dependencies
- **API Integration**: Designed to connect to QT Technologies' fuel dispatch API endpoints
- **Authentication**: Uses username/password authentication with company location ID and user ID
- **Real-time monitoring**: Implements polling-based data refresh every 30 seconds

## Key Components

### Authentication System
- Located in the `authenticate()` function using environment variables
- Automatically authenticates on page load using credentials from .env file
- Attempts QT portal login first, falls back to direct API access if needed
- Uses session-based authentication with cookies

### Data Fetching
- Main data retrieval in `fetchDispatchData()` function (fuel_dispatch_app.html:397)
- Makes actual API calls to QT Technologies GetDispatchDetail endpoint
- Uses session-based authentication with CORS and credentials: 'include'

### UI Components
- Responsive dispatch cards showing flight information
- Real-time status indicators (connected/disconnected/connecting)
- Form-based authentication interface
- Grid layout for multiple dispatch entries

## Development Notes

### Running the Application
- Install Node.js dependencies: `npm install`
- Start the proxy server: `npm start`
- Open http://localhost:3000/fuel_dispatch_app.html in browser
- Application automatically authenticates and loads data
- Proxy server handles CORS restrictions and API authentication

### API Integration
- Uses local proxy server at http://localhost:3000 to bypass CORS
- Proxy forwards requests to https://go.qttechnologies.com
- Login endpoint: `/api/login` (proxied to QT portal)
- Dispatch endpoint: `/api/dispatch` (proxied to GetDispatchDetail)
- Real API response structure defined in `dispatches_with_change.json`

### Configuration
- Poll interval: 30 seconds (configurable via POLL_INTERVAL env var)
- Credentials loaded from environment variables (see .env.example)
- Company location ID and user ID loaded from .env file
- Authentication token storage in memory (not persistent)

### Key Functions
- `authenticate()`: Handles user authentication
- `fetchDispatchData()`: Retrieves dispatch information
- `displayDispatchData()`: Renders dispatch cards
- `startMonitoring()`/`stopMonitoring()`: Controls automatic data refresh

## PWA Service Worker Caching
`public/sw.js` precaches the app shell (`fuel_dispatch.html`, `common.css`,
`manifest.json`) under `CACHE_NAME` and serves them **cache-first** —
`caches.match(event.request) || fetch(...)`. This means once a file is
cached, installed PWAs keep serving that exact version forever, even after a
new deploy, until `CACHE_NAME` changes (which triggers `cache.addAll` again on
`install` and deletes the old cache on `activate`).

**Bump `CACHE_NAME` once, right before a production deploy that includes
changes to `fuel_dispatch.html`, `common.css`, or `manifest.json`** — not on
every local commit. Only what's live when you actually deploy matters to
installed PWAs, so bumping per-commit during local iteration just churns the
value pointlessly; a single bump covering everything since the last deploy is
enough.

Instead of a sequential version number, suffix `fuel-dispatch-` with a short
random hex string (e.g. `fuel-dispatch-685d8cb3`, 8 hex chars from a UUID) —
there's nothing to track or keep in sync, just generate a fresh one each time
a bump is needed. Forgetting the bump entirely is the real risk — it's a
recurring source of "stale shell" bugs (e.g. old API endpoints, missing UI
elements) on phones that have the app added to the home screen.

## Fuel Farm Enhancements (TODO)
- **Enhanced Tank Level Visual Indicators**: Make tank level displays prettier with color-coded zones:
  - Red zones for unusable fuel areas (below usable minimum)
  - Yellow zones for caution/overflow situations (above usable maximum)
  - Green zones for normal operating ranges (usable fuel levels)
- **Fuel Quantity in Gallons**: Add display of actual fuel quantity in gallons using conversion tables
  - Parse conversion chart images from repository
  - Implement inches-to-gallons lookup for each tank
  - Display both inches and gallons on tank cards
- **Mobile-Friendly Level Input**: Consider implementing a scrolling level selector for mobile devices
  - Current numeric keyboard works but could be enhanced with a dial/slider interface
  - Would provide better mobile UX for selecting tank levels
  - Could include preset common values or increment/decrement buttons