// Vercel serverless function: historical tank_level_readings for the Jet A
// tanks (T2-T7), used to chart the total Jet A volume trend over time.
const { createClient } = require('@supabase/supabase-js');

const JET_A_TANKS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const RANGE_DAYS = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '120d': 120,
    '6mo': 182,
    '12mo': 365,
    'all': null
};
const DEFAULT_RANGE = '90d';

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    if (!supabase) {
        return res.json({ success: true, dbConnected: false, range: DEFAULT_RANGE, since: null, baseline: {}, readings: [] });
    }

    try {
        const range = RANGE_DAYS.hasOwnProperty(req.query.range) ? req.query.range : DEFAULT_RANGE;
        const days = RANGE_DAYS[range];
        const since = days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        // Baseline: latest reading before `since` for each tank, so the trend
        // starts from an accurate total instead of assuming an empty tank.
        // Not needed for "all" (since === null), as that already starts from the
        // earliest reading on file. Kick this off now so it runs concurrently
        // with the readings pagination below rather than after it.
        const baselinePromise = since === null
            ? Promise.resolve(null)
            : Promise.all(JET_A_TANKS.map(tankId =>
                supabase
                    .from('tank_level_readings')
                    .select('level')
                    .eq('tank_id', tankId)
                    .lt('recorded_at', since)
                    .order('recorded_at', { ascending: false })
                    .limit(1)
            ));

        // Supabase/PostgREST enforces a project-wide max_rows cap (1000),
        // which .limit() can't exceed. Ordered ascending, that would silently
        // drop the most recent readings for longer ranges - page through
        // with .range() instead.
        const PAGE_SIZE = 1000;
        const readings = [];
        for (let page = 0; ; page++) {
            let pageQuery = supabase
                .from('tank_level_readings')
                .select('tank_id, level, recorded_at')
                .in('tank_id', JET_A_TANKS)
                .order('recorded_at', { ascending: true })
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (since !== null) {
                pageQuery = pageQuery.gte('recorded_at', since);
            }

            const { data: pageData, error: pageError } = await pageQuery;
            if (pageError) throw pageError;

            readings.push(...pageData);
            if (pageData.length < PAGE_SIZE) break;
        }

        let baseline = {};
        const baselineResults = await baselinePromise;
        if (baselineResults) {
            JET_A_TANKS.forEach((tankId, i) => {
                const { data } = baselineResults[i];
                if (data && data.length) baseline[tankId] = Number(data[0].level);
            });
        }

        return res.json({
            success: true,
            dbConnected: true,
            range,
            since,
            baseline,
            readings: (readings || []).map(r => ({
                tankId: r.tank_id,
                level: Number(r.level),
                recordedAt: r.recorded_at
            }))
        });
    } catch (error) {
        console.error('Tank history error:', error);
        return res.status(500).json({ success: false, error: 'Server error: ' + error.message });
    }
}
