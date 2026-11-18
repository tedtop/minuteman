-- 2026-11-17: fuel_dispatch_history becomes one row per version of a flight.
-- Replaces the (transaction_id, change_flags) key and the short-lived
-- fuel_dispatch_snapshots / fuel_dispatch_changes tables. One transaction.
--
-- Existing rows have no FlightID. They are grouped per flight per local day
-- ('legacy:<flight_number>:<YYYY-MM-DD>') and numbered by recorded_at. Their
-- arrival/departure times were QT's KMSO local times parsed as UTC by the
-- servers; they are converted to the real instants (America/Denver).
BEGIN;

DROP TABLE IF EXISTS fuel_dispatch_snapshots;
DROP TABLE IF EXISTS fuel_dispatch_changes;

ALTER TABLE fuel_dispatch_history
    DROP CONSTRAINT IF EXISTS uq_dispatch_txn_change,
    ALTER COLUMN transaction_id TYPE TEXT USING transaction_id::text,
    ALTER COLUMN transaction_id DROP NOT NULL,
    ALTER COLUMN change_flags DROP NOT NULL,
    ALTER COLUMN change_flags DROP DEFAULT,
    ADD COLUMN IF NOT EXISTS flight_key TEXT,
    ADD COLUMN IF NOT EXISTS version INTEGER,
    ADD COLUMN IF NOT EXISTS gate TEXT,
    ADD COLUMN IF NOT EXISTS flight_status TEXT;

UPDATE fuel_dispatch_history SET
    arrival_date   = (arrival_date   AT TIME ZONE 'UTC') AT TIME ZONE 'America/Denver',
    departure_date = (departure_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Denver'
WHERE flight_key IS NULL;

UPDATE fuel_dispatch_history h SET flight_key = k.flight_key, version = k.version
FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY legacy_key ORDER BY recorded_at, change_flags, id) AS version,
           legacy_key AS flight_key
    FROM (
        SELECT id, recorded_at, change_flags,
               'legacy:' || CASE
                   WHEN flight_number IS NULL OR departure_date IS NULL THEN transaction_id
                   ELSE flight_number || ':' || to_char(departure_date AT TIME ZONE 'America/Denver', 'YYYY-MM-DD')
               END AS legacy_key
        FROM fuel_dispatch_history WHERE flight_key IS NULL
    ) l
) k
WHERE h.id = k.id;

ALTER TABLE fuel_dispatch_history
    ALTER COLUMN flight_key SET NOT NULL,
    ALTER COLUMN version SET NOT NULL,
    ADD CONSTRAINT uq_fuel_dispatch_history_version UNIQUE (flight_key, version);

-- Index names left over from when the table was called dispatch_history.
ALTER INDEX IF EXISTS dispatch_history_pkey RENAME TO fuel_dispatch_history_pkey;
ALTER INDEX IF EXISTS idx_dispatch_history_flight_date RENAME TO idx_fuel_dispatch_history_flight_date;
ALTER INDEX IF EXISTS idx_dispatch_history_airline_date RENAME TO idx_fuel_dispatch_history_airline_date;
ALTER INDEX IF EXISTS idx_dispatch_history_recorded RENAME TO idx_fuel_dispatch_history_recorded;
ALTER SEQUENCE IF EXISTS dispatch_history_id_seq RENAME TO fuel_dispatch_history_id_seq;

COMMENT ON TABLE fuel_dispatch_history IS 'One row per version of a QT dispatch (flight). Written by record_fuel_dispatches(); drives the dispatch-card change markers and fuel-demand trends.';

ALTER TABLE fuel_dispatch_history ENABLE ROW LEVEL SECURITY;

-- Records one QT poll. p_dispatches is QT's raw Detail.Dispatches array. For
-- each flight whose data differs from its latest version, inserts the next
-- version; then returns every version of the flights passed, oldest first.
-- QT's dates are KMSO local time ("2026-11-16 13:25"; "0001-01-01 ..." means
-- unset) and are stored as real instants in America/Denver. Several clients
-- poll at once: if two record the same new version, the unique
-- (flight_key, version) makes the second insert a no-op.
CREATE OR REPLACE FUNCTION record_fuel_dispatches(p_dispatches JSONB)
RETURNS SETOF fuel_dispatch_history
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    d       JSONB;
    v       fuel_dispatch_history%ROWTYPE;
    latest  fuel_dispatch_history%ROWTYPE;
    keys    TEXT[] := '{}';
BEGIN
    FOR d IN SELECT * FROM jsonb_array_elements(COALESCE(p_dispatches, '[]'::jsonb)) LOOP
        v := NULL;
        v.flight_key := COALESCE(NULLIF(d->>'FlightID', ''), NULLIF(d->>'TransactionID', ''));
        CONTINUE WHEN v.flight_key IS NULL;
        keys := keys || v.flight_key;

        v.transaction_id        := NULLIF(d->>'TransactionID', '');
        v.change_flags          := (d->>'ChangeFlags')::INTEGER;
        v.flight_number         := NULLIF(d->>'FlightNumber', '');
        v.tail_number           := NULLIF(UPPER(TRIM(d->>'TailNumber')), '');
        v.aircraft_type         := NULLIF(d->>'AircraftType', '');
        v.airline_icao_code     := NULLIF(d->>'AirlineIcaoCode', '');
        v.destination           := NULLIF(d->>'Destination', '');
        v.gate := CASE
            WHEN COALESCE(d->>'Gate', '') IN ('', '?') THEN NULL
            WHEN COALESCE(d->>'TerminalNumber', '') IN ('', '-', '?', '0') THEN d->>'Gate'
            ELSE (d->>'TerminalNumber') || (d->>'Gate')
        END;
        v.flight_status         := NULLIF(d->>'FlightStatus', '');
        v.quantity              := (d->>'Quantity')::NUMERIC;
        v.quantity_in_weight    := ROUND((d->>'QuantityInWeight')::NUMERIC);
        v.density               := (d->>'Density')::NUMERIC;
        v.transaction_status_id := (d->>'TransactionStatusID')::SMALLINT;
        v.arrival_date := CASE WHEN COALESCE(d->>'ArrivalDate', '') = '' OR d->>'ArrivalDate' LIKE '0001-01-01%' THEN NULL
            ELSE (d->>'ArrivalDate')::TIMESTAMP AT TIME ZONE 'America/Denver' END;
        v.departure_date := CASE WHEN COALESCE(d->>'DepartureDate', '') = '' OR d->>'DepartureDate' LIKE '0001-01-01%' THEN NULL
            ELSE (d->>'DepartureDate')::TIMESTAMP AT TIME ZONE 'America/Denver' END;

        SELECT * INTO latest FROM fuel_dispatch_history
        WHERE flight_key = v.flight_key ORDER BY version DESC LIMIT 1;

        IF FOUND AND (latest.transaction_id, latest.change_flags, latest.flight_number, latest.tail_number,
                      latest.aircraft_type, latest.airline_icao_code, latest.destination, latest.gate,
                      latest.flight_status, latest.quantity, latest.quantity_in_weight, latest.density,
                      latest.transaction_status_id, latest.arrival_date, latest.departure_date)
            IS NOT DISTINCT FROM
                     (v.transaction_id, v.change_flags, v.flight_number, v.tail_number,
                      v.aircraft_type, v.airline_icao_code, v.destination, v.gate,
                      v.flight_status, v.quantity, v.quantity_in_weight, v.density,
                      v.transaction_status_id, v.arrival_date, v.departure_date) THEN
            CONTINUE;
        END IF;

        INSERT INTO fuel_dispatch_history (
            flight_key, version, transaction_id, change_flags, flight_number, tail_number, aircraft_type,
            airline_icao_code, destination, gate, flight_status, quantity, quantity_in_weight, density,
            transaction_status_id, arrival_date, departure_date)
        VALUES (
            v.flight_key, COALESCE(latest.version, 0) + 1, v.transaction_id, v.change_flags, v.flight_number,
            v.tail_number, v.aircraft_type, v.airline_icao_code, v.destination, v.gate, v.flight_status,
            v.quantity, v.quantity_in_weight, v.density, v.transaction_status_id, v.arrival_date, v.departure_date)
        ON CONFLICT (flight_key, version) DO NOTHING;
    END LOOP;

    RETURN QUERY SELECT * FROM fuel_dispatch_history
        WHERE flight_key = ANY(keys) ORDER BY flight_key, version;
END;
$$;

-- Functions are executable by everyone by default; this one is server-only.
REVOKE ALL ON FUNCTION record_fuel_dispatches(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_fuel_dispatches(JSONB) TO service_role;

COMMIT;
