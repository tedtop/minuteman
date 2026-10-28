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

-- Function to get the lowest level ever recorded for each tank, used as a
-- data-driven stand-in for "unusable fuel" - how low that tank has actually
-- been able to go, rather than the configured usableMin in tanks.js.
CREATE OR REPLACE FUNCTION get_min_tank_readings()
RETURNS TABLE (
    tank_id VARCHAR(10),
    level DECIMAL(5,2)
)
LANGUAGE SQL
STABLE
AS $$
    SELECT tank_id, MIN(level) AS level
    FROM tank_level_readings
    GROUP BY tank_id;
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

-- Fuel load gravity QC readings (fuel farm Jet A receipts, tanks T2-T7).
-- Taken when a load arrives: hydrometer temp + reading, the GTP-3012-1A
-- wheel's correction of that reading to 60F (the figure of record, checked
-- against the driver's BOL API gravity for the +/-1.0 acceptance rule), and
-- gallons delivered so a gallon-weighted running average can stand in for
-- the "mixed" specific gravity of whatever loads have gone into T2-T7.
CREATE TABLE IF NOT EXISTS fuel_gravity_readings (
    id BIGSERIAL PRIMARY KEY,
    observed_temp_f DECIMAL(5,2) NOT NULL,
    observed_api_gravity DECIMAL(5,2) NOT NULL,
    computed_api_gravity_60 DECIMAL(5,2) NOT NULL,
    wheel_api_gravity_60 DECIMAL(5,2) NOT NULL,
    driver_api_gravity DECIMAL(5,2) NOT NULL,
    driver_specific_gravity DECIMAL(6,4),
    gallons_delivered DECIMAL(8,2) NOT NULL CHECK (gallons_delivered > 0),
    acceptable BOOLEAN NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_gravity_readings_recorded
    ON fuel_gravity_readings(recorded_at DESC);

COMMENT ON TABLE fuel_gravity_readings IS 'Fuel load gravity QC readings for the T2-T7 Jet A farm: hydrometer temp/reading, the GTP-3012-1A wheel''s 60F correction (the figure checked against the driver''s BOL for the +/-1.0 API acceptance rule), and gallons delivered for a gallon-weighted running "mixed" gravity.';

-- The gallon-weighted "mixed" gravity average itself (windowed to the most
-- recent loads covering ~one T2-T7 farm volume) is computed in
-- api/fuel_farm/gravity.js rather than in SQL, so the windowing logic stays
-- easy to read, tune, and log server-side instead of living in a second,
-- harder-to-debug implementation here.

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

-- Shared QT Technologies session cookie (singleton row).
-- All clients (phones, office desktops) talk only to our /api/dispatch proxy,
-- which is the sole thing that logs into QT - so there is exactly one QT
-- session at a time, regardless of how many clients are polling us. Persisting
-- it here (rather than an in-memory variable) means it survives serverless
-- cold starts instead of forcing a full re-login on every invocation.
CREATE TABLE IF NOT EXISTS qt_session (
    id         SMALLINT PRIMARY KEY DEFAULT 1,
    cookie     TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT qt_session_singleton CHECK (id = 1)
);

COMMENT ON TABLE qt_session IS 'Singleton row holding the shared QT Technologies session cookie, so the login session survives serverless cold starts instead of resetting every invocation.';