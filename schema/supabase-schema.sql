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

-- Dispatch history for trend analytics
-- One row per distinct (TransactionID, ChangeFlags) state seen during polling.
-- The UNIQUE constraint deduplicates concurrent client polls via ON CONFLICT DO NOTHING.
-- For analytics, use the highest change_flags row per transaction_id to get final quantities.
CREATE TABLE IF NOT EXISTS fuel_dispatch_history (
    id                    BIGSERIAL PRIMARY KEY,
    transaction_id        UUID NOT NULL,
    change_flags          INTEGER NOT NULL DEFAULT 0,
    flight_number         VARCHAR(20),
    tail_number           VARCHAR(20),
    aircraft_type         VARCHAR(20),
    airline_icao_code     VARCHAR(10),
    destination           VARCHAR(10),
    quantity              DECIMAL(10,2),
    quantity_in_weight    INTEGER,
    density               DECIMAL(6,4),
    transaction_status_id SMALLINT,
    arrival_date          TIMESTAMPTZ,
    departure_date        TIMESTAMPTZ,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_dispatch_txn_change UNIQUE (transaction_id, change_flags)
);

CREATE INDEX IF NOT EXISTS idx_fuel_dispatch_history_flight_date
    ON fuel_dispatch_history (flight_number, departure_date DESC);

CREATE INDEX IF NOT EXISTS idx_fuel_dispatch_history_airline_date
    ON fuel_dispatch_history (airline_icao_code, departure_date DESC);

CREATE INDEX IF NOT EXISTS idx_fuel_dispatch_history_recorded
    ON fuel_dispatch_history (recorded_at DESC);

COMMENT ON TABLE fuel_dispatch_history IS 'Time-series of dispatch states from QT API polling. Used for fuel demand trend analytics per flight number per day.';