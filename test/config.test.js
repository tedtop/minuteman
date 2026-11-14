'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, loadModule, assertCors } = require('./helpers');

const ENV = { QT_COMPANY_LOCATION_ID: 'loc-1', QT_USER_ID: 'user-1' };

test('OPTIONS answers 200 with CORS headers and no body', async t => {
    const res = await invoke(loadModule(t, 'config.js', { env: ENV }), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.ended);
    assert.equal(res.body, undefined);
    assertCors(assert, res, 'GET, OPTIONS');
});

test('non-GET methods are rejected with 405', async t => {
    const handler = loadModule(t, 'config.js', { env: ENV });
    for (const method of ['POST', 'PUT', 'DELETE']) {
        const res = await invoke(handler, { method });
        assert.equal(res.statusCode, 405);
        assert.deepEqual(res.body, { error: 'Method not allowed' });
    }
});

test('GET returns the QT ids from the environment', async t => {
    const res = await invoke(loadModule(t, 'config.js', { env: ENV }), { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { companyLocationId: 'loc-1', userId: 'user-1' });
});

test('GET returns 500 when either id is missing', async t => {
    for (const env of [
        { QT_COMPANY_LOCATION_ID: 'loc-1' },
        { QT_USER_ID: 'user-1' },
        {}
    ]) {
        const res = await invoke(loadModule(t, 'config.js', { env }), { method: 'GET' });
        assert.equal(res.statusCode, 500);
        assert.match(res.body.error, /missing QT_COMPANY_LOCATION_ID\/QT_USER_ID/);
    }
});
