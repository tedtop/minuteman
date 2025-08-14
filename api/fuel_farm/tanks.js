// Vercel serverless function for fuel farm tank operations
const { createClient } = require('@supabase/supabase-js');

// Tank configuration (stored in code for easy modification)
const tankConfig = {
    T1: { maxLevel: 86, fuelType: 'Avgas', capacity: 12000, name: 'Tank 1' },
    T2: { maxLevel: 86, fuelType: 'Jet A', capacity: 12000, name: 'Tank 2' },
    T3: { maxLevel: 86, fuelType: 'Jet A', capacity: 12000, name: 'Tank 3' },
    T4: { maxLevel: 86, fuelType: 'Jet A', capacity: 12000, name: 'Tank 4' },
    T5: { maxLevel: 86, fuelType: 'Jet A', capacity: 12000, name: 'Tank 5' },
    T6: { maxLevel: 86, fuelType: 'Jet A', capacity: 12000, name: 'Tank 6' },
    T7: { maxLevel: 97, fuelType: 'Jet A', capacity: 18034, name: 'Tank 7' }
};

// Initialize Supabase client
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

async function testConnection() {
    if (!supabase) return false;
    
    try {
        const { data, error } = await supabase
            .from('tank_level_readings')
            .select('id')
            .limit(1);
        
        return !error;
    } catch (error) {
        console.error('Database connection test failed:', error);
        return false;
    }
}

async function getLatestReadings() {
    if (!supabase) throw new Error('Database not configured');
    
    const { data, error } = await supabase
        .rpc('get_latest_tank_readings');

    if (error) throw error;
    return data || [];
}

async function recordTankLevel(tankId, level) {
    if (!supabase) throw new Error('Database not configured');
    
    const { data, error } = await supabase
        .from('tank_level_readings')
        .insert({
            tank_id: tankId,
            level: level,
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
        const dbConnected = await testConnection();

        if (req.method === 'GET') {
            // Get all tank levels
            let tanks = {};
            
            // Create tank objects from config
            for (const [tankId, config] of Object.entries(tankConfig)) {
                tanks[tankId] = {
                    level: 0, // default when no readings
                    maxLevel: config.maxLevel,
                    fuelType: config.fuelType,
                    capacity: config.capacity,
                    name: config.name,
                    lastUpdated: null
                };
            }

            if (dbConnected) {
                try {
                    // Get latest readings from database
                    const latestReadings = await getLatestReadings();
                    
                    // Merge readings with config
                    latestReadings.forEach(reading => {
                        if (tanks[reading.tank_id]) {
                            tanks[reading.tank_id].level = reading.level;
                            tanks[reading.tank_id].lastUpdated = reading.recorded_at;
                        }
                    });
                } catch (error) {
                    console.error('Failed to get latest readings:', error);
                    // Continue with default levels
                }
            }

            return res.json({
                success: true,
                tanks: tanks,
                dbConnected: dbConnected,
                timestamp: new Date().toISOString()
            });

        } else if (req.method === 'POST') {
            // Update tank level
            const { tankId, level } = req.body;

            // Validate tank exists in config
            if (!tankConfig[tankId]) {
                return res.status(404).json({ success: false, error: 'Tank not found' });
            }

            const tank = tankConfig[tankId];

            // Validate level
            if (typeof level !== 'number' || level < 0 || level > tank.maxLevel) {
                return res.status(400).json({
                    success: false,
                    error: `Level must be between 0 and ${tank.maxLevel} inches`
                });
            }

            // Check database connection
            if (!dbConnected) {
                return res.status(503).json({
                    success: false,
                    error: 'Database not available. Cannot persist reading.'
                });
            }

            // Record in database
            await recordTankLevel(tankId, level);

            // Return updated tank info
            const updatedTank = {
                level: level,
                maxLevel: tank.maxLevel,
                fuelType: tank.fuelType,
                capacity: tank.capacity,
                name: tank.name,
                lastUpdated: new Date().toISOString()
            };

            return res.json({
                success: true,
                tank: updatedTank,
                message: `Tank ${tankId} updated successfully`
            });

        } else {
            return res.status(405).json({ success: false, error: 'Method not allowed' });
        }

    } catch (error) {
        console.error('Fuel farm API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error: ' + error.message
        });
    }
}