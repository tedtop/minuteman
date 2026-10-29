# Minuteman Fuel Dashboard

Serverless web app for monitoring fuel dispatch operations and fuel farm tank levels at KMSO. Runs on Vercel with a Supabase backend.

## Local Development

**Prerequisites:** Node.js 18+, Vercel CLI (`npm i -g vercel`)

```bash
npm install
vercel env pull .env.local   # pulls credentials from Vercel (source of truth)
npm run dev                  # http://localhost:3000
```

- Fuel Dispatch: http://localhost:3000/fuel_dispatch
- Fuel Farm: http://localhost:3000/fuel_farm

## Environment Variables

```bash
# QT Technologies
QT_COMPANY_LOCATION_ID=your_company_location_id
QT_USER_ID=your_user_id

# Supabase
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Deploy

**Local** (`http://localhost:3000`):
```bash
npm run dev
```

**Preview** (temporary Vercel URL for testing before going live):
```bash
vercel
```

**Production**:
```bash
vercel --prod
```
Or push to `master` — Vercel auto-deploys on every commit.

Environment variables are managed in the Vercel dashboard (Project Settings →
Environment Variables) — **that's the single source of truth**, not
`.env.local`. If a credential changes (e.g. QT forces a password reset),
update it in Vercel (both Development and Production) via the dashboard or
`vercel env add <NAME> <environment>`, then run `vercel env pull .env.local`
to resync your local copy. After adding or changing a variable, redeploy
(`vercel --prod` or push to `master`) for Production to pick it up —
`vercel dev` picks up Development env vars on restart without a deploy.
Editing `.env.local` directly works for local-only experiments but will be
silently overwritten/out of sync with what `vercel dev` actually uses next
time someone runs `vercel env pull`.

## Project Structure

```
api/                        # Vercel serverless functions
  config.js                 # Serves env vars to the client
  dispatch.js               # QT Technologies dispatch proxy
  metar.js                  # KMSO METAR proxy
  fuel_density.js           # Fuel density readings
  fuel_farm/
    tanks.js                # Tank level reads/writes
    tank-history.js         # Historical readings for Jet A trend chart
public/                     # Frontend
  fuel_dispatch.html
  fuel_dispatch.css
  fuel_farm.html
  fuel_farm.css
  common.css
  weather-widget.js
  gallons-tables.js         # Inches → gallons lookup tables
schema/
  supabase-schema.sql       # Run against a fresh Supabase project to recreate the DB
  dispatches_with_change.json   # Sample QT GetDispatchDetail response, for reference
  dispatch_change_injections.js # Console snippets for exercising MEL/change banners locally
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | App configuration |
| POST | `/api/dispatch` | QT dispatch data |
| GET | `/api/flight_track` | Live ADS-B arrival tracking (adsb.lol) |
| GET | `/api/metar` | KMSO weather |
| GET/POST | `/api/fuel_density` | Fuel density readings |
| GET/POST | `/api/fuel_farm/tanks` | Tank levels |
| GET | `/api/fuel_farm/tank-history` | Historical tank readings |
| GET/POST | `/api/fuel_farm/gravity` | Fuel load gravity QC readings + mixed T2-T7 running average |

## Debugging

- Client errors: browser console
- Server errors: terminal running `vercel dev`
- API calls: browser DevTools → Network tab
- Never commit `.env.local` or secrets
