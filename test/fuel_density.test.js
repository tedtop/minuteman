'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, loadModule, createFakeSupabase, silenceConsole, freezeTime, assertCors } = require('./helpers');

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);
const READING = { temperature_f: 55, density_lbs_gal: 6.8, recorded_at: '2026-11-13T17:00:00.000Z' };

test('OPTIONS answers 200 with CORS headers', async t => {
    const res = await invoke(loadModule(t, 'fuel_density.js'), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assertCors(assert, res, 'GET, POST, OPTIONS');
});

test('other methods get 405', async t => {
    const res = await invoke(loadModule(t, 'fuel_density.js'), { method: 'DELETE' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { success: false, error: 'Method not allowed' });
});

test('GET without a database returns reading: null', async t => {
    const res = await invoke(loadModule(t, 'fuel_density.js'), { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, reading: null });
});

test('GET returns the latest reading via an ordered, limited query', async t => {
    const supabase = createFakeSupabase(() => ({ data: READING, error: null }));
    const res = await invoke(loadModule(t, 'fuel_density.js', { supabase }), { method: 'GET' });
    assert.deepEqual(res.body, { success: true, reading: READING });
    const [call] = supabase.calls;
    assert.equal(call.table, 'fuel_density_readings');
    assert.deepEqual(call.args('order'), ['recorded_at', { ascending: false }]);
    assert.deepEqual(call.args('limit'), [1]);
    assert.ok(call.has('maybeSingle'));
});

test('GET swallows database errors and returns reading: null', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(() => ({ data: null, error: new Error('db down') }));
    const res = await invoke(loadModule(t, 'fuel_density.js', { supabase }), { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, reading: null });
});

test('POST validates input types and density > 0 before anything else', async t => {
    const handler = loadModule(t, 'fuel_density.js'); // no database: validation must still win
    const bad = [
        {},
        { temperatureF: '55', densityLbsGal: 6.8 },
        { temperatureF: 55, densityLbsGal: '6.8' },
        { temperatureF: 55, densityLbsGal: 0 },
        { temperatureF: 55, densityLbsGal: -1 },
        { densityLbsGal: 6.8 }
    ];
    for (const body of bad) {
        const res = await invoke(handler, { method: 'POST', body });
        assert.equal(res.statusCode, 400, JSON.stringify(body));
        assert.equal(res.body.success, false);
        assert.match(res.body.error, /must be numbers/);
    }
});

test('POST with valid input but no database returns 503', async t => {
    const res = await invoke(loadModule(t, 'fuel_density.js'), { method: 'POST', body: { temperatureF: 55, densityLbsGal: 6.8 } });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { success: false, error: 'Database not available.' });
});

test('POST inserts the reading with a server timestamp and returns it (negative temps allowed)', async t => {
    freezeTime(t, NOW);
    const supabase = createFakeSupabase(call => ({ data: { id: 1, ...call.args('insert')[0] }, error: null }));
    const res = await invoke(loadModule(t, 'fuel_density.js', { supabase }), {
        method: 'POST', body: { temperatureF: -5, densityLbsGal: 6.9 }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(supabase.calls[0].args('insert')[0], {
        temperature_f: -5,
        density_lbs_gal: 6.9,
        recorded_at: new Date(NOW).toISOString()
    });
    assert.equal(supabase.calls[0].table, 'fuel_density_readings');
    assert.ok(supabase.calls[0].has('single'));
    assert.equal(res.body.reading.id, 1);
});

test('POST maps an insert error to a 500', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(() => ({ data: null, error: new Error('constraint violated') }));
    const res = await invoke(loadModule(t, 'fuel_density.js', { supabase }), {
        method: 'POST', body: { temperatureF: 55, densityLbsGal: 6.8 }
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { success: false, error: 'Server error: constraint violated' });
});

test('POST with no body at all is reported as a 500, not a crash', async t => {
    silenceConsole(t);
    const res = await invoke(loadModule(t, 'fuel_density.js'), { method: 'POST' });
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /^Server error: /);
});
