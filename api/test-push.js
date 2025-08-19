// Vercel serverless function for sending test push notifications
const webpush = require('web-push');
const SubscriptionStore = require('./shared-store');

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Configure web-push with VAPID keys
        // Note: In production, generate and store these keys securely
        if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
            return res.status(500).json({
                error: 'VAPID keys not configured. Please generate VAPID keys and set environment variables.'
            });
        }

        webpush.setVapidDetails(
            'mailto:' + (process.env.VAPID_EMAIL || 'admin@example.com'),
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );

        const { userId, companyId, subscription, latestDispatch } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }

        // Try to get subscription from shared store if not provided
        let targetSubscription = subscription;
        if (!targetSubscription && companyId) {
            const storedSub = SubscriptionStore.get(userId, companyId);
            targetSubscription = storedSub?.subscription;
        }

        if (!targetSubscription) {
            return res.status(400).json({
                error: 'No push subscription found. Please subscribe to notifications first.',
                stats: SubscriptionStore.getStats()
            });
        }

        try {
            // Create notification payload based on latest dispatch or fallback
            // Add timestamp to tag to ensure unique notifications each time
            const timestamp = Date.now();
            let title, body, tag;

            if (latestDispatch) {
                title = `⛽ Fuel Request - ${latestDispatch.FlightNumber}`;
                body = `${latestDispatch.FlightNumber} to ${latestDispatch.Destination} (${latestDispatch.TailNumber}) requested ${latestDispatch.QuantityInWeight} lbs of fuel`;
                tag = `fuel-request-${latestDispatch.FlightNumber}-${timestamp}`;
            } else {
                title = '✈️ Test Notification';
                body = 'No upcoming dispatches available at this time';
                tag = `test-notification-${timestamp}`;
            }

            const payload = JSON.stringify({
                title: title,
                body: body,
                icon: '✈️',
                tag: tag,
                requireInteraction: false,
                data: {
                    type: latestDispatch ? 'fuel_request' : 'test',
                    timestamp: new Date().toISOString(),
                    userId: userId,
                    dispatch: latestDispatch || null
                }
            });

            await webpush.sendNotification(targetSubscription, payload);

            return res.json({
                success: true,
                message: 'Test notification sent successfully!',
                userId: userId,
                timestamp: new Date().toISOString(),
                stats: SubscriptionStore.getStats()
            });

        } catch (error) {
            console.error('Failed to send test notification:', error);

            // Clean up invalid subscriptions
            if ((error.statusCode === 410 || error.statusCode === 404) && companyId) {
                SubscriptionStore.removeInvalid(userId, companyId);
            }

            return res.status(500).json({
                success: false,
                error: 'Failed to send notification: ' + error.message
            });
        }

    } catch (error) {
        console.error('Test push error:', error);
        return res.status(500).json({
            error: 'Failed to send test notification: ' + error.message
        });
    }
};