'use strict';
// api/login.js is deliberately-kept dead code (see its header); smoke test only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, loadModule } = require('./helpers');

test('login.js loads, answers OPTIONS and rejects non-POST and missing credentials', async t => {
    const handler = loadModule(t, 'login.js');
    assert.equal((await invoke(handler, { method: 'OPTIONS' })).statusCode, 200);
    assert.equal((await invoke(handler, { method: 'GET' })).statusCode, 405);
    const res = await invoke(handler, { method: 'POST', body: { username: 'a' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
});
