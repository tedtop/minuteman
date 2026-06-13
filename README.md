# Minuteman Fuel Dashboard

Serverless web app for monitoring fuel dispatch operations and fuel farm tank levels at KMSO. Runs on Vercel with a Supabase backend.

## Local Development

**Prerequisites:** Node.js 18+, Vercel CLI (`npm i -g vercel`)

```bash
npm install
cp .env.example .env.local   # fill in credentials
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

# Push notifications (optional)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=...
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

Environment variables are managed in the Vercel dashboard (Project Settings → Environment Variables). After adding or changing a variable, redeploy for it to take effect.

## Project Structure

```
api/                        # Vercel serverless functions
  config.js                 # Serves env vars to the client
  dispatch.js               # QT Technologies dispatch proxy
  metar.js                  # KMSO METAR proxy
  fuel_density.js           # Fuel density readings
  subscribe-push.js         # Push notification subscriptions
  dispatch-push.js          # Sends push on dispatch changes
  fuel_farm/
    tanks.js                # Tank level reads/writes
    tank-history.js         # Historical readings for Jet A trend chart
public/                     # Frontend
  fuel_dispatch.html
  fuel_farm.html
  common.css
  weather-widget.js
  gallons-tables.js         # Inches → gallons lookup tables
schema/                     # Reference docs and DB schema
  supabase-schema.sql
  SUPABASE_SETUP.md
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | App configuration |
| POST | `/api/dispatch` | QT dispatch data |
| GET | `/api/metar` | KMSO weather |
| GET/POST | `/api/fuel_density` | Fuel density readings |
| GET/POST | `/api/fuel_farm/tanks` | Tank levels |
| GET | `/api/fuel_farm/tank-history` | Historical tank readings |
| POST | `/api/subscribe-push` | Register push subscription |

## Push Notifications

Push notification code exists (`subscribe-push.js`, `dispatch-push.js`, `shared-store.js`, `test-push.js`) but doesn't work reliably in practice — delivery is inconsistent and the subscription store is in-memory, so it resets on every cold start. The UI button to send a test notification is hidden. The code is kept as a starting point for future experimentation if this is ever worth revisiting.

## Debugging

- Client errors: browser console
- Server errors: terminal running `vercel dev`
- API calls: browser DevTools → Network tab
- Never commit `.env.local` or secrets
