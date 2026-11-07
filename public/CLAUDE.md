# public/CLAUDE.md

## No Service Worker (removed October 2026)

The app used to have a `sw.js` precaching the dispatch page's shell
cache-first for offline/PWA support. It was removed: both pages are useless
without a live connection (dispatch needs QT, fuel farm needs Supabase), so
there was never a real offline mode to support — only a recurring "stale
shell" bug where installed/previously-visited clients kept serving old
CSS/HTML until someone remembered to bump `CACHE_NAME` on deploy. That
bump-discipline requirement is gone along with the service worker.

`sw.js` still exists, but only as a one-time cleanup script: it clears any
caches it finds, unregisters itself, and reloads open tabs, so that anyone
with the old service worker already installed gets flushed back to normal
network requests. `fuel_dispatch.html` no longer registers it. Once existing
installs have had time to cycle through this (the old SW has to actually
run its `activate` handler once), `sw.js` and its `<link
rel="manifest">`/service-worker-adjacent bits can be deleted outright if the
PWA "add to home screen" affordance isn't worth keeping either.
