'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, silenceConsole } = require('./helpers');
const { recordDispatches, changesFromVersions } = require('../api/_dispatch_history');

// A version row as record_fuel_dispatches returns it.
let n = 0;
const version = (key, ver, fields = {}) => ({
    flight_key: key, version: ver, quantity_in_weight: 18400, gate: 'A4', tail_number: 'N37502',
    arrival_date: '2026-11-17T15:05:00+00:00', departure_date: '2026-11-17T16:10:00+00:00',
    recorded_at: `2026-11-17T14:${String(n++ % 60).padStart(2, '0')}:00+00:00`,
    ...fields
});

test('recordDispatches calls record_fuel_dispatches with the raw list and returns its rows', async () => {
    const rows = [version('1', 1)];
    const supabase = createFakeSupabase(() => ({ data: rows, error: null }));
    const dispatches = [{ FlightID: 1 }];
    assert.equal(await recordDispatches(supabase, dispatches), rows);
    assert.equal(supabase.calls[0].rpc, 'record_fuel_dispatches');
    assert.deepEqual(supabase.calls[0].rpcArgs, { p_dispatches: dispatches });
});

test('recordDispatches: no database or no list gives null; an empty list makes no call', async () => {
    assert.equal(await recordDispatches(null, []), null);
    assert.equal(await recordDispatches(createFakeSupabase(), undefined), null);
    const supabase = createFakeSupabase();
    assert.deepEqual(await recordDispatches(supabase, []), []);
    assert.equal(supabase.calls.length, 0);
});

test('recordDispatches: an error (e.g. function not created yet) is logged and gives null', async t => {
    const log = silenceConsole(t);
    const supabase = createFakeSupabase(() => ({ data: null, error: { message: 'Could not find the function' } }));
    assert.equal(await recordDispatches(supabase, [{ FlightID: 1 }]), null);
    assert.equal(log.error.mock.callCount(), 1);
});

test('a single version has no changes', () => {
    assert.deepEqual(changesFromVersions([version('1', 1)]), {});
    assert.deepEqual(changesFromVersions([]), {});
    assert.deepEqual(changesFromVersions(null), {});
});

test('each kind of change is reported, stamped with the version that brought it', () => {
    const v2 = version('1', 2, {
        quantity_in_weight: 19000, gate: 'A6', tail_number: 'N37510',
        arrival_date: '2026-11-17T15:20:00+00:00', departure_date: '2026-11-17T16:40:00+00:00'
    });
    assert.deepEqual(changesFromVersions([version('1', 1), v2])['1'], [
        { kind: 'fuel', oldValue: '18400', newValue: '19000', detectedAt: v2.recorded_at },
        { kind: 'gate', oldValue: 'A4', newValue: 'A6', detectedAt: v2.recorded_at },
        { kind: 'arrival', oldValue: '2026-11-17T15:05:00+00:00', newValue: '2026-11-17T15:20:00+00:00', detectedAt: v2.recorded_at },
        { kind: 'departure', oldValue: '2026-11-17T16:10:00+00:00', newValue: '2026-11-17T16:40:00+00:00', detectedAt: v2.recorded_at },
        { kind: 'tail', oldValue: 'N37502', newValue: 'N37510', detectedAt: v2.recorded_at }
    ]);
});

test('versions that differ only in untracked fields (status, flags) report nothing', () => {
    assert.deepEqual(changesFromVersions([version('1', 1, { flight_status: 'Planned' }), version('1', 2, { flight_status: 'In' })]), {});
});

test('a first value is an assignment, not a change (fuel 0 -> 18400, no gate -> A4)', () => {
    assert.deepEqual(changesFromVersions([version('1', 1, { quantity_in_weight: 0, gate: null }), version('1', 2)]), {});
});

test('a blank in between is skipped: A4 -> none -> A6 reads as A4 -> A6', () => {
    const changes = changesFromVersions([version('1', 1), version('1', 2, { gate: null }), version('1', 3, { gate: 'A6' })])['1'];
    assert.deepEqual(changes.map(c => [c.kind, c.oldValue, c.newValue]), [['gate', 'A4', 'A6']]);
});

test('a value changing back and forth keeps every step', () => {
    const changes = changesFromVersions([version('1', 1), version('1', 2, { gate: 'A6' }), version('1', 3), version('1', 4, { gate: 'A6' })])['1'];
    assert.deepEqual(changes.map(c => `${c.oldValue}>${c.newValue}`), ['A4>A6', 'A6>A4', 'A4>A6']);
});

test('the same instant in another string form is not a change', () => {
    assert.deepEqual(changesFromVersions([version('1', 1), version('1', 2, { arrival_date: '2026-11-17T15:05:00Z' })]), {});
});

test('flights are kept apart and versions are ordered by number, not row order', () => {
    const result = changesFromVersions([version('2', 2, { gate: 'B2' }), version('1', 1), version('2', 1, { gate: 'B1' })]);
    assert.deepEqual(Object.keys(result), ['2']);
    assert.deepEqual(result['2'].map(c => [c.oldValue, c.newValue]), [['B1', 'B2']]);
});
