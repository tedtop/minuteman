-- Fuel Farm Database Schema for Supabase
-- Run this in the Supabase SQL editor
-- Tank configuration is stored in application code, only readings are stored in database

-- Create tank_level_readings table (time-series data only)
CREATE TABLE IF NOT EXISTS tank_level_readings (
    id BIGSERIAL PRIMARY KEY,
    tank_id VARCHAR(10) NOT NULL,
    level DECIMAL(5,2) NOT NULL CHECK (level >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tank_level_readings_tank_recorded 
    ON tank_level_readings(tank_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_tank_level_readings_recorded 
    ON tank_level_readings(recorded_at DESC);

-- Function to get latest reading for each tank
CREATE OR REPLACE FUNCTION get_latest_tank_readings()
RETURNS TABLE (
    tank_id VARCHAR(10),
    level DECIMAL(5,2),
    recorded_at TIMESTAMPTZ
) 
LANGUAGE SQL
STABLE
AS $$
    SELECT DISTINCT ON (tank_id) 
        tank_id,
        level,
        recorded_at
    FROM tank_level_readings
    ORDER BY tank_id, recorded_at DESC;
$$;

COMMENT ON TABLE tank_level_readings IS 'Time-series tank level readings. Tank configuration stored in application code.';

-- Create fuel_density_readings table (hydrometer readings: fuel temp + density)
CREATE TABLE IF NOT EXISTS fuel_density_readings (
    id BIGSERIAL PRIMARY KEY,
    temperature_f DECIMAL(5,2) NOT NULL,
    density_lbs_gal DECIMAL(4,2) NOT NULL CHECK (density_lbs_gal > 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_density_readings_recorded
    ON fuel_density_readings(recorded_at DESC);

COMMENT ON TABLE fuel_density_readings IS 'Hydrometer readings of fuel temperature and density, used to extrapolate density estimates at other temperatures.';