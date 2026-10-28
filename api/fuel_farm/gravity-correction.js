// API gravity -> 60F correction, replicating what a GAMMON Technical
// Products GTP-3012-1A conversion wheel does for a petroleum hydrometer
// reading: given an observed API gravity and the fuel temperature it was
// read at, solve for the equivalent API gravity at 60F.
//
// This is a software cross-check only. The GTP-3012-1A wheel reading taken
// in the field is the number of record for the load-acceptance decision;
// this module's output is stored alongside it for comparison/trending, not
// as a replacement. The constants below are the "generalized refined
// products" K0/K1/K2 set from API MPMS Chapter 11.1:2004 (the current
// ASTM D1250 adjunct), selected by API gravity range - cross-referenced
// against a secondary source (Wikipedia's "Volume correction factor"
// article, which cites the 2004 standard) rather than the paid standard
// text itself, so treat small (<0.3 API) disagreements with the wheel as
// expected rounding/edition noise rather than a bug.

const WATER_DENSITY_60F_KGM3 = 999.012; // API reference density of water at 60F/0psig

function apiToDensityKgM3(api) {
    return (141.5 / (131.5 + api)) * WATER_DENSITY_60F_KGM3;
}

function densityKgM3ToApi(densityKgM3) {
    return (141.5 * WATER_DENSITY_60F_KGM3) / densityKgM3 - 131.5;
}

// Generalized refined-products K0/K1/K2, by API-at-60F range (API MPMS 11.1:2004)
function constantsForApi(api) {
    if (api <= 37.1) return { K0: 103.8720, K1: 0.2701, K2: 0 };          // Fuel oils
    if (api <= 48.0) return { K0: 330.3010, K1: 0, K2: 0 };               // Light gas oils (most Jet A)
    if (api <= 52.0) return { K0: 1489.0670, K1: 0, K2: -0.00186840 };    // Transition zone
    return { K0: 192.4571, K1: 0.2438, K2: 0 };                           // Very light gas oils
}

function alpha60For(densityKgM3) {
    const api = densityKgM3ToApi(densityKgM3);
    const { K0, K1, K2 } = constantsForApi(api);
    return K0 / (densityKgM3 * densityKgM3) + K1 / densityKgM3 + K2;
}

// VCF = exp[-alpha * dT * (1 + 0.8 * alpha * dT)], dT in Fahrenheit degrees from 60F
function volumeCorrectionFactor(alpha, deltaTempF) {
    return Math.exp(-alpha * deltaTempF * (1 + 0.8 * alpha * deltaTempF));
}

// Observed API gravity at observedTempF -> API gravity at 60F.
// Iterative because alpha60 depends on the density at 60F we're solving for;
// converges in a couple of iterations since alpha60 varies slowly with density.
function correctApiGravityTo60(observedApi, observedTempF) {
    const rhoObs = apiToDensityKgM3(observedApi);
    const deltaTempF = observedTempF - 60;

    let rho60 = rhoObs;
    for (let i = 0; i < 8; i++) {
        const alpha = alpha60For(rho60);
        const vcf = volumeCorrectionFactor(alpha, deltaTempF);
        const rho60Next = rhoObs / vcf;
        if (Math.abs(rho60Next - rho60) < 0.0001) {
            rho60 = rho60Next;
            break;
        }
        rho60 = rho60Next;
    }

    return Math.round(densityKgM3ToApi(rho60) * 100) / 100;
}

// API gravity at 60F -> estimated density (lbs/gal) at some other temperature.
// Not iterative: alpha60 is evaluated directly from the known 60F density.
function densityLbsGalAtTemp(api60, targetTempF) {
    const rho60 = apiToDensityKgM3(api60);
    const alpha = alpha60For(rho60);
    const vcf = volumeCorrectionFactor(alpha, targetTempF - 60);
    const rhoT = rho60 * vcf;
    const KGM3_TO_LBGAL = 0.00834540445;
    return Math.round(rhoT * KGM3_TO_LBGAL * 1000) / 1000;
}

function apiGravityToSpecificGravity(api) {
    return Math.round((141.5 / (131.5 + api)) * 10000) / 10000;
}

module.exports = {
    correctApiGravityTo60,
    densityLbsGalAtTemp,
    apiGravityToSpecificGravity
};
