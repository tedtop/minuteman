// Vercel serverless function: proxy current METAR for KMSO from aviationweather.gov
// (aviationweather.gov does not send CORS headers, so the browser can't call it directly)
const METAR_URL = 'https://aviationweather.gov/api/data/metar?ids=KMSO&format=json';

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

    try {
        const response = await fetch(METAR_URL);

        if (!response.ok) {
            throw new Error(`aviationweather.gov returned status ${response.status}`);
        }

        const data = await response.json();
        const metar = Array.isArray(data) ? data[0] : null;

        return res.json({ success: true, metar });

    } catch (error) {
        console.error('METAR proxy error:', error);
        return res.status(500).json({
            success: false,
            error: 'METAR proxy error: ' + error.message
        });
    }
}
