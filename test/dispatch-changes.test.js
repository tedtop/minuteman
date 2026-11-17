'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, silenceConsole, loadModule, invoke, mockFetch, jsonResponse } = require('./helpers');
const { trackDispatchChanges, diffSnapshots, snapshotOf } = require('../api/_dispatch_changes');

const NOW = new Date('2026-11-16T15:00:00.000Z');
const flight = (extra = {}) => ({
    FlightID: 101, TransactionID: 9001, QuantityInWeight: 18400, Gate: '4', TerminalNumber: 'A',
    ArrivalDate: '2026-11-16 08:05', DepartureDate: '2026-11-16 09:10', TailNumber: 'n37502',
    ...extra
});
const SNAP = { flight_key: '101', fuel: '18400', gate: 'A4', arrival: '2026-11-16 08:05', departure: '2026-11-16 09:10', tail: 'N37502' };

// Fake database: dispatch_snapshots / dispatch_changes reads return the given rows.
function db({ snapshots = [], changes = [], readError = null, writeError = null } = {}) {
    return createFakeSupabase(call => {
        if (call.has('select')) {
            if (readError) return { data: null, error: { message: readError } };
            return { data: call.table === 'dispatch_snapshots' ? snapshots : changes, error: null };
        }
        return { data: null, error: writeError ? { message: writeError } : null };
    });
}
const writes = (supabase, table) => supabase.calls.filter(c => c.table === table && c.has('upsert'));

test('snapshotOf: gate as terminal+gate, tail upper-cased, QT null dates and zero fuel are unknown', () => {
    assert.deepEqual(snapshotOf(flight()), { fuel: '18400', gate: 'A4', arrival: '2026-11-16 08:05', departure: '2026-11-16 09:10', tail: 'N37502' });
    assert.deepEqual(
        snapshotOf(flight({ QuantityInWeight: 0, Gate: '?', ArrivalDate: '0001-01-01 00:00', TerminalNumber: '-', TailNumber: '' })),
        { fuel: null, gate: null, arrival: null, departure: '2026-11-16 09:10', tail: null });
    assert.equal(snapshotOf(flight({ TerminalNumber: '0', Gate: '7' })).gate, '7');
});

test('diffSnapshots: only a known value changing to a different known value counts', () => {
    const prev = snapshotOf(flight());
    assert.deepEqual(diffSnapshots(null, prev), []);
    assert.deepEqual(diffSnapshots({ ...prev, fuel: null }, prev), [], 'first fuel figure is an assignment');
    assert.deepEqual(diffSnapshots(prev, { ...prev, gate: null }), []);
    assert.deepEqual(
        diffSnapshots(prev, { ...prev, fuel: '19000', departure: '2026-11-16 09:40', arrival: '2026-11-16 08:20' }),
        [
            { kind: 'fuel', oldValue: '18400', newValue: '19000' },
            { kind: 'arrival', oldValue: '2026-11-16 08:05', newValue: '2026-11-16 08:20' },
            { kind: 'departure', oldValue: '2026-11-16 09:10', newValue: '2026-11-16 09:40' }
        ]);
});

test('no database or no dispatches list gives null (page falls back to in-memory diffing)', async () => {
    assert.equal(await trackDispatchChanges(null, [flight()]), null);
    assert.equal(await trackDispatchChanges(db(), undefined), null);
    assert.deepEqual(await trackDispatchChanges(db(), []), {});
});

test('a first sighting stores a snapshot and records no change', async () => {
    const supabase = db();
    const result = await trackDispatchChanges(supabase, [flight()], NOW);
    assert.deepEqual(result, {});
    assert.equal(writes(supabase, 'dispatch_changes').length, 0);
    const [snap] = writes(supabase, 'dispatch_snapshots');
    assert.deepEqual(snap.args('upsert')[0], [{ ...SNAP, updated_at: NOW.toISOString() }]);
    assert.deepEqual(snap.args('upsert')[1], { onConflict: 'flight_key' });
});

test('an unchanged flight writes nothing', async () => {
    const supabase = db({ snapshots: [SNAP] });
    assert.deepEqual(await trackDispatchChanges(supabase, [flight()], NOW), {});
    assert.equal(supabase.calls.filter(c => c.has('upsert')).length, 0);
});

test('a change is logged once (idempotent on the transition) and returned after the history', async () => {
    const earlier = { flight_key: '101', kind: 'gate', old_value: 'A2', new_value: 'A4', detected_at: '2026-11-16T13:00:00.000Z' };
    const supabase = db({ snapshots: [SNAP], changes: [earlier] });
    const result = await trackDispatchChanges(supabase, [flight({ QuantityInWeight: 19000, DepartureDate: '2026-11-16 09:40' })], NOW);

    const [ins] = writes(supabase, 'dispatch_changes');
    assert.deepEqual(ins.args('upsert')[1], { onConflict: 'flight_key,kind,old_value,new_value', ignoreDuplicates: true });
    assert.deepEqual(ins.args('upsert')[0].map(r => [r.kind, r.old_value, r.new_value]),
        [['fuel', '18400', '19000'], ['departure', '2026-11-16 09:10', '2026-11-16 09:40']]);

    assert.deepEqual(result['101'], [
        { kind: 'gate', oldValue: 'A2', newValue: 'A4', detectedAt: '2026-11-16T13:00:00.000Z' },
        { kind: 'fuel', oldValue: '18400', newValue: '19000', detectedAt: NOW.toISOString() },
        { kind: 'departure', oldValue: '2026-11-16 09:10', newValue: '2026-11-16 09:40', detectedAt: NOW.toISOString() }
    ]);
});

test('a transition another client already logged is not duplicated in the result', async () => {
    const already = { flight_key: '101', kind: 'fuel', old_value: '18400', new_value: '19000', detected_at: '2026-11-16T14:59:50.000Z' };
    const result = await trackDispatchChanges(db({ snapshots: [SNAP], changes: [already] }), [flight({ QuantityInWeight: 19000 })], NOW);
    assert.equal(result['101'].length, 1);
});

test('a blanked gate keeps the last known one, so B2 -> blank -> B4 logs B2 -> B4', async () => {
    const supabase = db({ snapshots: [SNAP] });
    await trackDispatchChanges(supabase, [flight({ Gate: '' })], NOW);
    assert.equal(supabase.calls.filter(c => c.has('upsert')).length, 0, 'blank gate alone is not a change');

    const supabase2 = db({ snapshots: [SNAP] });
    const result = await trackDispatchChanges(supabase2, [flight({ Gate: '7' })], NOW);
    assert.deepEqual(result['101'].map(c => [c.kind, c.oldValue, c.newValue]), [['gate', 'A4', 'A7']]);
});

test('falls back to TransactionID as the key when there is no FlightID', async () => {
    const supabase = db();
    await trackDispatchChanges(supabase, [flight({ FlightID: null })], NOW);
    assert.equal(writes(supabase, 'dispatch_snapshots')[0].args('upsert')[0][0].flight_key, '9001');
});

test('a read failure (e.g. tables not created yet) is logged and gives null', async t => {
    const log = silenceConsole(t);
    assert.equal(await trackDispatchChanges(db({ readError: 'relation "dispatch_changes" does not exist' }), [flight()], NOW), null);
    assert.equal(log.error.mock.callCount(), 1);
});

test('a write failure is logged but the changes are still returned', async t => {
    const log = silenceConsole(t);
    const result = await trackDispatchChanges(db({ snapshots: [SNAP], writeError: 'boom' }), [flight({ Gate: '9' })], NOW);
    assert.equal(result['101'].length, 1);
    assert.ok(log.error.mock.callCount() >= 1);
});

test('/api/dispatch attaches _changes to a successful QT response', async t => {
    silenceConsole(t);
    const supabase = db({ snapshots: [SNAP] });
    const handler = loadModule(t, 'dispatch.js', { supabase });
    mockFetch(t, () => jsonResponse({ Success: true, Detail: { Dispatches: [flight({ Gate: '9' })] } }));
    const res = await invoke(handler, { method: 'POST', body: { CompanyLocationID: 'loc', UserID: 'u' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body._changes['101'].map(c => c.kind), ['gate']);
});

test('/api/dispatch without a database sends _changes: null', async t => {
    silenceConsole(t);
    const handler = loadModule(t, 'dispatch.js');
    mockFetch(t, () => jsonResponse({ Success: true, Detail: { Dispatches: [flight()] } }));
    const res = await invoke(handler, { method: 'POST', body: { CompanyLocationID: 'loc', UserID: 'u' } });
    assert.equal(res.body._changes, null);
});
