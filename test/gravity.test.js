'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, loadModule, createFakeSupabase, silenceConsole, freezeTime, assertCors } = require('./helpers');
const { correctApiGravityTo60, densityLbsGalAtTemp, apiGravityToSpecificGravity } =
    require('../api/fuel_farm/gravity-correction.js');

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);
// T2-T6 at 12,000 gal + T7 at 18,034 gal = 78,034 gal, times the 5x window multiplier.
const FARM_CAPACITY = 78034;
const WINDOW_TARGET = FARM_CAPACITY * 5;

const reading = (id, api, gallons, createdAt = `2026-11-${10 + id}T00:00:00Z`) => ({
    id, corrected_api_gravity_60: api, gallons_delivered: gallons, created_at: createdAt
});

// Serves the average query (limit 200) and the recent query (limit 10) separately.
function gravitySupabase({ average = [], recent = [], insert } = {}) {
    return createFakeSupabase(call => {
        if (call.has('insert')) {
            return insert || { data: { id: 99, ...call.args('insert')[0] }, error: null };
        }
        const limit = call.args('limit')[0];
        return { data: limit === 200 ? average : recent, error: null };
    });
}

const get = (t, supabase, query) =>
    invoke(loadModule(t, 'fuel_farm/gravity.js', { supabase }), { method: 'GET', query });
const post = (t, supabase, body) =>
    invoke(loadModule(t, 'fuel_farm/gravity.js', { supabase }), { method: 'POST', body });

const VALID = { observedTempF: 80, observedApiGravity: 42, driverApiGravity: 40.5, gallonsDelivered: 7000 };

test('OPTIONS answers 200 with CORS headers', async t => {
    const res = await invoke(loadModule(t, 'fuel_farm/gravity.js'), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assertCors(assert, res, 'GET, POST, OPTIONS');
});

test('without a database: GET degrades, everything else is 503', async t => {
    const handler = loadModule(t, 'fuel_farm/gravity.js');
    const g = await invoke(handler, { method: 'GET' });
    assert.deepEqual(g.body, { success: true, dbConnected: false, average: null, recent: [] });
    for (const method of ['POST', 'DELETE']) { // DELETE never reaches the 405 branch without a database
        const res = await invoke(handler, { method, body: VALID });
        assert.equal(res.statusCode, 503);
        assert.deepEqual(res.body, { success: false, error: 'Database not available.' });
    }
});

test('with a database, unsupported methods get 405', async t => {
    const res = await invoke(loadModule(t, 'fuel_farm/gravity.js', { supabase: gravitySupabase() }), { method: 'DELETE' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { success: false, error: 'Method not allowed' });
});

test('GET with no readings on file: average null, recent empty', async t => {
    silenceConsole(t);
    const res = await get(t, gravitySupabase());
    assert.deepEqual(res.body, { success: true, dbConnected: true, average: null, recent: [] });
});

test('GET treats a null result set like no readings', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(() => ({ data: null, error: null }));
    const res = await get(t, supabase);
    assert.equal(res.body.average, null);
    assert.deepEqual(res.body.recent, []);
});

test('GET average is gallon-weighted and rounded to 2 decimals', async t => {
    silenceConsole(t);
    const average = [reading(1, 40, 3000), reading(2, 41, 1000)];
    const res = await get(t, gravitySupabase({ average }));
    const a = res.body.average;
    assert.equal(a.apiGravity60, 40.25);
    assert.equal(a.totalGallons, 4000);
    assert.equal(a.sampleCount, 2);
    assert.equal(a.specificGravity60, apiGravityToSpecificGravity(40.25));
    assert.equal(a.densityLbsGal60, densityLbsGalAtTemp(40.25, 60));
    assert.equal(a.windowTargetGallons, WINDOW_TARGET);
    assert.equal(a.farmCapacityGallons, FARM_CAPACITY);
    assert.deepEqual(a.debug.included, [
        { id: 1, createdAt: '2026-11-11T00:00:00Z', correctedApiGravity60: 40, gallonsDelivered: 3000 },
        { id: 2, createdAt: '2026-11-12T00:00:00Z', correctedApiGravity60: 41, gallonsDelivered: 1000 }
    ]);
    assert.equal(a.debug.fetchedCount, 2);
});

test('GET window stops at the delivery that crosses 5x farm capacity, included in full', async t => {
    silenceConsole(t);
    const average = [
        reading(1, 40, 200000), // 200,000 < 390,170
        reading(2, 42, 200000), // 400,000 >= 390,170 -> included in full, then stop
        reading(3, 30, 50000)   // never reached
    ];
    const res = await get(t, gravitySupabase({ average }));
    assert.equal(res.body.average.sampleCount, 2);
    assert.equal(res.body.average.totalGallons, 400000);
    assert.equal(res.body.average.apiGravity60, 41);
    assert.equal(res.body.average.debug.fetchedCount, 3);
    assert.deepEqual(res.body.average.debug.included.map(r => r.id), [1, 2]);
});

test('GET window exactly at the target stops on equality', async t => {
    silenceConsole(t);
    const average = [reading(1, 40, WINDOW_TARGET), reading(2, 50, 1000)];
    const res = await get(t, gravitySupabase({ average }));
    assert.equal(res.body.average.sampleCount, 1);
});

test('GET uses every fetched reading when the window is never filled; numeric strings are coerced', async t => {
    silenceConsole(t);
    const average = [reading(1, '40', '1000'), reading(2, '44', '1000')];
    const res = await get(t, gravitySupabase({ average }));
    assert.equal(res.body.average.apiGravity60, 42);
    assert.equal(res.body.average.totalGallons, 2000);
});

test('GET queries newest-first with the documented limits', async t => {
    silenceConsole(t);
    const supabase = gravitySupabase();
    await get(t, supabase);
    const limits = supabase.calls.map(c => c.args('limit')[0]).sort((a, b) => a - b);
    assert.deepEqual(limits, [10, 200]);
    for (const c of supabase.calls) {
        assert.equal(c.table, 'fuel_gravity_readings');
        assert.deepEqual(c.args('order'), ['created_at', { ascending: false }]);
    }
});

test('GET returns recent readings as-is', async t => {
    silenceConsole(t);
    const recent = [{ id: 7, observed_api_gravity: 41 }, { id: 6, observed_api_gravity: 40 }];
    const res = await get(t, gravitySupabase({ average: [reading(1, 40, 1000)], recent }));
    assert.deepEqual(res.body.recent, recent);
});

test('GET atTempF adds a temperature-adjusted density to the average', async t => {
    silenceConsole(t);
    const supabase = gravitySupabase({ average: [reading(1, 40, 1000)] });
    const res = await get(t, supabase, { atTempF: '85' });
    assert.deepEqual(res.body.average.atTemp, { tempF: 85, densityLbsGal: densityLbsGalAtTemp(40, 85) });
    const cold = await get(t, gravitySupabase({ average: [reading(1, 40, 1000)] }), { atTempF: '-10' });
    assert.equal(cold.body.average.atTemp.tempF, -10);
});

test('GET ignores a non-numeric atTempF, and atTempF with no average', async t => {
    silenceConsole(t);
    const withAverage = gravitySupabase({ average: [reading(1, 40, 1000)] });
    assert.equal((await get(t, withAverage, { atTempF: 'warm' })).body.average.atTemp, undefined);
    assert.equal((await get(t, gravitySupabase(), { atTempF: '85' })).body.average, null);
});

test('GET returns a 500 if either query errors', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(call => call.args('limit')[0] === 10
        ? { data: null, error: new Error('recent failed') }
        : { data: [], error: null });
    const res = await get(t, supabase);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { success: false, error: 'Server error: recent failed' });
});

test('POST validates each required number', async t => {
    const supabase = gravitySupabase();
    for (const field of ['observedTempF', 'observedApiGravity', 'driverApiGravity', 'gallonsDelivered']) {
        for (const bad of [undefined, null, '41', NaN]) {
            const res = await post(t, supabase, { ...VALID, [field]: bad });
            assert.equal(res.statusCode, 400, `${field}=${String(bad)}`);
            assert.deepEqual(res.body, { success: false, error: `${field} must be a number` });
        }
    }
    assert.equal(supabase.calls.length, 0);
});

test('POST rejects non-positive gallonsDelivered', async t => {
    for (const gallonsDelivered of [0, -5]) {
        const res = await post(t, gravitySupabase(), { ...VALID, gallonsDelivered });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'gallonsDelivered must be > 0');
    }
});

test('POST rejects a non-numeric driverSpecificGravity but allows null/absent', async t => {
    const bad = await post(t, gravitySupabase(), { ...VALID, driverSpecificGravity: '0.81' });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.error, 'driverSpecificGravity must be a number if provided');
    silenceConsole(t);
    for (const driverSpecificGravity of [undefined, null]) {
        const supabase = gravitySupabase();
        const res = await post(t, supabase, { ...VALID, driverSpecificGravity });
        assert.equal(res.statusCode, 200);
        assert.equal(supabase.calls[0].args('insert')[0].driver_specific_gravity, null);
    }
});

test('POST validates createdAt: type, parseability, and not in the future', async t => {
    freezeTime(t, NOW);
    const bad = [12345, 'not a date', '', new Date(NOW + 6 * 60 * 1000).toISOString(), true];
    for (const createdAt of bad) {
        const res = await post(t, gravitySupabase(), { ...VALID, createdAt });
        assert.equal(res.statusCode, 400, String(createdAt));
        assert.equal(res.body.error, 'createdAt must be a valid ISO 8601 timestamp, not in the future');
    }
});

test('POST checks createdAt before the numeric fields', async t => {
    freezeTime(t, NOW);
    const res = await post(t, gravitySupabase(), { createdAt: 'garbage' });
    assert.match(res.body.error, /createdAt/);
});

test('POST accepts a backdated createdAt, and up to 5 minutes of clock skew ahead', async t => {
    silenceConsole(t);
    freezeTime(t, NOW);
    const supabase = gravitySupabase();
    const past = await post(t, supabase, { ...VALID, createdAt: '2026-11-01T08:30:00-07:00' });
    assert.equal(past.statusCode, 200);
    assert.equal(supabase.calls[0].args('insert')[0].created_at, '2026-11-01T15:30:00.000Z');

    const skew = new Date(NOW + 60 * 1000).toISOString();
    const ahead = await post(t, gravitySupabase(), { ...VALID, createdAt: skew });
    assert.equal(ahead.statusCode, 200);
});

test('POST defaults created_at to now', async t => {
    silenceConsole(t);
    freezeTime(t, NOW);
    for (const createdAt of [undefined, null]) {
        const supabase = gravitySupabase();
        await post(t, supabase, { ...VALID, createdAt });
        assert.equal(supabase.calls[0].args('insert')[0].created_at, new Date(NOW).toISOString());
    }
});

test('POST corrects to 60F, flags acceptable within 1.0 API, and returns the new average', async t => {
    silenceConsole(t);
    freezeTime(t, NOW);
    const supabase = gravitySupabase({ average: [reading(1, 40.3, 7000)] });
    const res = await post(t, supabase, { ...VALID, driverSpecificGravity: 0.8251 });
    const corrected = correctApiGravityTo60(42, 80);
    assert.equal(corrected, 40.3);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.correctedApiGravity60, corrected);
    assert.equal(res.body.acceptable, true); // |40.3 - 40.5| <= 1
    assert.equal(res.body.average.apiGravity60, 40.3);
    assert.equal(res.body.reading.id, 99);
    assert.deepEqual(supabase.calls[0].args('insert')[0], {
        observed_temp_f: 80,
        observed_api_gravity: 42,
        corrected_api_gravity_60: corrected,
        driver_api_gravity: 40.5,
        driver_specific_gravity: 0.8251,
        gallons_delivered: 7000,
        acceptable: true,
        created_at: new Date(NOW).toISOString()
    });
    assert.ok(supabase.calls[0].has('single'));
});

test('POST acceptable tolerance boundary: exactly 1.0 API passes, beyond fails', async t => {
    silenceConsole(t);
    const corrected = correctApiGravityTo60(42, 80); // 40.3
    const at = await post(t, gravitySupabase(), { ...VALID, driverApiGravity: corrected + 1 });
    assert.equal(at.body.acceptable, true);
    const below = await post(t, gravitySupabase(), { ...VALID, driverApiGravity: corrected - 1.01 });
    assert.equal(below.body.acceptable, false);
    const above = await post(t, gravitySupabase(), { ...VALID, driverApiGravity: 45 });
    assert.equal(above.body.acceptable, false);
});

test('POST returns a 500 if the insert fails', async t => {
    silenceConsole(t);
    const supabase = gravitySupabase({ insert: { data: null, error: new Error('insert failed') } });
    const res = await post(t, supabase, VALID);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { success: false, error: 'Server error: insert failed' });
});

test('POST with no body is reported as a 500', async t => {
    silenceConsole(t);
    const res = await invoke(loadModule(t, 'fuel_farm/gravity.js', { supabase: gravitySupabase() }), { method: 'POST' });
    assert.equal(res.statusCode, 500);
});
