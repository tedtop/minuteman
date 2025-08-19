// Vercel serverless function for push notification subscription
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
        const { subscription, userId, companyId } = req.body;

        if (!subscription) {
            return res.status(400).json({ error: 'Subscription data required' });
        }

        if (!userId || !companyId) {
            return res.status(400).json({ error: 'User ID and Company ID required' });
        }

        // Store subscription using shared store
        const subscriptionKey = SubscriptionStore.add(userId, companyId, subscription);

        console.log(`Push subscription stored for user ${userId}`);
        
        return res.json({ 
            success: true, 
            message: 'Subscription stored successfully',
            subscriptionId: subscriptionKey,
            stats: SubscriptionStore.getStats()
        });

    } catch (error) {
        console.error('Subscribe push error:', error);
        return res.status(500).json({
            error: 'Failed to store subscription: ' + error.message
        });
    }
};