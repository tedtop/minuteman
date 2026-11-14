'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, loadModule, createFakeSupabase, silenceConsole, freezeTime, assertCors } = require('./helpers');

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const JET_A = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// Serves `readings` through .range() pagination; baseline queries (those with
// .lt) are answered from `baselines` keyed by tank id.
function historySupabase({ readings = [], baselines = {} } = {}) {
    return createFakeSupabase(call => {
        if (call.has('lt')) {
            const tank = call.args('eq')[1];
            return { data: baselines[tank] ? [{ level: baselines[tank] }] : [], error: null };
        }
        const [from, to] = call.args('range');
        return { data: readings.slice(from, to + 1), error: null };
    });
}

async function run(t, supabase, query = {}) {
    freezeTime(t, NOW);
    return invoke(loadModule(t, 'fuel_farm/tank-history.js', { supabase }), { method: 'GET', query });
}

test('OPTIONS answers 200 with CORS headers', async t => {
    const res = await invoke(loadModule(t, 'fuel_farm/tank-history.js'), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assertCors(assert, res, 'GET, OPTIONS');
});

test('non-GET methods get 405', async t => {
    const res = await invoke(loadModule(t, 'fuel_farm/tank-history.js'), { method: 'POST' });
    assert.equal(res.statusCode, 405);
});

test('without a database it reports dbConnected: false with the default 90d range', async t => {
    const res = await invoke(loadModule(t, 'fuel_farm/tank-history.js'), { method: 'GET' });
    assert.deepEqual(res.body, { success: true, dbConnected: false, range: '90d', since: null, baseline: {}, readings: [] });
});

test('default range is 90d; readings are mapped and level coerced to a number', async t => {
    const supabase = historySupabase({
        readings: [
            { tank_id: 'T2', level: '55.5', recorded_at: '2026-11-01T00:00:00Z' },
            { tank_id: 'T7', level: 80, recorded_at: '2026-11-02T00:00:00Z' }
        ]
    });
    const res = await run(t, supabase);
    assert.equal(res.body.range, '90d');
    assert.equal(res.body.since, new Date(NOW - 90 * DAY).toISOString());
    assert.deepEqual(res.body.readings, [
        { tankId: 'T2', level: 55.5, recordedAt: '2026-11-01T00:00:00Z' },
        { tankId: 'T7', level: 80, recordedAt: '2026-11-02T00:00:00Z' }
    ]);
    const readingsCall = supabase.calls.find(c => c.has('range'));
    assert.deepEqual(readingsCall.args('in'), ['tank_id', JET_A]);
    assert.deepEqual(readingsCall.args('gte'), ['recorded_at', res.body.since]);
    assert.deepEqual(readingsCall.args('order'), ['recorded_at', { ascending: true }]);
});

test('each named range maps to its day count; unknown ranges fall back to 90d', async t => {
    for (const [range, days] of [['7d', 7], ['30d', 30], ['90d', 90], ['120d', 120], ['6mo', 182], ['12mo', 365]]) {
        const res = await run(t, historySupabase(), { range });
        assert.equal(res.body.range, range);
        assert.equal(res.body.since, new Date(NOW - days * DAY).toISOString());
    }
    assert.equal((await run(t, historySupabase(), { range: 'nope' })).body.range, '90d');
});

test('baseline: latest reading before `since` for each Jet A tank, only tanks that have one', async t => {
    const supabase = historySupabase({ baselines: { T2: '40', T5: 12.5 } });
    const res = await run(t, supabase, { range: '7d' });
    assert.deepEqual(res.body.baseline, { T2: 40, T5: 12.5 });
    const baselineCalls = supabase.calls.filter(c => c.has('lt'));
    assert.deepEqual(baselineCalls.map(c => c.args('eq')[1]), JET_A);
    for (const c of baselineCalls) {
        assert.deepEqual(c.args('lt'), ['recorded_at', res.body.since]);
        assert.deepEqual(c.args('order'), ['recorded_at', { ascending: false }]);
        assert.deepEqual(c.args('limit'), [1]);
    }
});

test('range=all skips the baseline queries and the lower date bound', async t => {
    const supabase = historySupabase();
    const res = await run(t, supabase, { range: 'all' });
    assert.equal(res.body.since, null);
    assert.deepEqual(res.body.baseline, {});
    assert.equal(supabase.calls.some(c => c.has('lt')), false);
    assert.equal(supabase.calls.find(c => c.has('range')).has('gte'), false);
});

test('a failed baseline query is ignored (that tank simply has no baseline)', async t => {
    const supabase = createFakeSupabase(call => call.has('lt')
        ? { data: null, error: new Error('baseline failed') }
        : { data: [], error: null });
    const res = await run(t, supabase);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.baseline, {});
});

test('pages through readings 1000 at a time', async t => {
    const readings = Array.from({ length: 2300 }, (_, i) => ({ tank_id: 'T2', level: i, recorded_at: `r${i}` }));
    const supabase = historySupabase({ readings });
    const res = await run(t, supabase, { range: 'all' });
    assert.equal(res.body.readings.length, 2300);
    assert.deepEqual(supabase.calls.map(c => c.args('range')), [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('a readings query error becomes a 500', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(call => call.has('lt')
        ? { data: [], error: null }
        : { data: null, error: new Error('read failed') });
    const res = await run(t, supabase);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { success: false, error: 'Server error: read failed' });
});
