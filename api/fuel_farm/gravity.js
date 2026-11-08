// Vercel serverless function for fuel load gravity QC readings (hydrometer
// temp + reading, corrected to 60F in software, driver's BOL comparison,
// and the running gallon-weighted "mixed" gravity for T2-T7).
const { createClient } = require('@supabase/supabase-js');
const { correctApiGravityTo60, densityLbsGalAtTemp, apiGravityToSpecificGravity } = require('./gravity-correction');
const { tankConfig } = require('./tanks');

const ACCEPTABLE_TOLERANCE_API = 1.0;

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

// The "mixed" average is windowed by volume, not by calendar time or a fixed
// delivery count: walking backward from the most recent load, we sum
// gallons_delivered until that sum reaches (a multiple of) the combined
// usable capacity of the tanks being mixed, then stop. A calendar window
// doesn't track what's actually still in the tanks - it over- or
// under-represents the physical contents depending on how fast deliveries
// happen to be running. A volume window self-adjusts to delivery size/cadence.
//
// The multiplier is 5x (not 1x) the farm's own capacity: these tanks are
// drawn from the top by the pump, not recirculated, so a single farm-volume
// of recent deliveries isn't a real "turnover" - fuel settled near the
// bottom can sit through several delivery cycles. A bigger multiplier makes
// it more likely the window reaches back far enough to include that fuel
// too, rather than quietly assuming it mixed in sooner than it actually did.
const MIXED_TANKS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WINDOW_CAPACITY_MULTIPLIER = 5.0; // "farm volumes" of recent deliveries to average over
const MIXED_FARM_CAPACITY_GALLONS = MIXED_TANKS.reduce((sum, id) => sum + (tankConfig[id]?.capacity || 0), 0);
const WINDOW_TARGET_GALLONS = MIXED_FARM_CAPACITY_GALLONS * WINDOW_CAPACITY_MULTIPLIER;
const FETCH_LIMIT = 200; // generous cap; a handful of typical loads already covers the window

async function getMixedAverage() {
    const { data, error } = await supabase
        .from('fuel_gravity_readings')
        .select('id, corrected_api_gravity_60, gallons_delivered, created_at')
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT);

    if (error) throw error;

    if (!data || data.length === 0) {
        console.log('[gravity avg] no readings on file yet');
        return null;
    }

    // Walk newest-first, accumulating gallons until the window target is hit.
    // The delivery that crosses the line is included in full, not pro-rated -
    // simpler to reason about and log than fractional inclusion.
    const included = [];
    let cumulativeGallons = 0;
    for (const reading of data) {
        included.push(reading);
        cumulativeGallons += Number(reading.gallons_delivered);
        if (cumulativeGallons >= WINDOW_TARGET_GALLONS) break;
    }

    const totalGallons = included.reduce((sum, r) => sum + Number(r.gallons_delivered), 0);
    const weightedSum = included.reduce((sum, r) => sum + Number(r.corrected_api_gravity_60) * Number(r.gallons_delivered), 0);
    const apiGravity60 = Math.round((weightedSum / totalGallons) * 100) / 100;

    console.log(`[gravity avg] window target ${WINDOW_TARGET_GALLONS.toLocaleString()} gal (T2-T7 capacity ${MIXED_FARM_CAPACITY_GALLONS.toLocaleString()} gal x${WINDOW_CAPACITY_MULTIPLIER})`);
    console.log(`[gravity avg] using ${included.length}/${data.length} fetched reading(s), ${totalGallons.toLocaleString()} gal total${data.length === FETCH_LIMIT ? ` (hit fetch cap of ${FETCH_LIMIT} - window may be truncated)` : ''}`);
    included.forEach(r => console.log(`  - #${r.id} ${r.created_at} corrected_api=${r.corrected_api_gravity_60} gal=${r.gallons_delivered}`));
    console.log(`[gravity avg] weighted average API gravity @60F = ${apiGravity60}`);

    return {
        apiGravity60,
        specificGravity60: apiGravityToSpecificGravity(apiGravity60),
        densityLbsGal60: densityLbsGalAtTemp(apiGravity60, 60),
        totalGallons,
        sampleCount: included.length,
        windowTargetGallons: WINDOW_TARGET_GALLONS,
        farmCapacityGallons: MIXED_FARM_CAPACITY_GALLONS,
        debug: {
            windowTargetGallons: WINDOW_TARGET_GALLONS,
            farmCapacityGallons: MIXED_FARM_CAPACITY_GALLONS,
            fetchedCount: data.length,
            included: included.map(r => ({
                id: r.id,
                createdAt: r.created_at,
                correctedApiGravity60: Number(r.corrected_api_gravity_60),
                gallonsDelivered: Number(r.gallons_delivered)
            }))
        }
    };
}

async function getRecentReadings(limit) {
    const { data, error } = await supabase
        .from('fuel_gravity_readings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data || [];
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!supabase) {
        if (req.method === 'GET') {
            return res.json({ success: true, dbConnected: false, average: null, recent: [] });
        }
        return res.status(503).json({ success: false, error: 'Database not available.' });
    }

    try {
        if (req.method === 'GET') {
            const atTempF = req.query.atTempF !== undefined ? Number(req.query.atTempF) : null;

            const [average, recent] = await Promise.all([
                getMixedAverage(),
                getRecentReadings(10)
            ]);

            if (average && atTempF !== null && !Number.isNaN(atTempF)) {
                average.atTemp = {
                    tempF: atTempF,
                    densityLbsGal: densityLbsGalAtTemp(average.apiGravity60, atTempF)
                };
            }

            return res.json({ success: true, dbConnected: true, average, recent });

        } else if (req.method === 'POST') {
            const { observedTempF, observedApiGravity, driverApiGravity, driverSpecificGravity, gallonsDelivered, createdAt } = req.body;

            // Optional: the delivery's actual date/time (ISO 8601 with offset),
            // so backfilled loads sort and window correctly. Defaults to now.
            let createdAtIso = new Date().toISOString();
            if (createdAt !== undefined && createdAt !== null) {
                const parsed = new Date(createdAt);
                if (typeof createdAt !== 'string' || Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now() + 5 * 60 * 1000) {
                    return res.status(400).json({ success: false, error: 'createdAt must be a valid ISO 8601 timestamp, not in the future' });
                }
                createdAtIso = parsed.toISOString();
            }

            const requiredNumbers = { observedTempF, observedApiGravity, driverApiGravity, gallonsDelivered };
            for (const [field, value] of Object.entries(requiredNumbers)) {
                if (typeof value !== 'number' || Number.isNaN(value)) {
                    return res.status(400).json({ success: false, error: `${field} must be a number` });
                }
            }
            if (gallonsDelivered <= 0) {
                return res.status(400).json({ success: false, error: 'gallonsDelivered must be > 0' });
            }
            if (driverSpecificGravity !== undefined && driverSpecificGravity !== null && typeof driverSpecificGravity !== 'number') {
                return res.status(400).json({ success: false, error: 'driverSpecificGravity must be a number if provided' });
            }

            const correctedApiGravity60 = correctApiGravityTo60(observedApiGravity, observedTempF);
            const acceptable = Math.abs(correctedApiGravity60 - driverApiGravity) <= ACCEPTABLE_TOLERANCE_API;

            const { data, error } = await supabase
                .from('fuel_gravity_readings')
                .insert({
                    observed_temp_f: observedTempF,
                    observed_api_gravity: observedApiGravity,
                    corrected_api_gravity_60: correctedApiGravity60,
                    driver_api_gravity: driverApiGravity,
                    driver_specific_gravity: driverSpecificGravity ?? null,
                    gallons_delivered: gallonsDelivered,
                    acceptable,
                    created_at: createdAtIso
                })
                .select()
                .single();

            if (error) throw error;

            const average = await getMixedAverage();

            return res.json({
                success: true,
                reading: data,
                correctedApiGravity60,
                acceptable,
                average
            });

        } else {
            return res.status(405).json({ success: false, error: 'Method not allowed' });
        }

    } catch (error) {
        console.error('Fuel gravity API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error: ' + error.message
        });
    }
}
