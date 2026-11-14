'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, loadModule, mockFetch, jsonResponse, silenceConsole, assertCors } = require('./helpers');

const METAR = { icaoId: 'KMSO', temp: 12, rawOb: 'METAR KMSO ...' };

test('OPTIONS answers 200 with CORS headers', async t => {
    const res = await invoke(loadModule(t, 'metar.js'), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.ended);
    assertCors(assert, res, 'GET, OPTIONS');
});

test('non-GET methods are rejected with 405', async t => {
    const res = await invoke(loadModule(t, 'metar.js'), { method: 'POST' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { success: false, error: 'Method not allowed' });
});

test('GET proxies the first METAR from aviationweather.gov', async t => {
    const calls = mockFetch(t, () => jsonResponse([METAR, { icaoId: 'other' }]));
    const res = await invoke(loadModule(t, 'metar.js'));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, metar: METAR });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://aviationweather.gov/api/data/metar?ids=KMSO&format=json');
});

test('a non-array upstream body yields metar: null', async t => {
    mockFetch(t, () => jsonResponse({ unexpected: true }));
    const res = await invoke(loadModule(t, 'metar.js'));
    assert.deepEqual(res.body, { success: true, metar: null });
});

test('an empty array yields no metar value', async t => {
    mockFetch(t, () => jsonResponse([]));
    const res = await invoke(loadModule(t, 'metar.js'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.metar, undefined);
});

test('an upstream error status becomes a 500 with the status in the message', async t => {
    silenceConsole(t);
    mockFetch(t, () => jsonResponse({}, 503));
    const res = await invoke(loadModule(t, 'metar.js'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'METAR proxy error: aviationweather.gov returned status 503');
});

test('a network failure becomes a 500', async t => {
    silenceConsole(t);
    mockFetch(t, () => { throw new Error('socket hang up'); });
    const res = await invoke(loadModule(t, 'metar.js'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'METAR proxy error: socket hang up');
});

test('invalid JSON from upstream becomes a 500', async t => {
    silenceConsole(t);
    mockFetch(t, () => new Response('<html>', { status: 200 }));
    const res = await invoke(loadModule(t, 'metar.js'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
});
