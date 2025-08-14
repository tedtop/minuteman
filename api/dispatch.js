module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, QT-Cookies');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { CompanyLocationID, UserID } = req.body;
        const cookies = req.headers['qt-cookies'] || '';

        if (!CompanyLocationID || !UserID) {
            return res.status(400).json({
                success: false,
                error: 'CompanyLocationID and UserID required'
            });
        }

        if (!cookies) {
            return res.status(401).json({
                success: false,
                error: 'QT authentication cookies required'
            });
        }

        // Make request to QT dispatch API
        const response = await fetch('https://go.qttechnologies.com/Portal/Dispatch/GetDispatchDetail', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Accept-Language': 'en-US,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Origin': 'https://go.qttechnologies.com',
                'Pragma': 'no-cache',
                'Referer': 'https://go.qttechnologies.com/Portal/Dispatch/ListDispatch?view=tab',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Cookie': cookies
            },
            body: JSON.stringify({
                CompanyLocationID,
                UserID
            })
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication failed - please login again'
                });
            }
            throw new Error(`QT API returned status ${response.status}`);
        }

        const data = await response.json();
        
        // Pass through the QT API response
        return res.json(data);

    } catch (error) {
        console.error('Dispatch proxy error:', error);
        return res.status(500).json({
            success: false,
            error: 'Dispatch proxy error: ' + error.message
        });
    }
}