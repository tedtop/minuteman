// Vercel serverless function for app configuration
module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Return configuration from environment variables
        const config = {
            username: process.env.QT_USERNAME,
            password: process.env.QT_PASSWORD,
            companyLocationId: process.env.QT_COMPANY_LOCATION_ID,
            userId: process.env.QT_USER_ID
        };

        // Validate required config
        if (!config.username || !config.password || !config.companyLocationId || !config.userId) {
            return res.status(500).json({
                error: 'Server configuration incomplete - missing QT credentials'
            });
        }

        return res.json(config);

    } catch (error) {
        console.error('Config error:', error);
        return res.status(500).json({
            error: 'Configuration error: ' + error.message
        });
    }
}