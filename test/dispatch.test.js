'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    invoke, loadModule, mockFetch, jsonResponse, textResponse,
    createFakeSupabase, silenceConsole, assertCors
} = require('./helpers');

const BODY = { CompanyLocationID: 'loc-1', UserID: 'user-1' };
const ENV = { QT_USERNAME: 'qt-user', QT_PASSWORD: 'qt-pass' };
const LOGIN_URL = 'https://go.qttechnologies.com/Portal/Account/Login';
const HOME_URL = 'https://go.qttechnologies.com/Portal/';
const LIST_URL = 'https://go.qttechnologies.com/Portal/Dispatch/ListDispatch?view=tab';
const DETAIL_URL = 'https://go.qttechnologies.com/Portal/Dispatch/GetDispatchDetail';

const GOOD = { Success: true, Detail: { Dispatches: [] } };
const flush = () => new Promise(resolve => setImmediate(resolve));
const post = (handler, body = BODY) => invoke(handler, { method: 'POST', body });

// QT answers GetDispatchDetail with HTTP 200 + {"message":"Unauthorized"} when it wants a login.
const unauthorized = () => jsonResponse({ message: 'Unauthorized' });

// Responses for one full qtLogin(): login page, login POST, home, dispatch list.
function loginResponses({ loginCookies = ['ASP=1; Path=/'], postCookies = ['auth=tok; Path=/'], homeCookies = [], listCookies = [] } = {}) {
    return [
        textResponse('<html/>', 200, loginCookies),
        textResponse('', 302, postCookies),
        textResponse('<html/>', 200, homeCookies),
        textResponse('<html/>', 200, listCookies)
    ];
}

// Sequential fetch script: each entry is a Response, or a function(url, options).
function scriptFetch(t, script) {
    const queue = [...script];
    return mockFetch(t, (url, options) => {
        const next = queue.shift();
        assert.ok(next, `unexpected extra fetch to ${url}`);
        return typeof next === 'function' ? next(url, options) : next;
    });
}

test('OPTIONS answers 200 with CORS headers', async t => {
    const res = await invoke(loadModule(t, 'dispatch.js'), { method: 'OPTIONS' });
    assert.equal(res.statusCode, 200);
    assertCors(assert, res, 'GET, POST, OPTIONS');
    assert.equal(res.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
});

test('non-POST methods get 405 and make no upstream calls', async t => {
    const calls = mockFetch(t, () => { throw new Error('should not fetch'); });
    const res = await invoke(loadModule(t, 'dispatch.js'), { method: 'GET' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { success: false, error: 'Method not allowed' });
    assert.equal(calls.length, 0);
});

test('missing CompanyLocationID or UserID is a 400', async t => {
    const handler = loadModule(t, 'dispatch.js');
    for (const body of [{}, { CompanyLocationID: 'a' }, { UserID: 'b' }, { CompanyLocationID: '', UserID: 'b' }]) {
        const res = await post(handler, body);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { success: false, error: 'CompanyLocationID and UserID required' });
    }
});

test('a missing request body is a 500, not a crash', async t => {
    silenceConsole(t);
    const res = await invoke(loadModule(t, 'dispatch.js'), { method: 'POST' });
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /^Dispatch proxy error: /);
});

test('with no cached session QT is called without a Cookie; success is passed through with diagnostics', async t => {
    const calls = scriptFetch(t, [jsonResponse(GOOD)]);
    const res = await post(loadModule(t, 'dispatch.js'));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ...GOOD, _proxyDiagnostics: { sessionRefreshed: false }, _changes: null });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, DETAIL_URL);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Cookie, undefined);
    assert.equal(calls[0].options.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.deepEqual(JSON.parse(calls[0].options.body), { CompanyLocationID: 'loc-1', UserID: 'user-1' });
});

test('a cached session cookie from the database is sent and no login happens', async t => {
    const supabase = createFakeSupabase(call => call.table === 'qt_session' ? { data: { cookie: 'sess=abc' }, error: null } : undefined);
    const calls = scriptFetch(t, [jsonResponse(GOOD)]);
    const res = await post(loadModule(t, 'dispatch.js', { supabase }));
    assert.equal(res.body._proxyDiagnostics.sessionRefreshed, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Cookie, 'sess=abc');
    const read = supabase.calls[0];
    assert.equal(read.table, 'qt_session');
    assert.deepEqual(read.args('eq'), ['id', 1]);
});

test('a failure loading the cached session is logged and treated as no session', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(() => ({ data: null, error: new Error('db down') }));
    const calls = scriptFetch(t, [jsonResponse(GOOD)]);
    const res = await post(loadModule(t, 'dispatch.js', { supabase }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls[0].options.headers.Cookie, undefined);
});

test('each kind of QT auth failure triggers one re-login and retry, then reports sessionRefreshed', async t => {
    silenceConsole(t);
    const failures = {
        'disguised 200 Unauthorized': () => unauthorized(),
        'empty 200 body': () => textResponse(''),
        'non-JSON 200 body': () => textResponse('<html>login</html>'),
        'real 401': () => jsonResponse({ Success: true }, 401),
        'JSON null': () => textResponse('null')
    };
    for (const [name, failure] of Object.entries(failures)) {
        const calls = scriptFetch(t, [failure(), ...loginResponses(), jsonResponse(GOOD)]);
        const supabase = createFakeSupabase(() => ({ data: null, error: null }));
        const res = await post(loadModule(t, 'dispatch.js', { env: ENV, supabase }));
        assert.equal(res.statusCode, 200, name);
        assert.deepEqual(res.body._proxyDiagnostics, { sessionRefreshed: true, hadCachedSession: false }, name);
        assert.deepEqual(calls.map(c => c.url), [DETAIL_URL, LOGIN_URL, LOGIN_URL, HOME_URL, LIST_URL, DETAIL_URL], name);
    }
});

test('re-login: sends credentials as a form POST, forwards cookies, persists the fresh session', async t => {
    silenceConsole(t);
    const supabase = createFakeSupabase(() => ({ data: { cookie: 'old=1' }, error: null }));
    const calls = scriptFetch(t, [
        unauthorized(),
        ...loginResponses({ loginCookies: ['ASP=1; Path=/'], postCookies: ['ASP=2; Path=/', 'auth=tok; HttpOnly'], homeCookies: ['home=h'], listCookies: ['list=l'] }),
        jsonResponse(GOOD)
    ]);
    const res = await post(loadModule(t, 'dispatch.js', { env: ENV, supabase }));
    assert.deepEqual(res.body._proxyDiagnostics, { sessionRefreshed: true, hadCachedSession: true });
    assert.equal(calls[0].options.headers.Cookie, 'old=1');

    const [, loginGet, loginPost, home, list, retry] = calls;
    assert.equal(loginGet.options.method, 'GET');
    assert.equal(loginPost.options.method, 'POST');
    assert.equal(loginPost.options.redirect, 'manual');
    assert.equal(loginPost.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(loginPost.options.headers.Cookie, 'ASP=1');
    const form = new URLSearchParams(loginPost.options.body);
    assert.equal(form.get('Email'), 'qt-user');
    assert.equal(form.get('Password'), 'qt-pass');
    // later cookies replace same-named ones and accumulate
    assert.equal(home.options.headers.Cookie, 'ASP=2; auth=tok');
    assert.equal(list.options.headers.Cookie, 'ASP=2; auth=tok; home=h');
    assert.equal(list.options.headers.Referer, HOME_URL);
    assert.equal(retry.options.headers.Cookie, 'ASP=2; auth=tok; home=h; list=l');

    const save = supabase.calls.find(c => c.has('upsert'));
    assert.equal(save.table, 'qt_session');
    const saved = save.args('upsert')[0];
    assert.equal(saved.id, 1);
    assert.equal(saved.cookie, 'ASP=2; auth=tok; home=h; list=l');
    assert.ok(!Number.isNaN(Date.parse(saved.updated_at)));
});

test('the refreshed session is kept in memory: the next request reuses it without a database or login', async t => {
    silenceConsole(t);
    const calls = scriptFetch(t, [unauthorized(), ...loginResponses(), jsonResponse(GOOD), jsonResponse(GOOD)]);
    const handler = loadModule(t, 'dispatch.js', { env: ENV });
    await post(handler);
    const second = await post(handler);
    assert.equal(second.body._proxyDiagnostics.sessionRefreshed, false);
    assert.equal(calls.length, 7); // detail + 4 login steps + retry + second request
    assert.equal(calls[6].options.headers.Cookie, 'ASP=1; auth=tok');
});

test('a failure saving the session is logged but does not fail the request', async t => {
    const log = silenceConsole(t);
    const supabase = createFakeSupabase(call => call.has('upsert') ? { error: new Error('write failed') } : { data: null, error: null });
    scriptFetch(t, [unauthorized(), ...loginResponses(), jsonResponse(GOOD)]);
    const res = await post(loadModule(t, 'dispatch.js', { env: ENV, supabase }));
    assert.equal(res.statusCode, 200);
    assert.ok(log.error.mock.calls.some(c => String(c.arguments[1] ?? c.arguments[0]).includes('write failed')));
});

test('re-login without QT_USERNAME/QT_PASSWORD gives a 401 login_failed with diagnostics', async t => {
    silenceConsole(t);
    scriptFetch(t, [unauthorized()]);
    const res = await post(loadModule(t, 'dispatch.js'));
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /QT session expired and re-login failed: QT_USERNAME\/QT_PASSWORD not configured/);
    assert.deepEqual(res.body.diagnostics, {
        stage: 'login_failed', hadCachedSession: false, initialQtStatus: 200,
        initialQtBody: { message: 'Unauthorized' },
        loginError: 'QT_USERNAME/QT_PASSWORD not configured - cannot refresh QT session'
    });
});

test('each qtLogin step that fails produces a 401 naming the step', async t => {
    silenceConsole(t);
    const cases = [
        ['login POST rejected', [textResponse('', 200), textResponse('', 500)], /QT login failed with status 500/],
        ['home page fails', [textResponse('', 200), textResponse('', 302), textResponse('x', 503)], /QT portal home page failed to load with status 503/],
        ['list page fails', [textResponse('', 200), textResponse('', 302), textResponse('ok', 200), textResponse('x', 404)], /QT dispatch list page failed to load with status 404/]
    ];
    for (const [name, steps, pattern] of cases) {
        scriptFetch(t, [unauthorized(), ...steps]);
        const res = await post(loadModule(t, 'dispatch.js', { env: ENV }));
        assert.equal(res.statusCode, 401, name);
        assert.match(res.body.error, pattern, name);
        assert.equal(res.body.diagnostics.stage, 'login_failed', name);
    }
});

test('login POST status 200 is also accepted as success', async t => {
    silenceConsole(t);
    scriptFetch(t, [unauthorized(), textResponse('', 200), textResponse('', 200), textResponse('', 200), textResponse('', 200), jsonResponse(GOOD)]);
    const res = await post(loadModule(t, 'dispatch.js', { env: ENV }));
    assert.equal(res.statusCode, 200);
});

test('still failing after re-login gives a 401 retry_after_login_failed with both statuses', async t => {
    silenceConsole(t);
    scriptFetch(t, [unauthorized(), ...loginResponses(), textResponse('<html>nope</html>', 200)]);
    const res = await post(loadModule(t, 'dispatch.js', { env: ENV }));
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /rejected the request even after re-login/);
    assert.deepEqual(res.body.diagnostics, {
        stage: 'retry_after_login_failed', hadCachedSession: false,
        initialQtStatus: 200, initialQtBody: { message: 'Unauthorized' },
        retryQtStatus: 200, retryQtBody: '<html>nope</html>'
    });
});

test('raw bodies in diagnostics are truncated to 500 characters', async t => {
    silenceConsole(t);
    scriptFetch(t, [textResponse('x'.repeat(900)), ...loginResponses(), textResponse('y'.repeat(900))]);
    const res = await post(loadModule(t, 'dispatch.js', { env: ENV }));
    assert.equal(res.body.diagnostics.initialQtBody.length, 500);
    assert.equal(res.body.diagnostics.retryQtBody.length, 500);
});

test('an unreadable QT response body is treated as an auth failure with a diagnostic note', async t => {
    silenceConsole(t);
    const broken = { ok: true, status: 200, headers: new Headers(), text: async () => { throw new Error('stream reset'); } };
    scriptFetch(t, [broken]);
    const res = await post(loadModule(t, 'dispatch.js')); // no QT credentials, so the retry stops at login_failed
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.diagnostics.initialQtBody, '<failed to read response body: stream reset>');
});

test('an exception while calling QT becomes a 500', async t => {
    silenceConsole(t);
    mockFetch(t, () => { throw new Error('ECONNRESET'); });
    const res = await post(loadModule(t, 'dispatch.js'));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { success: false, error: 'Dispatch proxy error: ECONNRESET' });
});

test('mergeCookies ignores responses without Set-Cookie (login keeps the previous cookies)', async t => {
    silenceConsole(t);
    const calls = scriptFetch(t, [unauthorized(), ...loginResponses({ loginCookies: ['a=1'], postCookies: [], homeCookies: [], listCookies: [] }), jsonResponse(GOOD)]);
    await post(loadModule(t, 'dispatch.js', { env: ENV }));
    assert.equal(calls[5].options.headers.Cookie, 'a=1');
});

test('SUSPECTED BUG: cookie values containing "=" are truncated when later Set-Cookie headers are merged', async t => {
    silenceConsole(t);
    // mergeCookies re-parses the existing jar with split('=') and keeps only the
    // first two pieces, so a base64-style value like "tok==" becomes "tok" as soon as
    // another response sets any cookie. Documenting current behavior; a correct
    // implementation would keep 'tok=='.
    const calls = scriptFetch(t, [unauthorized(), ...loginResponses({ loginCookies: ['pad=tok=='], postCookies: ['other=1'] }), jsonResponse(GOOD)]);
    await post(loadModule(t, 'dispatch.js', { env: ENV }));
    assert.equal(calls[3].options.headers.Cookie, 'pad=tok; other=1');
});

test('dispatches are recorded to fuel_dispatch_history after the response (flag and null mapping)', async t => {
    const supabase = createFakeSupabase(() => ({ data: null, error: null }));
    const dispatches = [
        {
            TransactionID: 11, ChangeFlags: 2, FlightNumber: 'UA100', TailNumber: 'N47412', AircraftType: '737',
            AirlineIcaoCode: 'UAL', Destination: 'KDEN', Quantity: 0, QuantityInWeight: 0, Density: 6.7,
            TransactionStatusID: 3, ArrivalDate: '2026-11-13 14:30', DepartureDate: '2026-11-13 16:05'
        },
        { TransactionID: 12, FlightNumber: '', Quantity: null }
    ];
    scriptFetch(t, [jsonResponse({ Success: true, Detail: { Dispatches: dispatches } })]);
    const res = await post(loadModule(t, 'dispatch.js', { supabase }));
    await flush();
    assert.equal(res.statusCode, 200);

    const write = supabase.calls.find(c => c.table === 'fuel_dispatch_history');
    assert.deepEqual(write.args('upsert')[1], { onConflict: 'transaction_id,change_flags', ignoreDuplicates: true });
    const [full, sparse] = write.args('upsert')[0];
    assert.deepEqual(full, {
        transaction_id: 11, change_flags: 2, flight_number: 'UA100', tail_number: 'N47412', aircraft_type: '737',
        airline_icao_code: 'UAL', destination: 'KDEN',
        quantity: 0, quantity_in_weight: 0, density: 6.7, transaction_status_id: 3, // zero kept, not nulled
        // QT dates are "YYYY-MM-DD HH:mm" in server-local time
        arrival_date: new Date('2026-11-13T14:30:00').toISOString(),
        departure_date: new Date('2026-11-13T16:05:00').toISOString()
    });
    assert.deepEqual(sparse, {
        transaction_id: 12, change_flags: 0, flight_number: null, tail_number: null, aircraft_type: null,
        airline_icao_code: null, destination: null, quantity: null, quantity_in_weight: null, density: null,
        transaction_status_id: null, arrival_date: null, departure_date: null
    });
});

test('history is not written when there are no dispatches or no database', async t => {
    const supabase = createFakeSupabase(() => ({ data: null, error: null }));
    scriptFetch(t, [jsonResponse({ Success: true, Detail: { Dispatches: [] } }), jsonResponse({ Success: true })]);
    const handler = loadModule(t, 'dispatch.js', { supabase });
    await post(handler);
    await post(handler);
    await flush();
    assert.equal(supabase.calls.filter(c => c.table === 'fuel_dispatch_history').length, 0);
});

test('a history write failure is logged and does not affect the response', async t => {
    const log = silenceConsole(t);
    const supabase = createFakeSupabase(call => call.table === 'fuel_dispatch_history'
        ? { error: new Error('history write failed') } : { data: null, error: null });
    scriptFetch(t, [jsonResponse({ Success: true, Detail: { Dispatches: [{ TransactionID: 1 }] } })]);
    const res = await post(loadModule(t, 'dispatch.js', { supabase }));
    await flush();
    assert.equal(res.statusCode, 200);
    assert.ok(log.error.mock.calls.some(c => c.arguments.join(' ').includes('history write failed')));
});

test('a history write that throws is caught by the fire-and-forget handler', async t => {
    const log = silenceConsole(t);
    const supabase = createFakeSupabase(call => {
        if (call.table === 'fuel_dispatch_history') throw new Error('boom');
        return { data: null, error: null };
    });
    scriptFetch(t, [jsonResponse({ Success: true, Detail: { Dispatches: [{ TransactionID: 1 }] } })]);
    const res = await post(loadModule(t, 'dispatch.js', { supabase }));
    await flush();
    assert.equal(res.statusCode, 200);
    assert.ok(log.error.mock.calls.some(c => String(c.arguments[0]).includes('dispatch history async error')));
});
