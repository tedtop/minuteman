const { createClient } = require('@supabase/supabase-js');

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

// KMSO airport reference point. adsb.lol's point query returns every tracked
// aircraft within the radius along with `dst` (nm from this point) already
// computed, so no distance math is needed here. 250nm is the API's max.
const KMSO_LAT = 46.9158;
const KMSO_LON = -114.0911;
const ADSB_RADIUS_NM = 250;
const ADSB_POINT_URL = `https://api.adsb.lol/v2/point/${KMSO_LAT}/${KMSO_LON}/${ADSB_RADIUS_NM}`;

// adsb.lol is free, keyless and has no SLA - be a good citizen. The dispatch
// page polls every 30s from several clients at once (phones + the office
// display), so we make one shared area query per 60s window and filter it
// per tail locally, rather than one request per tail or per client.
const CACHE_TTL_MS = 60000;

// ETA from distance/ground speed is meaningless for a parked or taxiing
// aircraft (and divides by ~0), so below this speed we report no estimate
// and the client falls back to QT's own ArrivalDate.
const MIN_ETA_GROUND_SPEED_KT = 5;

// In-memory fast path for warm invocations; adsb_point_cache in Supabase is
// the durable copy, since serverless cold starts reset this on effectively
// every request in practice (same reasoning as qt_session in dispatch.js).
let pointCache = null; // { aircraft: [...], fetchedAt: Date }

function isFresh(cache) {
    return cache && Date.now() - cache.fetchedAt.getTime() < CACHE_TTL_MS;
}

// A stale in-memory copy still checks Supabase, since another instance may
// have refreshed the shared row in the meantime.
async function getCachedPoint() {
    if (isFresh(pointCache)) return pointCache;
    if (!supabase) return pointCache;

    try {
        const { data, error } = await supabase
            .from('adsb_point_cache')
            .select('aircraft, fetched_at')
            .eq('id', 1)
            .maybeSingle();
        if (error) throw error;
        if (data) pointCache = { aircraft: data.aircraft, fetchedAt: new Date(data.fetched_at) };
        return pointCache;
    } catch (error) {
        console.error('Failed to load cached ADS-B point data:', error.message);
        return pointCache;
    }
}

async function savePointCache(aircraft, fetchedAt) {
    pointCache = { aircraft, fetchedAt };
    if (!supabase) return;

    const { error } = await supabase
        .from('adsb_point_cache')
        .upsert({ id: 1, aircraft, fetched_at: fetchedAt.toISOString() });
    if (error) console.error('Failed to save ADS-B point cache:', error.message);
}

async function fetchPointFromAdsb() {
    const response = await fetch(ADSB_POINT_URL, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`adsb.lol responded ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.ac)) throw new Error('adsb.lol response missing ac array');
    return data.ac;
}

// Returns { aircraft, fetchedAt, stale }, or null if there's no data at all.
async function getPointData() {
    const cached = await getCachedPoint();
    if (isFresh(cached)) {
        return { ...cached, stale: false };
    }

    try {
        const aircraft = await fetchPointFromAdsb();
        const fetchedAt = new Date();
        await savePointCache(aircraft, fetchedAt);
        return { aircraft, fetchedAt, stale: false };
    } catch (error) {
        console.error('ADS-B fetch failed:', error.message);
        return cached ? { ...cached, stale: true } : null;
    }
}

function normalizeTail(tail) {
    return typeof tail === 'string' ? tail.trim().toUpperCase() : '';
}

function summarizeAircraft(ac) {
    const distanceNm = typeof ac.dst === 'number' ? ac.dst : null;
    const groundSpeedKt = typeof ac.gs === 'number' ? ac.gs : null;
    // alt_baro is the literal string "ground" when the aircraft is on the ground.
    const onGround = ac.alt_baro === 'ground';
    const altitudeFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;
    const etaMinutes = distanceNm != null && groundSpeedKt > MIN_ETA_GROUND_SPEED_KT
        ? (distanceNm / groundSpeedKt) * 60
        : null;
    return { distanceNm, groundSpeedKt, altitudeFt, onGround, etaMinutes };
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const tails = new Set(
        String(req.query.tails || '').split(',').map(normalizeTail).filter(Boolean)
    );
    if (tails.size === 0) {
        return res.status(200).json({ tracked: {}, fetchedAt: null, stale: false });
    }

    // Non-critical enrichment: any failure degrades to an empty result rather
    // than an error, so the client just falls back to QT's own times.
    const point = await getPointData();
    if (!point) {
        return res.status(200).json({ tracked: {}, fetchedAt: null, stale: false });
    }

    const tracked = {};
    for (const ac of point.aircraft) {
        const tail = normalizeTail(ac.r);
        if (tails.has(tail)) tracked[tail] = summarizeAircraft(ac);
    }

    return res.status(200).json({
        tracked,
        fetchedAt: point.fetchedAt.toISOString(),
        stale: point.stale
    });
};
