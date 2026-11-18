const { createClient } = require('@supabase/supabase-js');

const RANGE_DAYS = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '6mo': 182,
    '12mo': 365,
    'all': null
};
const DEFAULT_RANGE = '30d';
const PAGE_SIZE = 1000;

// YYYY-MM-DD in KMSO local time.
const LOCAL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
const localDate = d => LOCAL_DATE.format(d);

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    if (!supabase) {
        return res.json({ success: true, dbConnected: false, range: DEFAULT_RANGE, since: null, rows: [] });
    }

    try {
        const range = RANGE_DAYS.hasOwnProperty(req.query.range) ? req.query.range : DEFAULT_RANGE;
        const groupBy = req.query.groupBy === 'week' ? 'week' : 'day';
        const flightFilter = req.query.flight || null;
        const airlineFilter = req.query.airline || null;

        const days = RANGE_DAYS[range];
        const since = days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        // Paginate through all matching rows
        const rawRows = [];
        for (let page = 0; ; page++) {
            let q = supabase
                .from('fuel_dispatch_history')
                .select('flight_key, version, flight_number, airline_icao_code, departure_date, quantity, quantity_in_weight, transaction_status_id')
                .order('departure_date', { ascending: true })
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (since !== null) q = q.gte('departure_date', since);
            if (flightFilter) q = q.eq('flight_number', flightFilter);
            if (airlineFilter) q = q.eq('airline_icao_code', airlineFilter);

            const { data: pageData, error: pageError } = await q;
            if (pageError) throw pageError;

            rawRows.push(...pageData);
            if (pageData.length < PAGE_SIZE) break;
        }

        // One count per flight: its latest version (final fuel figures, and a
        // flight QT re-issued under a new TransactionID is still one flight).
        const latestByFlight = new Map();
        for (const row of rawRows) {
            const existing = latestByFlight.get(row.flight_key);
            if (!existing || row.version > existing.version) {
                latestByFlight.set(row.flight_key, row);
            }
        }

        // Aggregate by date bucket + flight number, excluding cancelled (status 7)
        const buckets = new Map();
        for (const row of latestByFlight.values()) {
            if (row.transaction_status_id === 7) continue;
            if (!row.departure_date) continue;

            // Buckets are KMSO local dates, not UTC ones.
            let dateKey = localDate(new Date(row.departure_date));
            if (groupBy === 'week') {
                // ISO week start (Monday)
                const d = new Date(`${dateKey}T00:00:00Z`);
                d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
                dateKey = d.toISOString().slice(0, 10);
            }

            const bucketKey = `${dateKey}|${row.flight_number}`;
            const existing = buckets.get(bucketKey);
            if (existing) {
                existing.totalGallons += row.quantity ?? 0;
                existing.totalLbs += row.quantity_in_weight ?? 0;
                existing.dispatchCount += 1;
            } else {
                buckets.set(bucketKey, {
                    date: dateKey,
                    flightNumber: row.flight_number,
                    airlineIcaoCode: row.airline_icao_code,
                    totalGallons: row.quantity ?? 0,
                    totalLbs: row.quantity_in_weight ?? 0,
                    dispatchCount: 1
                });
            }
        }

        const rows = Array.from(buckets.values())
            .sort((a, b) => a.date.localeCompare(b.date) || a.flightNumber?.localeCompare(b.flightNumber));

        // Round gallons to 1 decimal place
        rows.forEach(r => { r.totalGallons = Math.round(r.totalGallons * 10) / 10; });

        return res.json({
            success: true,
            dbConnected: true,
            range,
            since,
            groupBy,
            rows
        });
    } catch (error) {
        console.error('Dispatch history error:', error);
        return res.status(500).json({ success: false, error: 'Server error: ' + error.message });
    }
}
