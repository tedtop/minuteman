'use strict';
// Shared test helpers: fake Vercel req/res, fetch mocking, a chainable fake
// Supabase client, and a loader that gives each test a fresh copy of an api
// module (the modules keep state and read env vars at load time).
const path = require('node:path');

const API_DIR = path.join(__dirname, '..', 'api') + path.sep;
const SUPABASE_PATH = require.resolve('@supabase/supabase-js');
const MANAGED_ENV = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'QT_USERNAME', 'QT_PASSWORD', 'QT_COMPANY_LOCATION_ID', 'QT_USER_ID'
];

function createReq({ method = 'GET', query = {}, body } = {}) {
    return { method, query, body, headers: {} };
}

function createRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: undefined,
        ended: false,
        setHeader(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.ended = true; return this; },
        send(payload) { this.body = payload; this.ended = true; return this; },
        end(payload) { if (payload !== undefined) this.body = payload; this.ended = true; return this; }
    };
    return res;
}

// Runs a handler against a fake req/res and returns the res.
async function invoke(handler, reqOptions) {
    const res = createRes();
    await handler(createReq(reqOptions), res);
    return res;
}

const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const textResponse = (body, status = 200, setCookies = []) => {
    const headers = new Headers();
    for (const c of setCookies) headers.append('set-cookie', c);
    return new Response(body, { status, headers });
};

// Replaces global.fetch for one test. impl(url, options, callIndex) returns a
// Response (or throws / rejects). Returns the recorded calls.
function mockFetch(t, impl) {
    const calls = [];
    const original = global.fetch;
    global.fetch = async (url, options) => {
        const call = { url: String(url), options: options || {} };
        calls.push(call);
        return impl(call.url, call.options, calls.length - 1);
    };
    t.after(() => { global.fetch = original; });
    return calls;
}

// Handlers log failures with console.error/log; keep test output readable.
function silenceConsole(t) {
    return {
        error: t.mock.method(console, 'error', () => {}),
        log: t.mock.method(console, 'log', () => {}),
        warn: t.mock.method(console, 'warn', () => {})
    };
}

// Chainable, thenable stand-in for a supabase-js query builder. `responder`
// is called with the recorded call ({ table | rpc, args, ops }) when the
// query is awaited and returns { data, error }.
function createFakeSupabase(responder = () => ({ data: null, error: null })) {
    const calls = [];
    const METHODS = ['select', 'insert', 'upsert', 'order', 'limit', 'range', 'eq', 'gte', 'lt', 'in', 'maybeSingle', 'single'];

    function makeBuilder(call) {
        const builder = {};
        for (const m of METHODS) {
            builder[m] = (...args) => { call.ops.push({ m, args }); return builder; };
        }
        builder.then = (resolve, reject) =>
            Promise.resolve()
                .then(() => responder(call))
                .then(r => resolve(r === undefined ? { data: null, error: null } : r), reject);
        return builder;
    }

    function newCall(extra) {
        const call = {
            ...extra,
            ops: [],
            has(m) { return this.ops.some(o => o.m === m); },
            args(m) { const op = this.ops.find(o => o.m === m); return op ? op.args : undefined; }
        };
        calls.push(call);
        return call;
    }

    return {
        calls,
        from: table => makeBuilder(newCall({ table })),
        rpc: (name, rpcArgs) => makeBuilder(newCall({ rpc: name, rpcArgs }))
    };
}

// Loads api/<rel> fresh. With `supabase` (a fake from createFakeSupabase) the
// module sees configured SUPABASE_* env vars and that fake as its client;
// without it the env vars are unset so the module's no-database path runs.
// Env is restored when the test ends. `env` overrides other variables
// (undefined deletes).
function loadModule(t, rel, { supabase, env = {} } = {}) {
    const saved = {};
    const setEnv = (k, v) => {
        if (!(k in saved)) saved[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    };
    for (const k of MANAGED_ENV) setEnv(k, undefined);
    if (supabase) {
        setEnv('SUPABASE_URL', 'http://supabase.test');
        setEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    }
    for (const [k, v] of Object.entries(env)) setEnv(k, v);

    const clearApi = () => {
        for (const k of Object.keys(require.cache)) if (k.startsWith(API_DIR)) delete require.cache[k];
    };
    const savedStub = require.cache[SUPABASE_PATH];
    clearApi();
    require.cache[SUPABASE_PATH] = {
        id: SUPABASE_PATH, filename: SUPABASE_PATH, loaded: true,
        exports: { createClient: () => supabase }
    };
    const mod = require(path.join(API_DIR, rel));

    t.after(() => {
        clearApi();
        if (savedStub) require.cache[SUPABASE_PATH] = savedStub; else delete require.cache[SUPABASE_PATH];
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    });
    return mod;
}

// Freezes Date (only Date; real timers keep working) at `now` ms.
function freezeTime(t, now) {
    // Idempotent: calling again in one test just resets the clock.
    try { t.mock.timers.enable({ apis: ['Date'], now }); }
    catch { t.mock.timers.setTime(now); }
    return t.mock.timers;
}

// Shared CORS/method assertions.
function assertCors(assert, res, methods) {
    assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(res.headers['Access-Control-Allow-Methods'], methods);
}

module.exports = {
    createReq, createRes, invoke, jsonResponse, textResponse, mockFetch,
    silenceConsole, createFakeSupabase, loadModule, freezeTime, assertCors
};
