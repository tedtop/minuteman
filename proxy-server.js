const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (the HTML file)
app.use(express.static(__dirname));

// Specific route for the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'fuel_dispatch_app.html'));
});

app.get('/fuel_dispatch_app', (req, res) => {
    res.sendFile(path.join(__dirname, 'fuel_dispatch_app.html'));
});

app.get('/fuel_farm', (req, res) => {
    res.sendFile(path.join(__dirname, 'fuel_farm.html'));
});

// Store session cookies
let sessionCookies = '';
let isAuthenticated = false;

// Fuel Farm tank data storage (in production, use a database)
let fuelTanks = {
    T1: { level: 30, maxLevel: 86, fuelType: 'Avgas', lastUpdated: '2025-07-30T09:00:00.000Z' },
    T2: { level: 23.5, maxLevel: 86, fuelType: 'Jet A', lastUpdated: '2025-07-30T09:00:00.000Z' },
    T3: { level: 26.5, maxLevel: 86, fuelType: 'Jet A', lastUpdated: '2025-07-30T09:00:00.000Z' },
    T4: { level: 17.5, maxLevel: 86, fuelType: 'Jet A', lastUpdated: '2025-07-30T09:00:00.000Z' },
    T5: { level: 14.5, maxLevel: 86, fuelType: 'Jet A', lastUpdated: '2025-07-30T09:00:00.000Z' },
    T6: { level: 12, maxLevel: 86, fuelType: 'Jet A', lastUpdated: '2025-07-30T09:00:00.000Z' },
    T7: { level: 56, maxLevel: 86, fuelType: 'Jet A', lastUpdated: '2025-07-30T09:00:00.000Z' }
};

// Authenticate on server startup
async function authenticateOnStartup() {
    try {
        console.log('🔐 Authenticating to QT Technologies on server startup...');
        
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
            'Email': process.env.QT_USERNAME,
            'Password': process.env.QT_PASSWORD
        });
        
        const response = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://go.qttechnologies.com/Portal/Account/Login',
                'Origin': 'https://go.qttechnologies.com',
                'Cookie': cookieString
            },
            body: formData,
            redirect: 'manual'
        });

        // Step 3: Process login cookies
        const loginCookies = response.headers.get('set-cookie');
        if (loginCookies) {
            const cookieArray = Array.isArray(loginCookies) ? loginCookies : [loginCookies];
            const cookieParts = [];
            
            for (const cookie of cookieArray) {
                const cookieValue = cookie.split(';')[0];
                cookieParts.push(cookieValue);
            }
            
            const existingParts = cookieString ? cookieString.split(';').map(c => c.trim()) : [];
            const allParts = [...existingParts, ...cookieParts];
            sessionCookies = allParts.join('; ');
        } else {
            sessionCookies = cookieString;
        }

        // Step 4: Follow redirect if present
        if (response.status === 302) {
            const location = response.headers.get('location');
            if (location) {
                const redirectUrl = location.startsWith('http') ? location : 'https://go.qttechnologies.com' + location;
                const redirectResponse = await fetch(redirectUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Cookie': sessionCookies
                    }
                });
                
                const redirectCookies = redirectResponse.headers.get('set-cookie');
                if (redirectCookies) {
                    const additionalCookies = Array.isArray(redirectCookies) ? redirectCookies.join('; ') : redirectCookies;
                    sessionCookies = sessionCookies + '; ' + additionalCookies;
                }
                
                // Step 5: Visit the dispatch list page to establish proper context
                console.log('Step 5: Visiting dispatch list page to establish context...');
                const dispatchListResponse = await fetch('https://go.qttechnologies.com/Portal/Dispatch/ListDispatch?view=tab', {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                        'Cookie': sessionCookies
                    }
                });
                
                const finalCookies = dispatchListResponse.headers.get('set-cookie');
                if (finalCookies) {
                    const moreCookies = Array.isArray(finalCookies) ? finalCookies.join('; ') : finalCookies;
                    sessionCookies = sessionCookies + '; ' + moreCookies;
                }
                
                console.log('Dispatch list page status:', dispatchListResponse.status);
                console.log('Context established for API calls');
            }
        }

        if (response.status === 302 || response.status === 200) {
            isAuthenticated = true;
            console.log('✅ Server authentication successful!');
            console.log('📊 Session cookies cached for all clients');
            return true;
        } else {
            console.log('❌ Server authentication failed with status:', response.status);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Server authentication error:', error.message);
        return false;
    }
}

// Proxy login endpoint
app.post('/api/login', async (req, res) => {
    try {
        console.log('Step 1: Getting login page to extract tokens...');
        
        // First, get the login page to extract any required tokens
        const loginPageResponse = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // Get initial cookies
        const initialCookies = loginPageResponse.headers.get('set-cookie');
        let cookieString = '';
        if (initialCookies) {
            cookieString = Array.isArray(initialCookies) ? initialCookies.join('; ') : initialCookies;
            console.log('Initial cookies from login page:', cookieString.substring(0, 100) + '...');
        }

        const loginPageHtml = await loginPageResponse.text();
        
        // Extract CSRF token if present
        let csrfToken = '';
        const tokenMatch = loginPageHtml.match(/<input[^>]*name="__RequestVerificationToken"[^>]*value="([^"]*)"[^>]*>/i);
        if (tokenMatch) {
            csrfToken = tokenMatch[1];
            console.log('CSRF token found:', csrfToken.substring(0, 20) + '...');
        }

        console.log('Step 2: Attempting login with extracted tokens...');
        
        const formData = new URLSearchParams({
            'Email': process.env.QT_USERNAME,
            'Password': process.env.QT_PASSWORD
        });
        
        if (csrfToken) {
            formData.append('__RequestVerificationToken', csrfToken);
        }
        
        const response = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://go.qttechnologies.com/Portal/Account/Login',
                'Origin': 'https://go.qttechnologies.com',
                'Cookie': cookieString
            },
            body: formData,
            redirect: 'manual' // Don't follow redirects automatically
        });

        // Store all cookies for subsequent requests
        const loginCookies = response.headers.get('set-cookie');
        if (loginCookies) {
            const cookieArray = Array.isArray(loginCookies) ? loginCookies : [loginCookies];
            const cookieParts = [];
            
            // Parse cookies properly (only take the name=value part, ignore path, expires, etc.)
            for (const cookie of cookieArray) {
                const cookieName = cookie.split('=')[0];
                const cookieValue = cookie.split(';')[0]; // Get just name=value part
                cookieParts.push(cookieValue);
            }
            
            // Combine with existing cookies
            const existingParts = cookieString ? cookieString.split(';').map(c => c.trim()) : [];
            const allParts = [...existingParts, ...cookieParts];
            sessionCookies = allParts.join('; ');
            
            console.log('Login cookies updated:', sessionCookies.substring(0, 150) + '...');
        } else {
            sessionCookies = cookieString;
        }

        console.log('Login response status:', response.status);
        console.log('Login response headers:', Object.fromEntries(response.headers.entries()));
        
        // Check what the login response actually contains
        const loginResponseText = await response.text();
        console.log('Login response body length:', loginResponseText.length);
        
        // Check if login failed (look for error indicators)
        const hasError = loginResponseText.includes('validation-summary-errors') || 
                        loginResponseText.includes('login-error') ||
                        loginResponseText.includes('Invalid') ||
                        loginResponseText.includes('incorrect');
        
        console.log('Login response contains error indicators:', hasError);
        if (hasError) {
            // Extract error message if present
            const errorMatch = loginResponseText.match(/<div[^>]*validation-summary-errors[^>]*>(.*?)<\/div>/is);
            if (errorMatch) {
                console.log('Login error message:', errorMatch[1].replace(/<[^>]*>/g, '').trim());
            }
        }
        
        // Check if login was successful (usually a redirect)
        if (response.status === 302 || (response.status === 200 && !hasError)) {
            const location = response.headers.get('location');
            if (location) {
                console.log('Login redirect to:', location);
                
                // Follow the redirect to complete the login process
                console.log('Step 3: Following login redirect...');
                const redirectUrl = location.startsWith('http') ? location : 'https://go.qttechnologies.com' + location;
                console.log('Redirect URL:', redirectUrl);
                const redirectResponse = await fetch(redirectUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Cookie': sessionCookies
                    }
                });
                
                // Get any additional cookies from the redirect
                const redirectCookies = redirectResponse.headers.get('set-cookie');
                if (redirectCookies) {
                    const additionalCookies = Array.isArray(redirectCookies) ? redirectCookies.join('; ') : redirectCookies;
                    sessionCookies = sessionCookies + '; ' + additionalCookies;
                    console.log('Additional cookies from redirect:', additionalCookies);
                }
                
                console.log('Redirect response status:', redirectResponse.status);
                console.log('Final session cookies length:', sessionCookies.length);
            }
            isAuthenticated = true;
            console.log('Authentication completed successfully');
            res.json({ success: true, message: 'Login successful' });
        } else {
            console.error('Login failed with status:', response.status);
            res.status(response.status).json({ success: false, message: `Login failed with status ${response.status}` });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Proxy dispatch data endpoint
app.post('/api/dispatch', async (req, res) => {
    try {
        console.log('Fetching dispatch data...');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('Using cookies:', sessionCookies ? sessionCookies.substring(0, 100) + '...' : 'None');
        
        const response = await fetch('https://go.qttechnologies.com/Portal/Dispatch/GetDispatchDetail', {
            method: 'POST',
            headers: {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'en-US,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/json; charset=UTF-8',
                'Pragma': 'no-cache',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                'Referer': 'https://go.qttechnologies.com/Portal/Dispatch/ListDispatch?view=tab',
                'Origin': 'https://go.qttechnologies.com',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"macOS"',
                'Cookie': sessionCookies || ''
            },
            body: JSON.stringify(req.body)
        });

        console.log('Dispatch API response status:', response.status);
        console.log('Dispatch API response headers:', Object.fromEntries(response.headers.entries()));
        
        if (response.ok) {
            const data = await response.json();
            console.log('Dispatch data received, number of dispatches:', data.Detail?.Dispatches?.length || 0);
            res.json(data);
        } else {
            const errorText = await response.text();
            console.error('API Error Response:', errorText.substring(0, 500) + '...');
            res.status(response.status).json({ 
                Success: false, 
                ErrorMessage: `API request failed with status ${response.status}. Response: ${errorText.substring(0, 200)}` 
            });
        }
    } catch (error) {
        console.error('Dispatch fetch error:', error);
        res.status(500).json({ 
            Success: false, 
            ErrorMessage: error.message 
        });
    }
});

// Debug endpoint to examine login page
app.get('/api/debug-login', async (req, res) => {
    try {
        const response = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });
        
        const html = await response.text();
        
        // Extract all input fields
        const inputFields = [];
        const inputRegex = /<input[^>]*>/gi;
        let match;
        while ((match = inputRegex.exec(html)) !== null) {
            inputFields.push(match[0]);
        }
        
        res.json({
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            bodyLength: html.length,
            hasUsernameField: html.includes('name="Username"') || html.includes('id="Username"'),
            hasPasswordField: html.includes('name="Password"') || html.includes('id="Password"'),
            hasCsrfToken: html.includes('__RequestVerificationToken'),
            formAction: html.match(/action="([^"]*)"/) ? html.match(/action="([^"]*)"/)[1] : 'Not found',
            titleContains: html.match(/<title[^>]*>([^<]*)<\/title>/i) ? html.match(/<title[^>]*>([^<]*)<\/title>/i)[1] : 'No title',
            inputFields: inputFields,
            formHTML: html.match(/<form[^>]*>[\s\S]*?<\/form>/i) ? html.match(/<form[^>]*>[\s\S]*?<\/form>/i)[0] : 'Form not found'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test authenticated access to different endpoints
app.get('/api/test-auth', async (req, res) => {
    try {
        if (!sessionCookies || !isAuthenticated) {
            return res.json({ 
                error: 'No session cookies available. Run login first.',
                isAuthenticated: isAuthenticated,
                hasCookies: !!sessionCookies,
                cookieLength: sessionCookies.length
            });
        }
        
        console.log('Testing authenticated access to different endpoints...');
        
        // Test access to main portal
        const portalResponse = await fetch('https://go.qttechnologies.com/Portal/', {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Cookie': sessionCookies
            }
        });
        
        // Test access to dispatch list page
        const dispatchListResponse = await fetch('https://go.qttechnologies.com/Portal/Dispatch/ListDispatch', {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Cookie': sessionCookies
            }
        });
        
        const portalText = await portalResponse.text();
        const dispatchText = await dispatchListResponse.text();
        
        res.json({
            sessionCookiesLength: sessionCookies.length,
            portalAccess: {
                status: portalResponse.status,
                isHTML: portalResponse.headers.get('content-type')?.includes('text/html'),
                bodyLength: portalText.length,
                isLoginPage: portalText.includes('placeholder=Username'),
                containsError: portalText.includes('Access') && portalText.includes('denied'),
                titleContains: portalText.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || 'No title'
            },
            dispatchListAccess: {
                status: dispatchListResponse.status,
                isHTML: dispatchListResponse.headers.get('content-type')?.includes('text/html'),
                bodyLength: dispatchText.length,
                isLoginPage: dispatchText.includes('placeholder=Username'),
                containsError: dispatchText.includes('Access') && dispatchText.includes('denied'),
                titleContains: dispatchText.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || 'No title'
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test credentials endpoint
app.get('/api/test-credentials', async (req, res) => {
    try {
        console.log('Testing credentials from environment variables...');
        
        // Try a simple login test
        const response = await fetch('https://go.qttechnologies.com/Portal/Account/Login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            body: new URLSearchParams({
                'Email': process.env.QT_USERNAME,
                'Password': process.env.QT_PASSWORD
            }),
            redirect: 'manual'
        });
        
        const responseText = await response.text();
        
        res.json({
            status: response.status,
            redirectLocation: response.headers.get('location'),
            isLoginPage: responseText.includes('placeholder=Username'),
            hasValidationErrors: responseText.includes('validation-summary-errors'),
            bodyLength: responseText.length,
            cookies: response.headers.get('set-cookie'),
            possibleErrors: {
                invalidCredentials: responseText.includes('Invalid') || responseText.includes('incorrect'),
                accountLocked: responseText.includes('locked') || responseText.includes('disabled'),
                accessDenied: responseText.includes('Access') && responseText.includes('denied')
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get credentials for client (with credentials for authentication)
app.get('/api/config', (req, res) => {
    res.json({
        username: process.env.QT_USERNAME,
        password: process.env.QT_PASSWORD,
        companyLocationId: process.env.QT_COMPANY_LOCATION_ID,
        userId: process.env.QT_USER_ID,
        pollInterval: parseInt(process.env.POLL_INTERVAL) || 30000
    });
});

// Check authentication status
app.get('/api/auth-status', (req, res) => {
    res.json({ 
        isAuthenticated: isAuthenticated,
        hasCookies: !!sessionCookies,
        cookieLength: sessionCookies.length,
        cookiePreview: sessionCookies ? sessionCookies.substring(0, 100) + '...' : 'None',
        username: process.env.QT_USERNAME,
        recommendation: isAuthenticated && sessionCookies ? 
            "✅ Authentication successful. If getting 403 errors, this indicates the user account lacks permissions to access the dispatch API. Contact QT Technologies to verify account permissions." :
            "❌ Authentication failed. Check credentials."
    });
});

// Fuel Farm API Endpoints

// Get all tank levels
app.get('/api/fuel-farm/tanks', (req, res) => {
    res.json({
        success: true,
        tanks: fuelTanks,
        timestamp: new Date().toISOString()
    });
});

// Update tank level
app.post('/api/fuel-farm/tanks/:tankId', (req, res) => {
    const { tankId } = req.params;
    const { level } = req.body;
    
    if (!fuelTanks[tankId]) {
        return res.status(404).json({ success: false, error: 'Tank not found' });
    }
    
    if (typeof level !== 'number' || level < 0 || level > fuelTanks[tankId].maxLevel) {
        return res.status(400).json({ 
            success: false, 
            error: `Level must be between 0 and ${fuelTanks[tankId].maxLevel} inches` 
        });
    }
    
    fuelTanks[tankId].level = level;
    fuelTanks[tankId].lastUpdated = new Date().toISOString();
    
    console.log(`Tank ${tankId} level updated to ${level} inches`);
    
    res.json({
        success: true,
        tank: fuelTanks[tankId],
        message: `Tank ${tankId} updated successfully`
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'Server running', port: PORT });
});

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Proxy server starting on port ${PORT}...`);
    
    // Authenticate on startup
    const authSuccess = await authenticateOnStartup();
    
    if (authSuccess) {
        console.log(`\n✅ Server ready and authenticated!`);
        console.log(`📱 Local access:`);
        console.log(`   - Fuel Dispatch: http://localhost:${PORT}/fuel_dispatch_app.html`);
        console.log(`   - Fuel Farm: http://localhost:${PORT}/fuel_farm`);
        
        // Try to show the actual IP address
        const os = require('os');
        const networkInterfaces = os.networkInterfaces();
        console.log('\n📡 Available network addresses:');
        for (const [name, interfaces] of Object.entries(networkInterfaces)) {
            for (const iface of interfaces) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`  - ${name}:`);
                    console.log(`    • Fuel Dispatch: http://${iface.address}:${PORT}/fuel_dispatch_app.html`);
                    console.log(`    • Fuel Farm: http://${iface.address}:${PORT}/fuel_farm`);
                }
            }
        }
        console.log('\n🔄 All devices will use the same cached authentication session');
        console.log('⛽ Fuel Farm: Real-time tank level monitoring and updates');
    } else {
        console.log(`\n❌ Server started but authentication failed`);
        console.log(`   Clients will need to authenticate individually`);
        console.log(`   Fuel Farm still available at: http://localhost:${PORT}/fuel_farm`);
    }
});