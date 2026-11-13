const { createClient } = require('@supabase/supabase-js');
const { lookupFaaDesignator } = require('./_faa');

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

// Specific ICAO equipment type (e.g. "B39M", "E75L") per registration. QT's
// own AircraftType is generic ("737", "E75E") - the specific variant matters
// since fuel burn differs a lot within a family. Source order:
//   1. adsbdb (same as fbo-manager) - a registration database, so it answers
//      for tails that are parked or still hours out, unlike the live feed.
//   2. FAA registry for US tails adsbdb doesn't know (api/_faa.js, mapped to a
//      designator via the icao-aircraft-types package).
// No further fallback here: when both come up empty the client just keeps
// QT's own type.
const ADSBDB_URL = 'https://api.adsbdb.com/v0/aircraft';
const ADSBDB_TIMEOUT_MS = 5000;
const EQUIPMENT_HIT_TTL_MS = 24 * 60 * 60 * 1000; // an airframe's type effectively never changes
const EQUIPMENT_MISS_TTL_MS = 60 * 60 * 1000;
const equipmentCache = new Map(); // tail -> { code: string|null, expiresAt: number }

// ICAO type code, null (adsbdb answered but doesn't know the tail), or
// undefined (couldn't be reached - don't cache, so it gets retried).
async function lookupAdsbdb(tail) {
    try {
        const response = await fetch(`${ADSBDB_URL}/${encodeURIComponent(tail)}`, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(ADSBDB_TIMEOUT_MS)
        });
        // adsbdb answers 404 for a tail it doesn't know - a real, cacheable "no".
        if (response.status === 404) return null;
        if (!response.ok) return undefined;
        const body = await response.json();
        const code = body?.response?.aircraft?.icao_type;
        return typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : null;
    } catch (error) {
        console.error(`adsbdb lookup failed for ${tail}:`, error.message);
        return undefined;
    }
}

async function lookupEquipment(tail) {
    const cached = equipmentCache.get(tail);
    if (cached && cached.expiresAt > Date.now()) return cached.code;

    let code = await lookupAdsbdb(tail);
    let definitive = code !== undefined;
    if (!code) {
        const faa = await lookupFaaDesignator(tail);
        if (faa) code = faa;
        // A miss is only cacheable if every source we asked actually answered.
        definitive = definitive && faa !== undefined;
    }

    if (definitive) {
        equipmentCache.set(tail, {
            code: code || null,
            expiresAt: Date.now() + (code ? EQUIPMENT_HIT_TTL_MS : EQUIPMENT_MISS_TTL_MS)
        });
    }
    return code || null;
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

    // Non-critical enrichment: any failure degrades to less data rather than an
    // error, so the client just falls back to QT's own times and type.
    const tracked = {};
    const point = await getPointData();
    if (point) {
        for (const ac of point.aircraft) {
            const tail = normalizeTail(ac.r);
            if (tails.has(tail)) tracked[tail] = summarizeAircraft(ac);
        }
    }

    // Equipment type for every requested tail, in range or not. A tail with no
    // live position gets an entry with null position fields, so the client
    // skips the countdown and just shows the type.
    const tailList = [...tails];
    const codes = await Promise.all(tailList.map(lookupEquipment));
    tailList.forEach((tail, i) => {
        if (!codes[i]) return;
        tracked[tail] = tracked[tail]
            ? { ...tracked[tail], equipmentCode: codes[i] }
            : { distanceNm: null, groundSpeedKt: null, altitudeFt: null, onGround: null, etaMinutes: null, equipmentCode: codes[i] };
    });

    return res.status(200).json({
        tracked,
        fetchedAt: point ? point.fetchedAt.toISOString() : null,
        stale: point ? point.stale : false
    });
};
