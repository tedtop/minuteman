'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, loadModule, createFakeSupabase, silenceConsole, freezeTime, assertCors } = require('./helpers');

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);

test('tankConfig: all eight tanks, with sane level bounds and capacities', t => {
    const { tankConfig } = loadModule(t, 'fuel_farm/tanks.js');
    assert.deepEqual(Object.keys(tankConfig), ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'LF']);
    for (const [id, c] of Object.entries(tankConfig)) {
        assert.ok(c.minLevel <= c.usableMin, `${id} usableMin`);
        assert.ok(c.usableMin < c.usableMax, `${id} usable range`);
        assert.ok(c.usableMax <= c.maxLevel, `${id} usableMax`);
        assert.ok(c.capacity > 0, `${id} capacity`);
        assert.ok(c.name && c.fuelType, `${id} labels`);
    }
    assert.equal(tankConfig.T1.fuelType, 'Avgas');
    for (const id of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'LF']) assert.equal(tankConfig[id].fuelType, 'Jet A');
    assert.deepEqual(
        { max: tankConfig.T7.maxLevel, cap: tankConfig.T7.capacity, umin: tankConfig.T7.usableMin, umax: tankConfig.T7.usableMax },
        { max: 114, cap: 18034, umin: 14, umax: 93 }
    );
    assert.equal(tankConfig.LF.capacity, 10000);
});

test('OPTIONS answers 200 with CORS headers', async t => {
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js'), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assertCors(assert, res, 'GET, POST, OPTIONS');
});

test('other methods get 405', async t => {
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js'), { method: 'PUT' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { success: false, error: 'Method not allowed' });
});

test('GET without a database returns default tanks and dbConnected: false', async t => {
    silenceConsole(t);
    freezeTime(t, NOW);
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js'), { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.dbConnected, false);
    assert.equal(res.body.timestamp, new Date(NOW).toISOString());
    assert.equal(Object.keys(res.body.tanks).length, 8);
    assert.deepEqual(res.body.tanks.T7, {
        level: 0, minLevel: 1, maxLevel: 114, usableMin: 14, usableMax: 93,
        fuelType: 'Jet A', capacity: 18034, name: 'Tank 7', lastUpdated: null, recordedLow: null
    });
});

test('GET merges latest readings and recorded lows, ignoring unknown tank ids', async t => {
    const supabase = createFakeSupabase(call => {
        if (call.rpc === 'get_latest_tank_readings') {
            return { data: [
                { tank_id: 'T2', level: 50, recorded_at: '2026-11-13T10:00:00Z' },
                { tank_id: 'LF', level: 20, recorded_at: '2026-11-13T11:00:00Z' },
                { tank_id: 'ZZ', level: 99, recorded_at: '2026-11-13T12:00:00Z' }
            ], error: null };
        }
        if (call.table === 'tank_level_min') {
            return { data: [{ tank_id: 'T2', level: 5 }, { tank_id: 'ZZ', level: 1 }], error: null };
        }
    });
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js', { supabase }), { method: 'GET' });
    assert.equal(res.body.dbConnected, true);
    assert.equal(res.body.tanks.T2.level, 50);
    assert.equal(res.body.tanks.T2.lastUpdated, '2026-11-13T10:00:00Z');
    assert.equal(res.body.tanks.T2.recordedLow, 5);
    assert.equal(res.body.tanks.LF.level, 20);
    assert.equal(res.body.tanks.LF.recordedLow, null);
    assert.equal(res.body.tanks.T3.level, 0);
    assert.equal(res.body.tanks.ZZ, undefined);
    assert.deepEqual(supabase.calls.find(c => c.table).args('select'), ['tank_id, level']);
});

test('GET treats null data from the database as no readings', async t => {
    const supabase = createFakeSupabase(() => ({ data: null, error: null }));
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js', { supabase }), { method: 'GET' });
    assert.equal(res.body.dbConnected, true);
    assert.equal(res.body.tanks.T1.level, 0);
});

test('GET degrades to defaults with dbConnected: false when a query errors', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(call =>
        call.rpc ? { data: [{ tank_id: 'T1', level: 40, recorded_at: 'x' }], error: null }
                 : { data: null, error: new Error('min table gone') });
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js', { supabase }), { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.dbConnected, false);
    assert.equal(res.body.tanks.T1.level, 0);
});

test('POST rejects an unknown tank with 404', async t => {
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js'), { method: 'POST', body: { tankId: 'T9', level: 10 } });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { success: false, error: 'Tank not found' });
});

test('POST validates level type and per-tank bounds (inclusive)', async t => {
    const supabase = createFakeSupabase(() => ({ data: {}, error: null }));
    const handler = loadModule(t, 'fuel_farm/tanks.js', { supabase });
    const cases = [
        ['T2', 0, 400], ['T2', 1, 200], ['T2', 96, 200], ['T2', 97, 400],
        ['T7', 114, 200], ['T7', 115, 400],
        ['LF', 104, 200], ['LF', 105, 400],
        ['T2', '50', 400], ['T2', null, 400], ['T2', undefined, 400]
    ];
    for (const [tankId, level, status] of cases) {
        const res = await invoke(handler, { method: 'POST', body: { tankId, level } });
        assert.equal(res.statusCode, status, `${tankId} ${String(level)}`);
        if (status === 400) {
            assert.equal(res.body.success, false);
            assert.match(res.body.error, /^Level must be between 1 and \d+ inches$/);
        }
    }
    assert.equal(
        (await invoke(handler, { method: 'POST', body: { tankId: 'T7', level: 200 } })).body.error,
        'Level must be between 1 and 114 inches'
    );
});

test('POST without a database returns 503', async t => {
    silenceConsole(t);
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js'), { method: 'POST', body: { tankId: 'T2', level: 50 } });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { success: false, error: 'Database not available.' });
});

test('POST records the reading, updates the min cache via rpc, and returns the tank', async t => {
    freezeTime(t, NOW);
    const supabase = createFakeSupabase(() => ({ data: { id: 1 }, error: null }));
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js', { supabase }), {
        method: 'POST', body: { tankId: 'T3', level: 42.5 }
    });
    const iso = new Date(NOW).toISOString();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        success: true,
        tank: { level: 42.5, maxLevel: 96, fuelType: 'Jet A', capacity: 12000, name: 'Tank 3', lastUpdated: iso },
        message: 'Tank T3 updated successfully'
    });
    const [insert, rpc] = supabase.calls;
    assert.equal(insert.table, 'tank_level_readings');
    assert.deepEqual(insert.args('insert')[0], { tank_id: 'T3', level: 42.5, recorded_at: iso });
    assert.equal(rpc.rpc, 'update_tank_level_min');
    assert.deepEqual(rpc.rpcArgs, { p_tank_id: 'T3', p_level: 42.5, p_recorded_at: iso });
});

test('POST still succeeds when the min-cache rpc fails', async t => {
    const log = silenceConsole(t);
    const supabase = createFakeSupabase(call => call.rpc
        ? { data: null, error: new Error('rpc broke') }
        : { data: { id: 1 }, error: null });
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js', { supabase }), {
        method: 'POST', body: { tankId: 'T2', level: 30 }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(log.error.mock.callCount(), 1);
});

test('POST returns 503 and skips the rpc when the insert fails', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(() => ({ data: null, error: new Error('insert failed') }));
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js', { supabase }), {
        method: 'POST', body: { tankId: 'T2', level: 30 }
    });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { success: false, error: 'Database not available.' });
    assert.equal(supabase.calls.filter(c => c.rpc).length, 0);
});

test('POST with no body is reported as a 500', async t => {
    silenceConsole(t);
    const res = await invoke(loadModule(t, 'fuel_farm/tanks.js'), { method: 'POST' });
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /^Server error: /);
});
