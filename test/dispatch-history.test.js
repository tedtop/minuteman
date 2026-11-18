'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, loadModule, createFakeSupabase, silenceConsole, freezeTime, assertCors } = require('./helpers');

// Friday 2026-11-13 18:00 UTC
const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const row = (over = {}) => ({
    flight_key: String(1), version: 1, flight_number: 'UA100', airline_icao_code: 'UAL',
    departure_date: '2026-11-10T12:00:00.000Z', quantity: 100, quantity_in_weight: 680,
    transaction_status_id: 1, ...over
});

// Fake that serves `rows` through the handler's .range() pagination.
function pagedSupabase(rows) {
    return createFakeSupabase(call => {
        const [from, to] = call.args('range');
        return { data: rows.slice(from, to + 1), error: null };
    });
}

async function run(t, rows, query = {}) {
    freezeTime(t, NOW);
    const supabase = pagedSupabase(rows);
    const res = await invoke(loadModule(t, 'dispatch-history.js', { supabase }), { method: 'GET', query });
    return { res, supabase };
}

test('OPTIONS answers 200 with CORS headers', async t => {
    const res = await invoke(loadModule(t, 'dispatch-history.js'), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assertCors(assert, res, 'GET, OPTIONS');
});

test('non-GET methods get 405', async t => {
    const res = await invoke(loadModule(t, 'dispatch-history.js'), { method: 'POST' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { success: false, error: 'Method not allowed' });
});

test('without a database it reports dbConnected: false with the default range', async t => {
    const res = await invoke(loadModule(t, 'dispatch-history.js'), { method: 'GET', query: { range: '7d' } });
    assert.deepEqual(res.body, { success: true, dbConnected: false, range: '30d', since: null, rows: [] });
});

test('default range is 30d and groups by day', async t => {
    const { res, supabase } = await run(t, [row()]);
    assert.equal(res.body.range, '30d');
    assert.equal(res.body.groupBy, 'day');
    assert.equal(res.body.since, new Date(NOW - 30 * DAY).toISOString());
    assert.equal(res.body.dbConnected, true);
    assert.deepEqual(supabase.calls[0].args('gte'), ['departure_date', res.body.since]);
    assert.equal(supabase.calls[0].table, 'fuel_dispatch_history');
});

test('each named range maps to its day count; unknown ranges fall back to 30d', async t => {
    for (const [range, days] of [['7d', 7], ['30d', 30], ['90d', 90], ['6mo', 182], ['12mo', 365]]) {
        const { res } = await run(t, [], { range });
        assert.equal(res.body.range, range);
        assert.equal(res.body.since, new Date(NOW - days * DAY).toISOString());
    }
    const { res } = await run(t, [], { range: 'bogus' });
    assert.equal(res.body.range, '30d');
    // '120d' is a tank-history range, not a dispatch-history one
    assert.equal((await run(t, [], { range: '120d' })).res.body.range, '30d');
});

test('range=all has no lower bound and no date filter', async t => {
    const { res, supabase } = await run(t, [row()], { range: 'all' });
    assert.equal(res.body.range, 'all');
    assert.equal(res.body.since, null);
    assert.equal(supabase.calls[0].has('gte'), false);
});

test('flight and airline filters are applied as equality filters', async t => {
    const { supabase } = await run(t, [], { flight: 'UA100', airline: 'UAL' });
    assert.deepEqual(supabase.calls[0].args('eq'), ['flight_number', 'UA100']);
    const eqs = supabase.calls[0].ops.filter(o => o.m === 'eq').map(o => o.args);
    assert.deepEqual(eqs, [['flight_number', 'UA100'], ['airline_icao_code', 'UAL']]);
});

test('no filters means no eq calls', async t => {
    const { supabase } = await run(t, []);
    assert.equal(supabase.calls[0].has('eq'), false);
});

test('counts each flight once, using its latest version', async t => {
    const { res } = await run(t, [
        row({ flight_key: String(5), version: 1, quantity: 0, quantity_in_weight: 0 }),
        row({ flight_key: String(5), version: 3, quantity: 250, quantity_in_weight: 1700 }),
        row({ flight_key: String(5), version: 2, quantity: 100, quantity_in_weight: 680 })
    ]);
    assert.equal(res.body.rows.length, 1);
    assert.equal(res.body.rows[0].totalGallons, 250);
    assert.equal(res.body.rows[0].totalLbs, 1700);
    assert.equal(res.body.rows[0].dispatchCount, 1);
});

test('excludes cancelled (status 7) transactions and rows without a departure date', async t => {
    const { res } = await run(t, [
        row({ flight_key: String(1) }),
        row({ flight_key: String(2), transaction_status_id: 7 }),
        row({ flight_key: String(3), departure_date: null })
    ]);
    assert.equal(res.body.rows.length, 1);
    assert.equal(res.body.rows[0].dispatchCount, 1);
});

test('a cancelled latest version hides the flight even if earlier versions were live', async t => {
    const { res } = await run(t, [
        row({ flight_key: String(9), version: 1, transaction_status_id: 1 }),
        row({ flight_key: String(9), version: 2, transaction_status_id: 7 })
    ]);
    assert.deepEqual(res.body.rows, []);
});

test('aggregates by local (KMSO) day + flight number and rounds gallons to 1 decimal', async t => {
    const { res } = await run(t, [
        row({ flight_key: String(1), quantity: 100.04, quantity_in_weight: 680.5 }),
        row({ flight_key: String(2), quantity: 50.06, quantity_in_weight: 340.25, departure_date: '2026-11-10T23:59:00.000Z' }),
        row({ flight_key: String(3), flight_number: 'DL200', airline_icao_code: 'DAL', quantity: 10, quantity_in_weight: 68 }),
        row({ flight_key: String(4), departure_date: '2026-11-11T07:01:00.000Z', quantity: 5, quantity_in_weight: 34 }), // 00:01 MST on the 11th
        row({ flight_key: String(5), departure_date: '2026-11-11T00:01:00.000Z', quantity: 1, quantity_in_weight: 7 })  // 17:01 MST on the 10th
    ]);
    assert.deepEqual(res.body.rows, [
        { date: '2026-11-10', flightNumber: 'DL200', airlineIcaoCode: 'DAL', totalGallons: 10, totalLbs: 68, dispatchCount: 1 },
        { date: '2026-11-10', flightNumber: 'UA100', airlineIcaoCode: 'UAL', totalGallons: 151.1, totalLbs: 1027.75, dispatchCount: 3 },
        { date: '2026-11-11', flightNumber: 'UA100', airlineIcaoCode: 'UAL', totalGallons: 5, totalLbs: 34, dispatchCount: 1 }
    ]);
});

test('null quantities count as zero', async t => {
    const { res } = await run(t, [
        row({ flight_key: String(1), quantity: null, quantity_in_weight: null }),
        row({ flight_key: String(2), quantity: 20, quantity_in_weight: 136 })
    ]);
    assert.equal(res.body.rows[0].totalGallons, 20);
    assert.equal(res.body.rows[0].totalLbs, 136);
    assert.equal(res.body.rows[0].dispatchCount, 2);
});

test('groupBy=week buckets by ISO week start (Monday), Sunday belongs to the prior Monday', async t => {
    const { res } = await run(t, [
        row({ flight_key: String(1), departure_date: '2026-11-09T10:00:00.000Z' }), // Mon
        row({ flight_key: String(2), departure_date: '2026-11-12T10:00:00.000Z' }), // Thu
        row({ flight_key: String(3), departure_date: '2026-11-15T10:00:00.000Z' }), // Sun
        row({ flight_key: String(4), departure_date: '2026-11-16T10:00:00.000Z' })  // next Mon
    ], { groupBy: 'week', range: 'all' });
    assert.equal(res.body.groupBy, 'week');
    assert.deepEqual(res.body.rows.map(r => [r.date, r.dispatchCount]), [['2026-11-09', 3], ['2026-11-16', 1]]);
});

test('an unrecognised groupBy falls back to day', async t => {
    const { res } = await run(t, [row()], { groupBy: 'month' });
    assert.equal(res.body.groupBy, 'day');
});

test('rows with a missing flight number do not break aggregation or sorting', async t => {
    // NOTE: the sort comparator does `a.flightNumber?.localeCompare(b.flightNumber)`;
    // with a null flightNumber that yields undefined/"null" comparisons, so the
    // relative order of null-flight rows is not meaningful. Only asserting no crash.
    const { res } = await run(t, [
        row({ flight_key: String(1), flight_number: null }),
        row({ flight_key: String(2), flight_number: 'UA100' })
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.rows.length, 2);
});

test('pages through results 1000 rows at a time until a short page', async t => {
    const rows = Array.from({ length: 1500 }, (_, i) => row({ flight_key: String(i + 1) }));
    const { res, supabase } = await run(t, rows);
    assert.deepEqual(supabase.calls.map(c => c.args('range')), [[0, 999], [1000, 1999]]);
    assert.equal(res.body.rows[0].dispatchCount, 1500);
});

test('an exact multiple of the page size fetches one extra (empty) page', async t => {
    const rows = Array.from({ length: 1000 }, (_, i) => row({ flight_key: String(i + 1) }));
    const { supabase } = await run(t, rows);
    assert.equal(supabase.calls.length, 2);
});

test('a database error becomes a 500', async t => {
    silenceConsole(t);
    freezeTime(t, NOW);
    const supabase = createFakeSupabase(() => ({ data: null, error: new Error('timeout') }));
    const res = await invoke(loadModule(t, 'dispatch-history.js', { supabase }), { method: 'GET' });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { success: false, error: 'Server error: timeout' });
});
