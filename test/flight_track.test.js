'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    invoke, loadModule, mockFetch, jsonResponse, textResponse,
    createFakeSupabase, silenceConsole, freezeTime, assertCors
} = require('./helpers');

const T0 = Date.UTC(2026, 10, 13, 18, 0, 0);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ADSB_PREFIX = 'https://api.adsb.lol/v2/point/46.9158/-114.0911/250';
const ADSBDB_PREFIX = 'https://api.adsbdb.com/v0/aircraft/';
const FAA_PREFIX = 'https://registry.faa.gov/AircraftInquiry/Search/NNumberResult';

// Non-US tails never reach the FAA, so they exercise adsbdb in isolation.
const FOREIGN = 'G-ABCD';

const faaPage = (maker, model) =>
    `<table><tr><td data-label="Manufacturer Name">${maker}</td></tr><tr><td data-label="Model">${model}</td></tr></table>`;
const adsbdbHit = code => jsonResponse({ response: { aircraft: { icao_type: code } } });
const adsbdbMiss = () => jsonResponse({ response: 'unknown aircraft' }, 404);

// URL router over the three upstreams. Each route is a function(url, options)
// returning a Response; unconfigured upstreams fail the test if they are hit.
function route(t, { adsb, adsbdb, faa } = {}) {
    const calls = mockFetch(t, (url, options) => {
        if (url.startsWith(ADSB_PREFIX)) { assert.ok(adsb, 'unexpected adsb.lol call'); return adsb(url, options); }
        if (url.startsWith(ADSBDB_PREFIX)) { assert.ok(adsbdb, 'unexpected adsbdb call'); return adsbdb(url, options); }
        if (url.startsWith(FAA_PREFIX)) { assert.ok(faa, 'unexpected FAA call'); return faa(url, options); }
        throw new Error(`unexpected fetch ${url}`);
    });
    const count = prefix => calls.filter(c => c.url.startsWith(prefix)).length;
    return { calls, adsb: () => count(ADSB_PREFIX), adsbdb: () => count(ADSBDB_PREFIX), faa: () => count(FAA_PREFIX) };
}

const ac = (r, over = {}) => ({ r, dst: 100, gs: 300, alt_baro: 35000, ...over });
const adsbOk = (aircraft = []) => () => jsonResponse({ ac: aircraft });
const noType = () => adsbdbMiss();

const call = (handler, tails) => invoke(handler, { method: 'GET', query: tails === undefined ? {} : { tails } });

function setup(t, { supabase, routes } = {}) {
    silenceConsole(t);
    freezeTime(t, T0);
    const handler = loadModule(t, 'flight_track.js', { supabase });
    return { handler, upstream: route(t, routes) };
}

test('OPTIONS answers 200 with CORS headers', async t => {
    const res = await invoke(loadModule(t, 'flight_track.js'), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assertCors(assert, res, 'GET, OPTIONS');
});

test('non-GET methods get 405', async t => {
    const res = await invoke(loadModule(t, 'flight_track.js'), { method: 'POST' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { error: 'Method not allowed' });
});

test('no tails (missing, empty, or only separators) returns an empty result without any upstream call', async t => {
    const { handler, upstream } = setup(t);
    for (const tails of [undefined, '', ' , ,,']) {
        const res = await call(handler, tails);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { tracked: {}, fetchedAt: null, stale: false });
    }
    assert.equal(upstream.calls.length, 0);
});

test('tails are trimmed, upper-cased, de-duplicated and matched against live aircraft', async t => {
    const { handler, upstream } = setup(t, {
        routes: { adsb: adsbOk([ac('n123ab', { dst: 50, gs: 250 }), ac('OTHER1'), { dst: 1 }]), adsbdb: noType, faa: () => textResponse('') }
    });
    const res = await call(handler, ' n123ab , N123AB,,');
    assert.deepEqual(Object.keys(res.body.tracked), ['N123AB']);
    assert.equal(res.body.tracked.N123AB.etaMinutes, 12);
    assert.equal(upstream.adsbdb(), 1); // de-duplicated: one lookup
    assert.equal(upstream.calls.find(c => c.url.startsWith(ADSBDB_PREFIX)).url, `${ADSBDB_PREFIX}N123AB`);
    assert.equal(res.body.fetchedAt, new Date(T0).toISOString());
    assert.equal(res.body.stale, false);
});

test('summarizeAircraft: airborne aircraft', async t => {
    const { handler } = setup(t, { routes: { adsb: adsbOk([ac(FOREIGN, { dst: 120.5, gs: 241, alt_baro: 18000 })]), adsbdb: noType } });
    const res = await call(handler, FOREIGN);
    assert.deepEqual(res.body.tracked[FOREIGN], {
        distanceNm: 120.5, groundSpeedKt: 241, altitudeFt: 18000, onGround: false, etaMinutes: (120.5 / 241) * 60
    });
});

test('summarizeAircraft: alt_baro "ground" means on the ground with no altitude', async t => {
    const { handler } = setup(t, { routes: { adsb: adsbOk([ac(FOREIGN, { alt_baro: 'ground', gs: 0, dst: 0.5 })]), adsbdb: noType } });
    const s = (await call(handler, FOREIGN)).body.tracked[FOREIGN];
    assert.equal(s.onGround, true);
    assert.equal(s.altitudeFt, null);
    assert.equal(s.etaMinutes, null);
});

test('summarizeAircraft: no ETA at or below 5 kt, ETA just above it', async t => {
    for (const [gs, expectEta] of [[5, false], [4.9, false], [5.1, true], [0, false]]) {
        const { handler } = setup(t, { routes: { adsb: adsbOk([ac(FOREIGN, { gs, dst: 10 })]), adsbdb: noType } });
        const s = (await call(handler, FOREIGN)).body.tracked[FOREIGN];
        assert.equal(s.etaMinutes !== null, expectEta, `gs ${gs}`);
        assert.equal(s.groundSpeedKt, gs);
    }
});

test('summarizeAircraft: missing or non-numeric fields become null', async t => {
    const { handler } = setup(t, { routes: { adsb: adsbOk([{ r: FOREIGN, dst: '5', gs: 'fast' }]), adsbdb: noType } });
    assert.deepEqual((await call(handler, FOREIGN)).body.tracked[FOREIGN], {
        distanceNm: null, groundSpeedKt: null, altitudeFt: null, onGround: false, etaMinutes: null
    });
});

test('summarizeAircraft: no distance means no ETA even when moving', async t => {
    const { handler } = setup(t, { routes: { adsb: adsbOk([{ r: FOREIGN, gs: 300 }]), adsbdb: noType } });
    assert.equal((await call(handler, FOREIGN)).body.tracked[FOREIGN].etaMinutes, null);
});

// ---- equipment lookup -------------------------------------------------------

test('equipment: adsbdb answer is used (trimmed, upper-cased), merged into the live entry, and FAA is not asked', async t => {
    const { handler, upstream } = setup(t, {
        routes: { adsb: adsbOk([ac('N47412')]), adsbdb: () => adsbdbHit(' b39m '), faa: () => { throw new Error('FAA must not be called'); } }
    });
    const res = await call(handler, 'N47412');
    assert.equal(res.body.tracked.N47412.equipmentCode, 'B39M');
    assert.equal(res.body.tracked.N47412.distanceNm, 100);
    assert.equal(upstream.faa(), 0);
    const adsbdbCall = upstream.calls.find(c => c.url.startsWith(ADSBDB_PREFIX));
    assert.equal(adsbdbCall.options.headers.Accept, 'application/json');
    assert.ok(adsbdbCall.options.signal);
});

test('equipment: a tail out of ADS-B range still gets an entry with null position fields', async t => {
    const { handler } = setup(t, { routes: { adsb: adsbOk([]), adsbdb: () => adsbdbHit('E75L') } });
    const res = await call(handler, FOREIGN);
    assert.deepEqual(res.body.tracked[FOREIGN], {
        distanceNm: null, groundSpeedKt: null, altitudeFt: null, onGround: null, etaMinutes: null, equipmentCode: 'E75L'
    });
});

test('equipment: with no type found anywhere, out-of-range tails get no entry and live ones keep none', async t => {
    const { handler } = setup(t, { routes: { adsb: adsbOk([ac('LIVE1')]), adsbdb: noType } });
    const res = await call(handler, `LIVE1,${FOREIGN}`);
    assert.equal(res.body.tracked[FOREIGN], undefined);
    assert.ok('distanceNm' in res.body.tracked.LIVE1);
    assert.equal('equipmentCode' in res.body.tracked.LIVE1, false);
});

test('equipment: adsbdb miss falls back to the FAA registry for US tails', async t => {
    const { handler, upstream } = setup(t, {
        routes: { adsb: adsbOk([]), adsbdb: noType, faa: () => textResponse(faaPage('BOEING', '737-924ER')) }
    });
    const res = await call(handler, 'n36444');
    assert.equal(res.body.tracked.N36444.equipmentCode, 'B739');
    assert.equal(upstream.faa(), 1);
    assert.ok(upstream.calls.find(c => c.url.startsWith(FAA_PREFIX)).url.endsWith('?nNumberTxt=N36444'));
    // order: adsbdb first, then FAA
    const order = upstream.calls.map(c => c.url.split('/')[2]);
    assert.deepEqual(order.filter(h => h !== 'api.adsb.lol'), ['api.adsbdb.com', 'registry.faa.gov']);
});

test('equipment: an empty adsbdb icao_type counts as a miss and falls through to the FAA', async t => {
    const { handler, upstream } = setup(t, {
        routes: { adsb: adsbOk([]), adsbdb: () => adsbdbHit('  '), faa: () => textResponse(faaPage('AIRBUS', 'A320-232')) }
    });
    assert.equal((await call(handler, 'N326CJ')).body.tracked.N326CJ.equipmentCode, 'A320');
    assert.equal(upstream.faa(), 1);
});

test('equipment: adsbdb body shapes without a usable code are misses', async t => {
    for (const body of [{}, { response: {} }, { response: { aircraft: {} } }, { response: { aircraft: { icao_type: 5 } } }]) {
        const { handler } = setup(t, { routes: { adsb: adsbOk([]), adsbdb: () => jsonResponse(body), faa: () => { throw new Error('no FAA for foreign tails'); } } });
        assert.deepEqual((await call(handler, FOREIGN)).body.tracked, {}, JSON.stringify(body));
    }
});

test('equipment: foreign tails are never sent to the FAA', async t => {
    const { handler, upstream } = setup(t, { routes: { adsb: adsbOk([]), adsbdb: noType, faa: () => { throw new Error('nope'); } } });
    await call(handler, `${FOREIGN},C-FABC,B-2071`);
    assert.equal(upstream.faa(), 0);
});

test('equipment: FAA page without manufacturer/model, or with an unmappable one, yields no type', async t => {
    for (const html of ['<html>No record found</html>', faaPage('NO SUCH MAKER', 'X-1'), faaPage('', '')]) {
        const { handler } = setup(t, { routes: { adsb: adsbOk([]), adsbdb: noType, faa: () => textResponse(html) } });
        assert.deepEqual((await call(handler, 'N12345')).body.tracked, {});
    }
});

test('equipment cache: a hit is cached for 24h, then looked up again', async t => {
    const { handler, upstream } = setup(t, { routes: { adsb: adsbOk([]), adsbdb: () => adsbdbHit('B752') } });
    await call(handler, 'N610UX');
    t.mock.timers.setTime(T0 + 24 * HOUR - 1000);
    const cached = await call(handler, 'N610UX');
    assert.equal(cached.body.tracked.N610UX.equipmentCode, 'B752');
    assert.equal(upstream.adsbdb(), 1);
    t.mock.timers.setTime(T0 + 24 * HOUR + 1000);
    await call(handler, 'N610UX');
    assert.equal(upstream.adsbdb(), 2);
});

test('equipment cache: a definitive miss is cached for 1h only', async t => {
    const { handler, upstream } = setup(t, { routes: { adsb: adsbOk([]), adsbdb: noType } });
    await call(handler, FOREIGN);
    t.mock.timers.setTime(T0 + 59 * MIN);
    await call(handler, FOREIGN);
    assert.equal(upstream.adsbdb(), 1);
    t.mock.timers.setTime(T0 + 61 * MIN);
    await call(handler, FOREIGN);
    assert.equal(upstream.adsbdb(), 2);
});

test('equipment cache: a definitive FAA miss (adsbdb 404 + FAA answered "nothing") is cached too', async t => {
    const { handler, upstream } = setup(t, { routes: { adsb: adsbOk([]), adsbdb: noType, faa: () => textResponse('<html/>') } });
    await call(handler, 'N12345');
    await call(handler, 'N12345');
    assert.equal(upstream.adsbdb(), 1);
    assert.equal(upstream.faa(), 1);
});

test('equipment cache: an FAA-sourced hit is cached for 24h and skips both upstreams', async t => {
    const { handler, upstream } = setup(t, {
        routes: { adsb: adsbOk([]), adsbdb: noType, faa: () => textResponse(faaPage('BOEING', '737-9')) }
    });
    await call(handler, 'N47412');
    t.mock.timers.setTime(T0 + 23 * HOUR);
    const res = await call(handler, 'N47412');
    assert.equal(res.body.tracked.N47412.equipmentCode, 'B39M');
    assert.equal(upstream.adsbdb(), 1);
    assert.equal(upstream.faa(), 1);
});

test('equipment cache: failures are not cached (adsbdb network error, adsbdb 5xx, FAA unreachable, FAA non-OK)', async t => {
    const failing = {
        'adsbdb throws': { adsbdb: () => { throw new Error('ECONNRESET'); } },
        'adsbdb 500': { adsbdb: () => jsonResponse({}, 500) },
        'FAA throws': { adsbdb: noType, faa: () => { throw new Error('timeout'); } },
        'FAA 503': { adsbdb: noType, faa: () => textResponse('down', 503) }
    };
    for (const [name, routes] of Object.entries(failing)) {
        // N-number so the FAA is consulted whenever adsbdb says "no".
        const faa = routes.faa || (() => textResponse('<html/>'));
        const { handler, upstream } = setup(t, { routes: { adsb: adsbOk([]), ...routes, faa } });
        const first = await call(handler, 'N12345');
        assert.deepEqual(first.body.tracked, {}, name);
        await call(handler, 'N12345');
        assert.equal(upstream.adsbdb(), 2, `${name}: adsbdb retried`);
    }
});

test('equipment cache: a result found despite an unreachable adsbdb is still not cached (retry may find a better answer)', async t => {
    let adsbdbUp = false;
    const { handler, upstream } = setup(t, {
        routes: {
            adsb: adsbOk([]),
            adsbdb: () => adsbdbUp ? adsbdbHit('B38M') : jsonResponse({}, 502),
            faa: () => textResponse(faaPage('BOEING', '737-924ER'))
        }
    });
    assert.equal((await call(handler, 'N36444')).body.tracked.N36444.equipmentCode, 'B739');
    adsbdbUp = true;
    assert.equal((await call(handler, 'N36444')).body.tracked.N36444.equipmentCode, 'B38M');
    assert.equal(upstream.adsbdb(), 2);
});

test('equipment: lookups for several tails run independently', async t => {
    const { handler } = setup(t, {
        routes: { adsb: adsbOk([]), adsbdb: url => url.endsWith('/AAA1') ? adsbdbHit('A320') : url.endsWith('/BBB2') ? adsbdbHit('B738') : adsbdbMiss() }
    });
    const res = await call(handler, 'aaa1,bbb2,ccc3');
    assert.deepEqual(Object.keys(res.body.tracked).sort(), ['AAA1', 'BBB2']);
    assert.equal(res.body.tracked.BBB2.equipmentCode, 'B738');
});

// ---- ADS-B point data caching -----------------------------------------------

test('point cache: one adsb.lol query serves repeat requests for 60s, then it refreshes', async t => {
    const { handler, upstream } = setup(t, { routes: { adsb: adsbOk([ac(FOREIGN)]), adsbdb: noType } });
    const first = await call(handler, FOREIGN);
    assert.equal(first.body.fetchedAt, new Date(T0).toISOString());
    t.mock.timers.setTime(T0 + 59 * 1000);
    const second = await call(handler, FOREIGN);
    assert.equal(upstream.adsb(), 1);
    assert.equal(second.body.fetchedAt, new Date(T0).toISOString());
    assert.equal(second.body.stale, false);
    assert.ok(second.body.tracked[FOREIGN]);

    t.mock.timers.setTime(T0 + 61 * 1000);
    const third = await call(handler, FOREIGN);
    assert.equal(upstream.adsb(), 2);
    assert.equal(third.body.fetchedAt, new Date(T0 + 61 * 1000).toISOString());
});

test('point cache: the shared query is made once per window regardless of how many tails are requested', async t => {
    const { handler, upstream } = setup(t, { routes: { adsb: adsbOk([]), adsbdb: noType } });
    await call(handler, 'A1,B2,C3,D4');
    assert.equal(upstream.adsb(), 1);
    assert.equal(upstream.calls.find(c => c.url.startsWith(ADSB_PREFIX)).options.headers.Accept, 'application/json');
});

test('point failure with nothing cached: still answers 200 with equipment only, fetchedAt null', async t => {
    for (const adsb of [() => jsonResponse({}, 500), () => jsonResponse({ nope: 1 }), () => { throw new Error('dns'); }]) {
        const { handler } = setup(t, { routes: { adsb, adsbdb: () => adsbdbHit('B752') } });
        const res = await call(handler, FOREIGN);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.fetchedAt, null);
        assert.equal(res.body.stale, false);
        assert.equal(res.body.tracked[FOREIGN].equipmentCode, 'B752');
        assert.equal(res.body.tracked[FOREIGN].distanceNm, null);
    }
});

test('point failure after a good fetch: serves the old data flagged stale', async t => {
    let up = true;
    const { handler } = setup(t, {
        routes: { adsb: () => up ? jsonResponse({ ac: [ac(FOREIGN, { dst: 30, gs: 300 })] }) : jsonResponse({}, 503), adsbdb: noType }
    });
    await call(handler, FOREIGN);
    up = false;
    t.mock.timers.setTime(T0 + 5 * MIN);
    const res = await call(handler, FOREIGN);
    assert.equal(res.body.stale, true);
    assert.equal(res.body.fetchedAt, new Date(T0).toISOString());
    assert.equal(res.body.tracked[FOREIGN].etaMinutes, 6);
});

// ---- Supabase-backed point cache -------------------------------------------

test('supabase cache: a fresh shared row is used without calling adsb.lol', async t => {
    const supabase = createFakeSupabase(() => ({
        data: { aircraft: [ac(FOREIGN, { dst: 60, gs: 300 })], fetched_at: new Date(T0 - 30 * 1000).toISOString() }, error: null
    }));
    const { handler, upstream } = setup(t, { supabase, routes: { adsbdb: noType } });
    const res = await call(handler, FOREIGN);
    assert.equal(upstream.adsb(), 0);
    assert.equal(res.body.fetchedAt, new Date(T0 - 30 * 1000).toISOString());
    assert.equal(res.body.tracked[FOREIGN].etaMinutes, 12);
    assert.equal(supabase.calls[0].table, 'adsb_point_cache');
    assert.deepEqual(supabase.calls[0].args('eq'), ['id', 1]);
});

test('supabase cache: a stale row triggers a fetch, and the result is upserted for other instances', async t => {
    const supabase = createFakeSupabase(call => call.has('upsert')
        ? { error: null }
        : { data: { aircraft: [], fetched_at: new Date(T0 - 10 * MIN).toISOString() }, error: null });
    const { handler, upstream } = setup(t, { supabase, routes: { adsb: adsbOk([ac(FOREIGN)]), adsbdb: noType } });
    const res = await call(handler, FOREIGN);
    assert.equal(upstream.adsb(), 1);
    assert.equal(res.body.stale, false);
    const save = supabase.calls.find(c => c.has('upsert'));
    assert.equal(save.table, 'adsb_point_cache');
    assert.deepEqual(save.args('upsert')[0], { id: 1, aircraft: [ac(FOREIGN)], fetched_at: new Date(T0).toISOString() });
});

test('supabase cache: stale row plus failing adsb.lol serves the row flagged stale', async t => {
    const old = new Date(T0 - 10 * MIN).toISOString();
    const supabase = createFakeSupabase(() => ({ data: { aircraft: [ac(FOREIGN, { dst: 30, gs: 300 })], fetched_at: old }, error: null }));
    const { handler } = setup(t, { supabase, routes: { adsb: () => jsonResponse({}, 500), adsbdb: noType } });
    const res = await call(handler, FOREIGN);
    assert.equal(res.body.stale, true);
    assert.equal(res.body.fetchedAt, old);
    assert.equal(res.body.tracked[FOREIGN].etaMinutes, 6);
});

test('supabase cache: no row yet falls through to a live fetch', async t => {
    const supabase = createFakeSupabase(call => call.has('upsert') ? { error: null } : { data: null, error: null });
    const { handler, upstream } = setup(t, { supabase, routes: { adsb: adsbOk([]), adsbdb: noType } });
    await call(handler, FOREIGN);
    assert.equal(upstream.adsb(), 1);
});

test('supabase cache: a read error is logged and falls through to a live fetch', async t => {
    const supabase = createFakeSupabase(call => call.has('upsert') ? { error: null } : { data: null, error: new Error('read failed') });
    const { handler, upstream } = setup(t, { supabase, routes: { adsb: adsbOk([ac(FOREIGN)]), adsbdb: noType } });
    const res = await call(handler, FOREIGN);
    assert.equal(upstream.adsb(), 1);
    assert.ok(res.body.tracked[FOREIGN]);
});

test('supabase cache: a write error is logged but does not fail the response', async t => {
    const supabase = createFakeSupabase(call => call.has('upsert') ? { error: new Error('write failed') } : { data: null, error: null });
    const { handler } = setup(t, { supabase, routes: { adsb: adsbOk([ac(FOREIGN)]), adsbdb: noType } });
    const res = await call(handler, FOREIGN);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.stale, false);
    assert.ok(res.body.tracked[FOREIGN]);
});

test('supabase cache: a warm in-memory copy skips the database while fresh', async t => {
    const supabase = createFakeSupabase(call => call.has('upsert') ? { error: null } : { data: null, error: null });
    const { handler } = setup(t, { supabase, routes: { adsb: adsbOk([]), adsbdb: noType } });
    await call(handler, FOREIGN);
    const before = supabase.calls.length;
    t.mock.timers.setTime(T0 + 30 * 1000);
    await call(handler, FOREIGN);
    assert.equal(supabase.calls.length, before);
});
