const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

class FuelFarmDB {
    constructor() {
        this.connected = false;
    }

    async testConnection() {
        try {
            const { data, error } = await supabase
                .from('tank_level_readings')
                .select('id')
                .limit(1);
            
            if (error) throw error;
            this.connected = true;
            return true;
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            this.connected = false;
            return false;
        }
    }

    async getLatestReadings() {
        if (!this.connected) {
            throw new Error('Database not connected');
        }

        const { data, error } = await supabase
            .rpc('get_latest_tank_readings');

        if (error) throw error;
        return data || [];
    }

    async recordTankLevel(tankId, level) {
        if (!this.connected) {
            throw new Error('Database not connected');
        }

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

        console.log(`📊 Recorded tank ${tankId} level: ${level} inches`);
        return data;
    }

    async getTankHistory(tankId, hoursBack = 24) {
        if (!this.connected) {
            throw new Error('Database not connected');
        }

        const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

        const { data, error } = await supabase
            .from('tank_level_readings')
            .select('level, recorded_at')
            .eq('tank_id', tankId)
            .gte('recorded_at', startTime.toISOString())
            .order('recorded_at', { ascending: true });

        if (error) throw error;
        return data || [];
    }

    isConnected() {
        return this.connected;
    }
}

module.exports = new FuelFarmDB();