// QT dispatch history, shared with fbo-manager: fuel_dispatch_history holds one
// row per version of a flight, written by the record_fuel_dispatches() Postgres
// function (schema/supabase-schema.sql). Each poll hands it QT's raw dispatch
// list; it adds a version for every flight whose data changed and returns all
// versions of the flights in the feed. The changes shown on the dispatch cards
// are derived here by comparing consecutive versions.

// The kinds of change the cards flag, and how each reads off a version row.
// A value of null means "not known yet" (no gate assigned, fuel not entered).
const KINDS = {
    fuel: v => (Number(v.quantity_in_weight) > 0 ? String(v.quantity_in_weight) : null),
    gate: v => v.gate || null,
    arrival: v => v.arrival_date || null,
    departure: v => v.departure_date || null,
    tail: v => v.tail_number || null
};

// Records one poll. Returns every version of the flights in `dispatches`
// (oldest first per flight), or null when there is no database or it fails.
async function recordDispatches(supabase, dispatches) {
    if (!supabase || !Array.isArray(dispatches)) return null;
    if (dispatches.length === 0) return [];
    try {
        const { data, error } = await supabase.rpc('record_fuel_dispatches', { p_dispatches: dispatches });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('record_fuel_dispatches error:', error.message);
        return null;
    }
}

// { [flightKey]: [{ kind, oldValue, newValue, detectedAt }] }, oldest first.
// A change is a known value becoming a different known value; a value going
// blank and coming back different (gate B2 -> none -> B4) counts as B2 -> B4,
// and one appearing for the first time is an assignment, not a change.
function changesFromVersions(versions) {
    const byFlight = new Map();
    for (const v of versions || []) {
        if (!byFlight.has(v.flight_key)) byFlight.set(v.flight_key, []);
        byFlight.get(v.flight_key).push(v);
    }

    const result = {};
    for (const [key, list] of byFlight) {
        list.sort((a, b) => a.version - b.version);
        const last = {};
        const changes = [];
        for (const v of list) {
            for (const [kind, read] of Object.entries(KINDS)) {
                const value = read(v);
                if (value == null) continue;
                if (last[kind] != null && !sameValue(kind, last[kind], value)) {
                    changes.push({ kind, oldValue: last[kind], newValue: value, detectedAt: v.recorded_at });
                }
                last[kind] = value;
            }
        }
        if (changes.length) result[key] = changes;
    }
    return result;
}

// Timestamps can come back in different string forms for the same instant.
function sameValue(kind, a, b) {
    if (kind === 'arrival' || kind === 'departure') return Date.parse(a) === Date.parse(b);
    return a === b;
}

module.exports = { recordDispatches, changesFromVersions };
