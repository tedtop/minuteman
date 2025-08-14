module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username and password required' 
            });
        }

        // Step 1: Get login page and initial cookies
        const loginPageResponse = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const initialCookies = loginPageResponse.headers.get('set-cookie');
        let cookieString = '';
        if (initialCookies) {
            cookieString = Array.isArray(initialCookies) ? initialCookies.join('; ') : initialCookies;
        }

        // Step 2: Perform login
        const formData = new URLSearchParams({
            'Email': username,
            'Password': password
        });

        const loginResponse = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookieString
            },
            body: formData.toString(),
            redirect: 'manual'
        });

        // Check if login was successful (should redirect)
        if (loginResponse.status === 302 || loginResponse.status === 200) {
            // Get login cookies
            const loginCookies = loginResponse.headers.get('set-cookie');
            let allCookies = cookieString;
            
            if (loginCookies) {
                const cookieArray = Array.isArray(loginCookies) ? loginCookies : [loginCookies];
                const cookieParts = [];
                
                for (const cookie of cookieArray) {
                    const cookieValue = cookie.split(';')[0];
                    cookieParts.push(cookieValue);
                }
                
                const existingParts = cookieString ? cookieString.split(';').map(c => c.trim()) : [];
                const combinedParts = [...existingParts, ...cookieParts];
                allCookies = combinedParts.join('; ');
            }

            return res.json({
                success: true,
                message: 'Login successful',
                qtCookies: allCookies
            });
        } else {
            return res.status(401).json({
                success: false,
                error: 'Login failed - invalid credentials'
            });
        }

    } catch (error) {
        console.error('Login proxy error:', error);
        return res.status(500).json({
            success: false,
            error: 'Login proxy error: ' + error.message
        });
    }
}