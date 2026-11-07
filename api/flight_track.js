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

    // Both writes only happen once per 60s upstream fetch (not per client
    // request), same as the point cache itself - awaited together since a
    // detached promise can get cut off once the serverless invocation returns.
    const [pointResult] = await Promise.all([
        supabase.from('adsb_point_cache').upsert({ id: 1, aircraft, fetched_at: fetchedAt.toISOString() }),
        cacheEquipmentCodes(aircraft)
    ]);
    if (pointResult.error) console.error('Failed to save ADS-B point cache:', pointResult.error.message);
}

// An airframe's type is effectively permanent, so every registration+type
// pair seen in a point query is worth keeping indefinitely - this is what
// lets a tail that's currently out of range (or parked at KMSO, which has no
// local feeder and often doesn't appear live at all) still show its real
// equipment type instead of falling all the way back to QT's generic one.
async function cacheEquipmentCodes(aircraft) {
    if (!supabase) return;

    const rows = aircraft
        .filter(ac => typeof ac.r === 'string' && typeof ac.t === 'string')
        .map(ac => ({ tail_number: normalizeTail(ac.r), equipment_code: ac.t, last_seen_at: new Date().toISOString() }));
    if (rows.length === 0) return;

    const { error } = await supabase.from('tail_equipment_cache').upsert(rows);
    if (error) console.error('Failed to cache equipment codes:', error.message);
}

async function getCachedEquipment(tails) {
    if (!supabase || tails.length === 0) return {};

    try {
        const { data, error } = await supabase
            .from('tail_equipment_cache')
            .select('tail_number, equipment_code')
            .in('tail_number', tails);
        if (error) throw error;

        const result = {};
        for (const row of data || []) result[row.tail_number] = row.equipment_code;
        return result;
    } catch (error) {
        console.error('Failed to load cached equipment codes:', error.message);
        return {};
    }
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
    // The transponder-reported ICAO type code (e.g. "B39M", "E75L") is the
    // specific variant, unlike QT's generic AircraftType ("737", "E75E") -
    // useful since fuel burn differs a lot within a family (737-900 vs 737
    // MAX 9, for instance). Not every aircraft broadcasts it.
    const equipmentCode = typeof ac.t === 'string' ? ac.t : null;
    return { distanceNm, groundSpeedKt, altitudeFt, onGround, etaMinutes, equipmentCode };
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

    // Requested tails with no live position still get their last-known
    // equipment type, if we've ever seen one for that registration - no
    // position/speed/ETA fields, so the client naturally skips the live
    // countdown and just shows the type.
    const missingTails = [...tails].filter(tail => !tracked[tail]);
    if (missingTails.length > 0) {
        const cachedEquipment = await getCachedEquipment(missingTails);
        for (const [tail, equipmentCode] of Object.entries(cachedEquipment)) {
            tracked[tail] = {
                distanceNm: null, groundSpeedKt: null, altitudeFt: null,
                onGround: null, etaMinutes: null, equipmentCode
            };
        }
    }

    return res.status(200).json({
        tracked,
        fetchedAt: point.fetchedAt.toISOString(),
        stale: point.stale
    });
};
