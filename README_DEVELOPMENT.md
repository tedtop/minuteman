# Minuteman Dashboard - Development Setup

## Overview
This application is designed to run on Vercel using serverless functions. For local development, we use the Vercel CLI to mimic the production environment exactly.

## Prerequisites

1. **Install Vercel CLI**:
   ```bash
   brew install vercel
   # or
   npm install -g vercel
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

## Environment Variables

Create a `.env.local` file in the project root with:

```bash
# QT Technologies Authentication
QT_USERNAME=your_username_here
QT_PASSWORD=your_password_here
QT_COMPANY_LOCATION_ID=your_company_location_id_here
QT_USER_ID=your_user_id_here


# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Development Commands

### Start Local Development Server
```bash
npm run dev
# or directly
vercel dev
```

This will:
- Start the Vercel development server on `http://localhost:3000`
- Run all serverless functions locally
- Auto-reload on file changes
- Mimic production environment exactly

### Access the Applications
- **Fuel Dispatch**: http://localhost:3000/fuel_dispatch
- **Fuel Farm**: http://localhost:3000/fuel_farm

### Deploy to Production
```bash
npm run deploy
# or
vercel --prod
```

## Project Structure

```
/
├── api/                     # Vercel serverless functions
│   ├── config.js           # App configuration endpoint
│   ├── login.js            # QT Technologies login proxy
│   ├── dispatch.js         # QT Technologies dispatch proxy
│   └── fuel_farm/
│       └── tanks.js        # Fuel farm tank operations
├── public/                 # Static files
│   ├── fuel_dispatch.html  # Fuel dispatch interface
│   └── fuel_farm.html      # Fuel farm interface
├── vercel.json             # Vercel configuration
└── .env.local              # Local environment variables
```

## API Endpoints

### QT Technologies Proxy
- `POST /api/login` - Authenticate with QT Technologies
- `POST /api/dispatch` - Get dispatch data from QT Technologies
- `GET /api/config` - Get application configuration

### Fuel Farm
- `GET /api/fuel_farm/tanks` - Get all tank levels
- `POST /api/fuel_farm/tanks` - Update a tank level

## Key Features

### Client-Side Authentication
- Each client handles its own QT authentication
- No server-side session management
- Resilient to browser refresh issues

### Fuel Farm Persistence  
- Tank levels stored in Supabase
- Tank configuration in application code
- Graceful degradation when database offline

### Serverless Architecture
- All functions are stateless
- Auto-scaling on Vercel
- Cost-effective pay-per-request model

## Development Notes

### Local Development vs Production
- `vercel dev` provides identical environment to production
- Environment variables loaded from `.env.local`
- Hot reloading for rapid development

### Debugging
- Check browser console for client-side errors
- Check terminal running `vercel dev` for server-side logs
- Use browser dev tools Network tab to inspect API calls

### Making Changes
- API functions: Edit files in `/api/` directory
- Frontend: Edit HTML files in `/public/` directory  
- Configuration: Update `vercel.json` or environment variables

## Deployment

### Automatic Deployment
- Connect your GitHub repo to Vercel
- Push to main branch triggers automatic deployment
- Environment variables set in Vercel dashboard

### Manual Deployment
```bash
vercel --prod
```

## Troubleshooting

### "Function not found" errors
- Ensure API files are in `/api/` directory
- Check `vercel.json` routing configuration
- Verify function exports use `module.exports`

### CORS issues
- CORS headers are manually set in each API function
- Check browser console for specific CORS errors
- Verify all required headers are present

### Environment variable issues
- Local: Use `.env.local` file
- Production: Set in Vercel dashboard
- Never commit secrets to git