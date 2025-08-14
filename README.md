# Minuteman Fuel Dashboard

A serverless web application for monitoring fuel dispatch operations and managing fuel farm tank levels.

## Features

- **Fuel Dispatch Monitor**: Real-time QT Technologies dispatch data
- **Fuel Farm Monitor**: Tank level tracking with Supabase persistence
- **Client-Side Authentication**: Each browser handles its own QT session
- **Serverless Architecture**: Runs on Vercel with auto-scaling

## Quick Start

### Prerequisites
- Node.js (version 18 or higher)
- Vercel CLI (`npm install -g vercel`)
- QT Technologies account credentials
- Supabase account (for fuel farm persistence)

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Open the applications:**
   - Fuel Dispatch: http://localhost:3000/fuel_dispatch
   - Fuel Farm: http://localhost:3000/fuel_farm

## Architecture

Built on Vercel serverless functions with:

- **API Functions**: `/api/` directory contains all serverless endpoints
- **Static Files**: `/public/` directory for HTML interfaces  
- **Client-Side Auth**: Browsers manage QT authentication cookies
- **Database**: Supabase for fuel tank level persistence

## Applications

### Fuel Dispatch Monitor
- Real-time dispatch data from QT Technologies
- Automatic authentication and session management
- 30-second polling for live updates
- Responsive design for desktop and mobile

### Fuel Farm Monitor
- Tank level tracking and updates
- Persistent storage in Supabase
- Real-time fuel capacity calculations
- Tank configuration in application code

## Deployment

### Automatic (Recommended)
1. Connect GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Push to main branch for automatic deployment

### Manual
```bash
vercel --prod
```

## Documentation

- `README_DEVELOPMENT.md` - Detailed development setup
- `SUPABASE_SETUP.md` - Database configuration guide
- `CLAUDE.md` - Project context for AI assistance