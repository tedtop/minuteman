// Server-side change log for QT dispatches: fuel, gate, arrival, departure and
// tail (aircraft swap) changes, kept in Supabase so the cards can flag them
// after a page refresh and on every screen, not only in the browser tab that
// happened to be open when QT changed something.
//
// Each poll diffs the dispatches against the last snapshot stored per flight
// (dispatch_snapshots), appends what changed to dispatch_changes, and returns
// every recorded change for the flights in the current feed. Several clients
// poll at once, so two of them can see the same transition: the unique index
// on (flight_key, kind, old_value, new_value) makes the second insert a no-op.
// The tables are in schema/supabase-schema.sql. When they are missing or
// Supabase fails, trackDispatchChanges returns null and the page falls back
// to its own in-memory diff.

const GATE_UNKNOWN_VALUES = new Set([null, undefined, '', '?']);
const TERMINAL_UNKNOWN_VALUES = new Set([null, undefined, '', '-', '?', '0']);

// The key the page uses for a flight (FlightID, else TransactionID).
function flightKey(d) {
    const key = d?.FlightID || d?.TransactionID;
    return key ? String(key) : null;
}

// QT sends "0001-01-01 00:00" (.NET DateTime.MinValue) for an unset date.
function knownDate(value) {
    return value && !String(value).startsWith('0001-01-01') ? String(value) : null;
}

// Gate as the ramp reads it: terminal + gate ("A4"), or the bare gate.
function gateLabel(d) {
    if (GATE_UNKNOWN_VALUES.has(d.Gate)) return null;
    return TERMINAL_UNKNOWN_VALUES.has(d.TerminalNumber) ? String(d.Gate) : `${d.TerminalNumber}${d.Gate}`;
}

// The values that are diffed, as stored in dispatch_snapshots (all text).
function snapshotOf(d) {
    const fuel = Number(d.QuantityInWeight);
    return {
        fuel: Number.isFinite(fuel) && fuel > 0 ? String(fuel) : null,
        gate: gateLabel(d),
        arrival: knownDate(d.ArrivalDate),
        departure: knownDate(d.DepartureDate),
        tail: d.TailNumber ? String(d.TailNumber).trim().toUpperCase() || null : null
    };
}

const KINDS = ['fuel', 'gate', 'arrival', 'departure', 'tail'];

// Changes between two snapshots. A value appearing for the first time (null
// before) is an assignment, not a change, so only known -> different known
// counts.
function diffSnapshots(prev, next) {
    if (!prev) return [];
    return KINDS
        .filter(kind => prev[kind] != null && next[kind] != null && prev[kind] !== next[kind])
        .map(kind => ({ kind, oldValue: prev[kind], newValue: next[kind] }));
}

const changeId = c => `${c.kind}|${c.oldValue}|${c.newValue}`;

// Returns { [flightKey]: [{ kind, oldValue, newValue, detectedAt }] } (oldest
// first) for the flights in `dispatches`, or null when there is no database
// or it fails.
async function trackDispatchChanges(supabase, dispatches, now = new Date()) {
    if (!supabase || !Array.isArray(dispatches)) return null;

    const current = new Map();
    for (const d of dispatches) {
        const key = flightKey(d);
        if (key) current.set(key, snapshotOf(d));
    }
    const result = {};
    if (current.size === 0) return result;
    const keys = [...current.keys()];

    try {
        const [snapRes, changeRes] = await Promise.all([
            supabase.from('dispatch_snapshots').select('flight_key, fuel, gate, arrival, departure, tail').in('flight_key', keys),
            supabase.from('dispatch_changes').select('flight_key, kind, old_value, new_value, detected_at').in('flight_key', keys).order('detected_at', { ascending: true })
        ]);
        if (snapRes.error) throw new Error('dispatch_snapshots read: ' + snapRes.error.message);
        if (changeRes.error) throw new Error('dispatch_changes read: ' + changeRes.error.message);

        for (const row of changeRes.data || []) {
            (result[row.flight_key] ||= []).push({
                kind: row.kind,
                oldValue: row.old_value,
                newValue: row.new_value,
                detectedAt: row.detected_at
            });
        }

        const previous = new Map((snapRes.data || []).map(row => [row.flight_key, row]));
        const detectedAt = now.toISOString();
        const newChanges = [];
        const snapshotRows = [];

        for (const [key, snap] of current) {
            const prev = previous.get(key);
            const changed = !prev || KINDS.some(k => (prev[k] ?? null) !== snap[k]);
            if (!changed) continue;

            // Keep the last known value for a field QT has blanked, so a
            // gate that goes "B2" -> "" -> "B4" still reads as B2 -> B4.
            const merged = { ...snap };
            if (prev) for (const k of KINDS) if (merged[k] == null && prev[k] != null) merged[k] = prev[k];
            if (prev && KINDS.every(k => (prev[k] ?? null) === merged[k])) continue;

            snapshotRows.push({ flight_key: key, ...merged, updated_at: detectedAt });
            for (const c of diffSnapshots(prev, merged)) {
                newChanges.push({ flight_key: key, kind: c.kind, old_value: c.oldValue, new_value: c.newValue, detected_at: detectedAt });
            }
        }

        const writes = [];
        if (newChanges.length) {
            writes.push(supabase.from('dispatch_changes')
                .upsert(newChanges, { onConflict: 'flight_key,kind,old_value,new_value', ignoreDuplicates: true }));
        }
        if (snapshotRows.length) {
            writes.push(supabase.from('dispatch_snapshots').upsert(snapshotRows, { onConflict: 'flight_key' }));
        }
        for (const { error } of await Promise.all(writes)) {
            if (error) console.error('dispatch change log write error:', error.message);
        }

        for (const row of newChanges) {
            const list = (result[row.flight_key] ||= []);
            const c = { kind: row.kind, oldValue: row.old_value, newValue: row.new_value, detectedAt: row.detected_at };
            // Another client may have logged the same transition a moment ago.
            if (!list.some(existing => changeId(existing) === changeId(c))) list.push(c);
        }
        return result;
    } catch (error) {
        console.error('dispatch change log error:', error.message);
        return null;
    }
}

module.exports = { trackDispatchChanges, diffSnapshots, snapshotOf, flightKey };
