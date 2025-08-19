// Shared subscription store using Vercel Fluid Compute global state
// This Map persists across function invocations within the same process

// Global subscription storage - persists with Fluid Compute
global.pushSubscriptions = global.pushSubscriptions || new Map();

class SubscriptionStore {
    static add(userId, companyId, subscription) {
        const key = `${companyId}-${userId}`;
        const subscriptionData = {
            subscription,
            userId,
            companyId,
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString()
        };
        
        global.pushSubscriptions.set(key, subscriptionData);
        console.log(`Stored subscription for ${key}. Total subscriptions: ${global.pushSubscriptions.size}`);
        return key;
    }

    static get(userId, companyId) {
        const key = `${companyId}-${userId}`;
        const subscription = global.pushSubscriptions.get(key);
        
        if (subscription) {
            // Update last used timestamp
            subscription.lastUsed = new Date().toISOString();
            global.pushSubscriptions.set(key, subscription);
        }
        
        return subscription;
    }

    static getAll() {
        return Array.from(global.pushSubscriptions.values());
    }

    static getAllForUser(userId) {
        return Array.from(global.pushSubscriptions.values())
            .filter(sub => sub.userId === userId);
    }

    static getAllForCompany(companyId) {
        return Array.from(global.pushSubscriptions.values())
            .filter(sub => sub.companyId === companyId);
    }

    static remove(userId, companyId) {
        const key = `${companyId}-${userId}`;
        const removed = global.pushSubscriptions.delete(key);
        console.log(`Removed subscription for ${key}. Remaining: ${global.pushSubscriptions.size}`);
        return removed;
    }

    static removeInvalid(userId, companyId) {
        // Called when a push fails with 410/404 to clean up dead subscriptions
        return this.remove(userId, companyId);
    }

    static getStats() {
        const subscriptions = Array.from(global.pushSubscriptions.values());
        const now = new Date();
        
        return {
            total: subscriptions.length,
            byCompany: subscriptions.reduce((acc, sub) => {
                acc[sub.companyId] = (acc[sub.companyId] || 0) + 1;
                return acc;
            }, {}),
            recentlyUsed: subscriptions.filter(sub => {
                const lastUsed = new Date(sub.lastUsed);
                return (now - lastUsed) < 24 * 60 * 60 * 1000; // Last 24 hours
            }).length
        };
    }
}

module.exports = SubscriptionStore;