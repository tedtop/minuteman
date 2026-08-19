const { createClient } = require('@supabase/supabase-js');

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

const QT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

// QT session cookie. There's exactly one QT session at a time - all clients
// (phones, office desktops) only ever talk to this proxy, never QT directly.
// Kept in-memory as a fast path for warm invocations, but persisted in
// Supabase as the source of truth: serverless invocations aren't reliably
// warm (confirmed this resets on effectively every request in practice),
// so an in-memory-only cache meant a full 5-request QT re-login on every
// single 30s poll instead of reusing one session.
let qtSessionCookie = null;

// Read/write errors here (network blip, Supabase outage, bad credentials)
// aren't specifically flagged - they degrade to the same "no cached session"
// path as a genuinely empty cache, which triggers a fresh login. If that
// degradation is persistent rather than a one-off, it's self-evident from
// the browser console: the "no cached session" warning fires on every poll
// instead of once, which is the actual signal worth noticing.
async function getCachedQtSession() {
    if (qtSessionCookie) return qtSessionCookie;
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('qt_session')
            .select('cookie')
            .eq('id', 1)
            .maybeSingle();
        if (error) throw error;
        return data?.cookie || null;
    } catch (error) {
        console.error('Failed to load cached QT session:', error.message);
        return null;
    }
}

async function saveQtSession(cookie) {
    qtSessionCookie = cookie;
    if (!supabase) return;

    const { error } = await supabase
        .from('qt_session')
        .upsert({ id: 1, cookie, updated_at: new Date().toISOString() });
    if (error) console.error('Failed to save QT session:', error.message);
}

// QT's AJAX auth handler doesn't return a real 401 for GetDispatchDetail -
// it returns HTTP 200 with {"message":"Unauthorized"} and redirects to the
// login page. Detect that disguised failure explicitly.
function isQtAuthFailure(data) {
    return !data || typeof data.Success === 'undefined';
}

// Merges Set-Cookie headers from a response into an existing "k=v; k=v"
// cookie string, replacing any cookie names that already appear.
// Uses getSetCookie() (returns each header separately) rather than the
// comma-joined .get('set-cookie'), since cookie Expires dates ("Wed, 02-Sep-2026")
// contain commas that would otherwise corrupt a naive split.
function mergeCookies(cookieString, response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    if (!setCookies.length) return cookieString;

    const jar = new Map(
        cookieString ? cookieString.split(';').map(c => c.trim().split('=').map(s => s.trim())) : []
    );
    for (const setCookie of setCookies) {
        const pair = setCookie.split(';')[0];
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');
}

// Logs in with QT_USERNAME/QT_PASSWORD to obtain a fresh session cookie.
// This restores the flow that api/login.js used before GetDispatchDetail
// started requiring an authenticated session again. Login alone isn't
// enough - QT only fully activates the session (whatever server-side state
// GetDispatchDetail checks) once the dispatch list page itself has been
// loaded in that session, same as a real browser would do before firing
// its AJAX refresh call.
async function qtLogin() {
    const { QT_USERNAME, QT_PASSWORD } = process.env;
    if (!QT_USERNAME || !QT_PASSWORD) {
        throw new Error('QT_USERNAME/QT_PASSWORD not configured - cannot refresh QT session');
    }

    const htmlHeaders = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': QT_USER_AGENT
    };

    const loginPageResponse = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
        method: 'GET',
        headers: htmlHeaders
    });
    let cookieString = mergeCookies('', loginPageResponse);

    const loginResponse = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
        method: 'POST',
        headers: {
            ...htmlHeaders,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieString
        },
        body: new URLSearchParams({ Email: QT_USERNAME, Password: QT_PASSWORD }).toString(),
        redirect: 'manual'
    });

    if (loginResponse.status !== 302 && loginResponse.status !== 200) {
        throw new Error(`QT login failed with status ${loginResponse.status}`);
    }
    cookieString = mergeCookies(cookieString, loginResponse);

    // Visit the portal home page, same as a real browser does right after
    // login, before loading the dispatch list.
    const homeResponse = await fetch('https://go.qttechnologies.com/Portal/', {
        method: 'GET',
        headers: { ...htmlHeaders, 'Cookie': cookieString }
    });
    if (!homeResponse.ok) {
        throw new Error(`QT portal home page failed to load with status ${homeResponse.status}`);
    }
    cookieString = mergeCookies(cookieString, homeResponse);

    // Warm up the session by loading the dispatch list page, mirroring what
    // a real browser does - without this, GetDispatchDetail keeps returning
    // its disguised "Unauthorized" response even with a valid login cookie.
    const listPageResponse = await fetch('https://go.qttechnologies.com/Portal/Dispatch/ListDispatch?view=tab', {
        method: 'GET',
        headers: { ...htmlHeaders, 'Cookie': cookieString, 'Referer': 'https://go.qttechnologies.com/Portal/' }
    });
    if (!listPageResponse.ok) {
        throw new Error(`QT dispatch list page failed to load with status ${listPageResponse.status}`);
    }
    cookieString = mergeCookies(cookieString, listPageResponse);

    return cookieString;
}

async function callGetDispatchDetail(companyLocationId, userId, cookie) {
    const headers = {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Origin': 'https://go.qttechnologies.com',
        'Pragma': 'no-cache',
        'Referer': 'https://go.qttechnologies.com/Portal/Dispatch/ListDispatch?view=tab',
        'User-Agent': QT_USER_AGENT,
        'X-Requested-With': 'XMLHttpRequest'
    };
    if (cookie) headers['Cookie'] = cookie;

    const response = await fetch('https://go.qttechnologies.com/Portal/Dispatch/GetDispatchDetail', {
        method: 'POST',
        headers,
        body: JSON.stringify({ CompanyLocationID: companyLocationId, UserID: userId })
    });

    return response;
}

function parseQtDate(str) {
    if (!str) return null;
    return new Date(str.replace(' ', 'T') + ':00').toISOString();
}

async function recordDispatchHistory(dispatches) {
    if (!supabase || !dispatches?.length) return;

    const rows = dispatches.map(d => ({
        transaction_id:        d.TransactionID,
        change_flags:          d.ChangeFlags ?? 0,
        flight_number:         d.FlightNumber        || null,
        tail_number:           d.TailNumber          || null,
        aircraft_type:         d.AircraftType        || null,
        airline_icao_code:     d.AirlineIcaoCode     || null,
        destination:           d.Destination         || null,
        quantity:              d.Quantity            ?? null,
        quantity_in_weight:    d.QuantityInWeight     ?? null,
        density:               d.Density             ?? null,
        transaction_status_id: d.TransactionStatusID ?? null,
        arrival_date:          parseQtDate(d.ArrivalDate),
        departure_date:        parseQtDate(d.DepartureDate),
    }));

    const { error } = await supabase
        .from('fuel_dispatch_history')
        .upsert(rows, { onConflict: 'transaction_id,change_flags', ignoreDuplicates: true });

    if (error) console.error('fuel_dispatch_history write error:', error.message);
}

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { CompanyLocationID, UserID } = req.body;

        if (!CompanyLocationID || !UserID) {
            return res.status(400).json({
                success: false,
                error: 'CompanyLocationID and UserID required'
            });
        }

        const cachedCookie = await getCachedQtSession();
        const hadCachedSession = !!cachedCookie;
        let response = await callGetDispatchDetail(CompanyLocationID, UserID, cachedCookie);
        let data = response.ok ? await response.json() : null;

        // Retry once with a fresh session if QT rejected us (real 401/403,
        // or the disguised 200-with-Unauthorized-body case).
        if (!response.ok || isQtAuthFailure(data)) {
            const initialQtStatus = response.status;
            const initialQtBody = data;
            console.error('QT auth failure on GetDispatchDetail, refreshing session. status=%d body=%j',
                initialQtStatus, initialQtBody);

            let freshCookie;
            try {
                freshCookie = await qtLogin();
            } catch (loginError) {
                console.error('QT login refresh failed:', loginError.message);
                return res.status(401).json({
                    success: false,
                    error: 'QT session expired and re-login failed: ' + loginError.message,
                    diagnostics: { stage: 'login_failed', hadCachedSession, initialQtStatus, initialQtBody, loginError: loginError.message }
                });
            }

            await saveQtSession(freshCookie);

            response = await callGetDispatchDetail(CompanyLocationID, UserID, freshCookie);
            data = response.ok ? await response.json() : null;

            if (!response.ok || isQtAuthFailure(data)) {
                console.error('QT auth failure persisted after re-login. status=%d body=%j',
                    response.status, data);
                return res.status(401).json({
                    success: false,
                    error: 'QT API rejected the request even after re-login - check QT_USERNAME/QT_PASSWORD/QT_COMPANY_LOCATION_ID/QT_USER_ID or contact QT support',
                    diagnostics: {
                        stage: 'retry_after_login_failed',
                        hadCachedSession,
                        initialQtStatus, initialQtBody,
                        retryQtStatus: response.status, retryQtBody: data
                    }
                });
            }

            // Recovered - flag it so the client can log that the session had
            // to be refreshed, without treating it as an error. No need for
            // the raw QT status/body here (that's only useful once things
            // are genuinely broken, i.e. the error paths above) - this is
            // the "it self-healed" path.
            data._proxyDiagnostics = { sessionRefreshed: true, hadCachedSession };
        } else {
            // Cache hit on the first try - still worth a quiet confirmation
            // so the browser console shows *something* every poll, rather
            // than leaving "is this actually working?" ambiguous.
            data._proxyDiagnostics = { sessionRefreshed: false };
        }

        recordDispatchHistory(data?.Detail?.Dispatches)
            .catch(e => console.error('dispatch history async error:', e));

        return res.json(data);

    } catch (error) {
        console.error('Dispatch proxy error:', error);
        return res.status(500).json({
            success: false,
            error: 'Dispatch proxy error: ' + error.message
        });
    }
}