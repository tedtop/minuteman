# Supabase Setup for Fuel Farm Tank Level Persistence

## Overview

The fuel farm module now persists tank level readings to Supabase (PostgreSQL) for long-term storage and future analytics. Tank configuration (max levels, fuel types, capacities) remains in the application code for easy modification.

## Setup Instructions

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create an account
2. Create a new project
3. Note your Project URL and API keys

### 2. Configure Environment Variables

Add these variables to your `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### 3. Create Database Schema

1. Go to your Supabase dashboard
2. Navigate to the SQL editor
3. Run the SQL script from `supabase-schema.sql` to create the required table and functions

### 4. Tank Configuration

Tank configuration is stored in `/api/fuel_farm/tanks.js` in the `tankConfig` object:

- **T1-T6**: 12,000 gallon capacity at 86" max level (Avgas for T1, Jet A for T2-T6)
- **T7**: 18,034 gallon capacity at 97" max level (Jet A)

To modify tank configuration, edit the `tankConfig` object in `/api/fuel_farm/tanks.js`.

## How It Works

### Database Connection

- Serverless functions test Supabase connection on each request
- Connection status is displayed in the frontend
- If database is offline, readings cannot be saved but the app continues to work

### Data Flow

1. **Tank Configuration**: Stored in application code (`tankConfig`)
2. **Level Readings**: Stored in Supabase `tank_level_readings` table
3. **Display**: Frontend combines config + latest readings from database

### Frontend Behavior

- **Green status**: Database connected, readings can be saved
- **Yellow status**: Database offline, readings cannot be saved
- **Red status**: Server connection issues

### API Endpoints

- `GET /api/fuel_farm/tanks`: Returns tank config merged with latest readings
- `POST /api/fuel_farm/tanks/:tankId`: Updates tank level and saves to database

## Database Schema

### tank_level_readings table

```sql
id              BIGSERIAL PRIMARY KEY
tank_id         VARCHAR(10) NOT NULL
level           DECIMAL(5,2) NOT NULL CHECK (level >= 0)
recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Functions

- `get_latest_tank_readings()`: Returns latest reading for each tank

## Future Enhancements

The database structure is designed to support future analytics features:

- Historical trending
- Usage pattern analysis  
- Fuel consumption reporting
- Automated alerts based on level changes

## Troubleshooting

### Database Connection Issues

1. Check environment variables are set correctly
2. Verify Supabase project is active
3. Check network connectivity
4. Review server logs for detailed error messages

### Missing Readings

If tank levels show as 0 when database is connected:

1. Check if any readings exist in the database
2. Verify tank IDs match between config and database
3. Check Supabase logs for query errors

The application is designed to work with or without the database connection, so basic functionality always remains available.