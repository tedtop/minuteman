// FAA aircraft registry lookup -> ICAO type designator, used by
// /api/flight_track for US tails adsbdb has no record of. The FAA N-number
// inquiry page is public and keyless (same source fbo-manager falls back to).
// The registry gives manufacturer + model strings ("BOEING" / "737-924ER");
// the icao-aircraft-types package (ICAO Doc 8643) turns them into a designator.
// The underscore prefix keeps Vercel from deploying this file as its own endpoint.
const icao = require('icao-aircraft-types');

const FAA_URL = 'https://registry.faa.gov/AircraftInquiry/Search/NNumberResult';
const FAA_TIMEOUT_MS = 6000;

// N, a digit 1-9, then up to 4 more digits/letters (letters are never I or O).
function isUsTail(tail) {
    return /^N[1-9][0-9A-HJ-NP-Z]{0,4}$/.test(tail);
}

function cell(html, label) {
    const match = new RegExp(`<td data-label="${label}"[^>]*>([^<]*)</td>`, 'i').exec(html);
    return match ? match[1].replace(/&amp;/g, '&').trim() || null : null;
}

// Returns { manufacturer, model }, null if the FAA answered but has no usable
// record, or undefined if it could not be reached (so the caller won't cache it).
async function fetchFaaRegistration(tail) {
    if (!isUsTail(tail)) return null;
    try {
        const response = await fetch(`${FAA_URL}?nNumberTxt=${encodeURIComponent(tail)}`, {
            headers: { 'Accept': 'text/html', 'User-Agent': 'minuteman tail lookup' },
            signal: AbortSignal.timeout(FAA_TIMEOUT_MS)
        });
        if (!response.ok) return undefined;
        const html = await response.text();
        const manufacturer = cell(html, 'Manufacturer Name');
        const model = cell(html, 'Model');
        return manufacturer && model ? { manufacturer, model } : null;
    } catch (error) {
        return undefined;
    }
}

// CRJ family: FAA lists the Canadair type certificate model, not "CRJ-700".
const CRJ_BY_CL600 = { '2B19': 'CRJ2', '2C10': 'CRJ7', '2D15': 'CRJ7', '2D24': 'CRJ9', '2E25': 'CRJX' };

// Maps an FAA manufacturer/model pair to an ICAO designator, or null when it
// can't be done with confidence. Handles the airliner spellings the generic
// matcher can't (customer codes, wing suffixes, neo suffixes); everything
// else goes through icao.findByModel.
function mapFaaToIcao(manufacturer, rawModel) {
    const model = String(rawModel || '').trim().toUpperCase();
    const maker = icao.resolveManufacturer(manufacturer);
    if (!maker || !model) return null;

    // Boeing customer codes: 737-924ER, 767-332, 757-222 -> the "-N00" series
    // name Doc 8643 uses (737-900, 767-300, 757-200). Plain "737-9" etc. are
    // MAX names and match exactly.
    if (maker === 'BOEING') {
        const customer = /^(7[0-9]7)-(\d)\d\d/.exec(model);
        if (customer) return icao.findByModel('BOEING', `${customer[1]}-${customer[2]}00`);
    }

    // Embraer 170/175: FAA "ERJ 170-200 LR/LL/ST/SU" - L* = long wing (E75L), S* = short wing (E75S).
    if (maker === 'EMBRAER') {
        const erj175 = /^ERJ[ -]?170-200\s*(L|S)/.exec(model);
        if (erj175) return erj175[1] === 'L' ? 'E75L' : 'E75S';
        const erj = /^ERJ[ -]?(170|190)-(\d{3})/.exec(model);
        if (erj) return icao.findByModel('EMBRAER', `ERJ-${erj[1]}-${erj[2]}`);
    }

    // Airbus customer codes: A321-271NX -> A-321neo, A320-232 -> A-320.
    if (maker === 'AIRBUS') {
        const airbus = /^A(3\d\d)-\d{3}(N|NX)?$/.exec(model);
        if (airbus) return icao.findByModel('AIRBUS', `A-${airbus[1]}${airbus[2] ? 'neo' : ''}`);
    }

    if (maker === 'BOMBARDIER') {
        const crj = /^CL-600-(\w{4})/.exec(model);
        if (crj && CRJ_BY_CL600[crj[1]]) return CRJ_BY_CL600[crj[1]];
    }

    return icao.findByModel(manufacturer, model);
}

// Registry lookup end to end: designator, null (answered, nothing usable), or
// undefined (FAA unreachable).
async function lookupFaaDesignator(tail) {
    const registration = await fetchFaaRegistration(tail);
    if (!registration) return registration;
    return mapFaaToIcao(registration.manufacturer, registration.model);
}

module.exports = { isUsTail, fetchFaaRegistration, mapFaaToIcao, lookupFaaDesignator };
