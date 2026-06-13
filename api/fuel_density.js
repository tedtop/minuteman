// Vercel serverless function for fuel density readings (hydrometer: fuel temp + density)
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

async function getLatestReading() {
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('fuel_density_readings')
            .select('temperature_f, density_lbs_gal, recorded_at')
            .order('recorded_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Failed to get latest fuel density reading:', error);
        return null;
    }
}

async function recordReading(temperatureF, densityLbsGal) {
    if (!supabase) throw new Error('Database not configured');

    const { data, error } = await supabase
        .from('fuel_density_readings')
        .insert({
            temperature_f: temperatureF,
            density_lbs_gal: densityLbsGal,
            recorded_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            const reading = await getLatestReading();
            return res.json({ success: true, reading });

        } else if (req.method === 'POST') {
            const { temperatureF, densityLbsGal } = req.body;

            if (typeof temperatureF !== 'number' || typeof densityLbsGal !== 'number' || densityLbsGal <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'temperatureF and densityLbsGal must be numbers, and densityLbsGal must be > 0'
                });
            }

            if (!supabase) {
                return res.status(503).json({ success: false, error: 'Database not available.' });
            }

            const reading = await recordReading(temperatureF, densityLbsGal);
            return res.json({ success: true, reading });

        } else {
            return res.status(405).json({ success: false, error: 'Method not allowed' });
        }

    } catch (error) {
        console.error('Fuel density API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error: ' + error.message
        });
    }
}
