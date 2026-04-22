import admin from '../config/firebase.config.js'; // ⚡ SHARED INSTANCE
import DeviceToken from '../models/DeviceToken.js';
import Notification from '../models/Notification.js';

// No longer needs local initialization - centralization handled by config/firebase.config.js 🎯
const adminAuth = admin.apps.length > 0;
if (!adminAuth) {
    console.warn('[NotificationService] Core Push Gateway Offline (Firebase missing config). ⚠️');
} else {
    console.log('[NotificationService] Push Gateway Ready via Central Config ✅');
}

export const notificationService = {
    /**
     * Send push notification to a specific user
     */
    async sendToUser(userId, title, body, data = {}) {
        try {
            const tokens = await DeviceToken.find({ userId });
            if (!tokens.length) return;

            const registrationTokens = tokens.map(t => t.fcmToken);
            const message = {
                notification: { title, body },
                data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
                tokens: registrationTokens,
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`[Push] Sent to User ${userId}: ${response.successCount} success`);
            return response;
        } catch (error) {
            console.error('[Push Error] User:', error);
        }
    },

    /**
     * Send push notification to all users of a specific role
     */
    async sendToRole(role, title, body, data = {}) {
        try {
            const tokens = await DeviceToken.find({ role });
            if (!tokens.length) {
                console.log(`[Push] No tokens found for role: ${role}`);
                return;
            }

            const registrationTokens = tokens.map(t => t.fcmToken);
            
            // Batching in groups of 500 (FCM limit)
            const batches = [];
            for (let i = 0; i < registrationTokens.length; i += 500) {
                batches.push(registrationTokens.slice(i, i + 500));
            }

            for (const batch of batches) {
                const message = {
                    notification: { title, body },
                    data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
                    tokens: batch,
                };
                const response = await admin.messaging().sendEachForMulticast(message);
                console.log(`[Push] Batch sent to ${role}: ${response.successCount} success`);
            }
        } catch (error) {
            console.error('[Push Error] Role:', error);
        }
    },

    /**
     * Send bulk notifications to multiple specific users
     */
    async sendBulk(userIds, title, body, data = {}) {
        try {
            const tokens = await DeviceToken.find({ userId: { $in: userIds } });
            if (!tokens.length) return;

            const registrationTokens = tokens.map(t => t.fcmToken);
            const message = {
                notification: { title, body },
                data: data,
                tokens: registrationTokens,
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            return response;
        } catch (error) {
            console.error('[Push Error] Bulk:', error);
        }
    }
};

/**
 * Higher-level utility to send both Push Notification and record it in the Database
 * Supports both:
 * 1. sendNotification(userId, { title, message, type, data })
 * 2. sendNotification(userId, title, message, type, data)
 */
export const sendNotification = async (userId, titleOrOptions, body, type = 'system', data = {}) => {
    try {
        let title, message;
        let finalType = type;
        let finalData = data;

        if (typeof titleOrOptions === 'object' && titleOrOptions !== null) {
            title = titleOrOptions.title;
            message = titleOrOptions.message || titleOrOptions.body;
            finalType = titleOrOptions.type || type;
            finalData = titleOrOptions.data || data;
        } else {
            title = titleOrOptions;
            message = body;
        }

        // 1. Create Database Record (so user can see it in-app)
        const dbNotification = await Notification.create({
            userId,
            title,
            body: message,
            type: finalType.toLowerCase(),
            data: finalData
        });

        // 2. Send Push Notification
        await notificationService.sendToUser(userId, title, message, finalData);

        return dbNotification;
    } catch (error) {
        console.error('[NotificationService] sendNotification failed:', error);
    }
};
