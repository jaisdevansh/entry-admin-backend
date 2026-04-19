import admin from '../config/firebase.config.js'; // ⚡ SHARED INSTANCE
import DeviceToken from '../models/DeviceToken.js';
import Notification from '../models/Notification.js';

// ─── Startup check ────────────────────────────────────────────────────────────
if (!admin.apps.length) {
    console.warn('[NotificationService] Push Gateway OFFLINE — Firebase not initialized. ⚠️');
} else {
    console.log('[NotificationService] Push Gateway Ready ✅');
}

// ─── Helper: FCM requires ALL data values to be strings ──────────────────────
const stringifyData = (data = {}) => {
    const result = {};
    for (const [key, val] of Object.entries(data)) {
        result[key] = typeof val === 'string' ? val : JSON.stringify(val);
    }
    return result;
};

/**
 * After sending FCM messages, auto-delete any stale/unregistered tokens from DB.
 * This keeps the DeviceToken collection clean and prevents wasted FCM sends.
 */
const cleanupStaleTokens = async (responses, tokens) => {
    const staleTokens = [];
    responses.forEach((res, idx) => {
        if (!res.success) {
            const code = res.error?.code;
            if (
                code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token' ||
                code === 'messaging/invalid-argument'
            ) {
                staleTokens.push(tokens[idx]);
            }
        }
    });

    if (staleTokens.length > 0) {
        await DeviceToken.deleteMany({ fcmToken: { $in: staleTokens } });
        console.log(`[Push] Cleaned up ${staleTokens.length} stale token(s) 🗑️`);
    }
};

export const notificationService = {

    /**
     * Send push notification to a specific user by userId.
     * Auto-cleans stale tokens from the DB after delivery.
     */
    async sendToUser(userId, title, body, data = {}) {
        try {
            if (!admin.apps.length) return;

            const tokenDocs = await DeviceToken.find({ userId });
            if (!tokenDocs.length) {
                console.log(`[Push] No tokens for user ${userId}`);
                return;
            }

            const fcmTokens = tokenDocs.map(t => t.fcmToken);
            const message = {
                notification: { title, body },
                data: stringifyData({ ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' }),
                android: {
                    priority: 'high',
                    notification: {
                        channelId: data.type === 'order' ? 'orders'
                            : data.type === 'booking' ? 'booking'
                            : data.type === 'location_reveal' ? 'location'
                            : data.type === 'security_alert' ? 'security'
                            : 'default',
                        sound: 'default',
                    },
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: 1,
                            'content-available': 1,
                        },
                    },
                },
                tokens: fcmTokens,
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`[Push] User ${userId}: ${response.successCount}/${fcmTokens.length} delivered`);

            // Auto-cleanup stale tokens
            await cleanupStaleTokens(response.responses, fcmTokens);

            return response;
        } catch (error) {
            console.error('[Push Error] sendToUser:', error?.message || error);
        }
    },

    /**
     * Send push notification to all devices of a specific role.
     * Batches in groups of 500 (FCM multicast limit).
     */
    async sendToRole(role, title, body, data = {}) {
        try {
            if (!admin.apps.length) return;

            const tokenDocs = await DeviceToken.find({ role });
            if (!tokenDocs.length) {
                console.log(`[Push] No tokens for role: ${role}`);
                return;
            }

            const fcmTokens = tokenDocs.map(t => t.fcmToken);

            // Batch in groups of 500 (FCM limit)
            for (let i = 0; i < fcmTokens.length; i += 500) {
                const batch = fcmTokens.slice(i, i + 500);
                const message = {
                    notification: { title, body },
                    data: stringifyData({ ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' }),
                    android: {
                        priority: 'high',
                        notification: { channelId: 'default', sound: 'default' },
                    },
                    apns: {
                        payload: { aps: { sound: 'default', badge: 1, 'content-available': 1 } },
                    },
                    tokens: batch,
                };

                const response = await admin.messaging().sendEachForMulticast(message);
                console.log(`[Push] Role ${role} batch ${i / 500 + 1}: ${response.successCount}/${batch.length} delivered`);
                await cleanupStaleTokens(response.responses, batch);
            }
        } catch (error) {
            console.error('[Push Error] sendToRole:', error?.message || error);
        }
    },

    /**
     * Send push notifications to multiple specific users (by userId array).
     */
    async sendBulk(userIds, title, body, data = {}) {
        try {
            if (!admin.apps.length) return;

            const tokenDocs = await DeviceToken.find({ userId: { $in: userIds } });
            if (!tokenDocs.length) return;

            const fcmTokens = tokenDocs.map(t => t.fcmToken);
            const message = {
                notification: { title, body },
                data: stringifyData(data),
                android: {
                    priority: 'high',
                    notification: { channelId: 'default', sound: 'default' },
                },
                apns: {
                    payload: { aps: { sound: 'default', badge: 1, 'content-available': 1 } },
                },
                tokens: fcmTokens,
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`[Push] Bulk: ${response.successCount}/${fcmTokens.length} delivered`);
            await cleanupStaleTokens(response.responses, fcmTokens);
            return response;
        } catch (error) {
            console.error('[Push Error] sendBulk:', error?.message || error);
        }
    },
};

/**
 * Higher-level utility: saves notification to DB AND sends push.
 *
 * Supports two call styles:
 *   sendNotification(userId, { title, message, type, data })
 *   sendNotification(userId, title, message, type, data)
 */
export const sendNotification = async (userId, titleOrOptions, body, type = 'system', data = {}) => {
    try {
        let title, message, finalType, finalData;

        if (typeof titleOrOptions === 'object' && titleOrOptions !== null) {
            title = titleOrOptions.title;
            message = titleOrOptions.message || titleOrOptions.body;
            finalType = titleOrOptions.type || type;
            finalData = titleOrOptions.data || data;
        } else {
            title = titleOrOptions;
            message = body;
            finalType = type;
            finalData = data;
        }

        // 1. Persist to DB (in-app notification bell)
        const dbNotification = await Notification.create({
            userId,
            title,
            body: message,
            type: finalType.toLowerCase(),
            data: finalData,
        });

        // 2. Push delivery (non-blocking — don't throw if push fails)
        notificationService.sendToUser(userId, title, message, { ...finalData, type: finalType }).catch(err => {
            console.error('[Push] Delivery failed (non-fatal):', err?.message);
        });

        return dbNotification;
    } catch (error) {
        console.error('[NotificationService] sendNotification failed:', error?.message || error);
    }
};
