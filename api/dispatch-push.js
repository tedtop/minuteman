// Vercel serverless function for sending dispatch-specific push notifications
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

        const { userId, companyId, notification } = req.body;

        if (!userId || !notification) {
            return res.status(400).json({ error: 'User ID and notification data required' });
        }

        // Get subscriptions for this user or company
        const subscriptions = companyId 
            ? SubscriptionStore.getAllForCompany(companyId)
            : SubscriptionStore.getAllForUser(userId);

        if (subscriptions.length === 0) {
            return res.status(404).json({ 
                error: 'No subscriptions found',
                userId: userId,
                companyId: companyId,
                stats: SubscriptionStore.getStats()
            });
        }

        let sentCount = 0;
        let errors = [];

        for (const subscriptionData of subscriptions) {
            try {
                const payload = JSON.stringify(notification);

                await webpush.sendNotification(
                    subscriptionData.subscription,
                    payload
                );
                
                sentCount++;
                console.log(`Dispatch notification sent to user ${subscriptionData.userId}`);
            } catch (error) {
                console.error(`Failed to send dispatch notification to user ${subscriptionData.userId}:`, error);
                errors.push(`${subscriptionData.userId}: ${error.message}`);
                
                // Remove invalid subscriptions
                if (error.statusCode === 410 || error.statusCode === 404) {
                    SubscriptionStore.removeInvalid(subscriptionData.userId, subscriptionData.companyId);
                    console.log(`Removed invalid subscription for user ${subscriptionData.userId}`);
                }
            }
        }

        return res.json({
            success: true,
            message: `Dispatch notification sent to ${sentCount} devices`,
            sentCount,
            totalSubscriptions: subscriptions.length,
            notificationType: notification.data?.type || 'dispatch_update',
            errors: errors.length > 0 ? errors : undefined,
            stats: SubscriptionStore.getStats()
        });

    } catch (error) {
        console.error('Dispatch push error:', error);
        return res.status(500).json({
            error: 'Failed to send dispatch notification: ' + error.message
        });
    }
};