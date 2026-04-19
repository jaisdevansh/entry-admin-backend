import { Server }              from 'socket.io';
import jwt                      from 'jsonwebtoken';
import { EventPresence }        from '../models/EventPresence.js';
import { registerChatSocket }   from '../modules/chat/chat.socket.js';

let io;
const users = new Map(); // Map userId → Set of socketIds (legacy radar chat)

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        // Tune for high-throughput chat
        pingTimeout:  60_000,
        pingInterval: 25_000,
        transports:   ['websocket', 'polling'],
    });

    // ── Authentication Middleware ─────────────────────────────────────────────
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            console.log('[Socket] ❌ No token provided');
            return next(new Error('Authentication required'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user   = decoded;
            console.log('[Socket] ✅ Token decoded:', {
                userId: decoded.userId || decoded.id || decoded.sub,
                role:   decoded.role,
            });
            next();
        } catch (err) {
            console.log('[Socket] ❌ Token verification failed:', err.message);
            return next(new Error('Invalid token'));
        }
    });

    // ── Connection Handler ────────────────────────────────────────────────────
    io.on('connection', (socket) => {
        const userId = (
            socket.user.userId ||
            socket.user.id     ||
            socket.user.sub    ||
            socket.user._id
        );

        if (!userId) {
            console.error('[Socket] No user ID found in token payload:', JSON.stringify(socket.user));
            socket.disconnect();
            return;
        }

        console.log(`[Socket] ✅ User connected: ${userId} (${socket.user.role})`);

        // ── Track sockets per user (legacy radar chat map) ────────────────────
        if (!users.has(userId)) users.set(userId, new Set());
        users.get(userId).add(socket.id);

        // Join personal room — used for targeted notifications
        socket.join(userId.toString());

        // Role-based rooms
        const normalizedRole = socket.user.role?.toLowerCase();
        if (['admin', 'superadmin', 'host', 'security'].includes(normalizedRole)) {
            socket.join('admin_room');
        }
        if (normalizedRole === 'security') socket.join('security_room');
        if (['waiter', 'staff'].includes(normalizedRole)) socket.join('waiter_room');

        // ── 🆕 Register new production Chat socket events ─────────────────────
        registerChatSocket(io, socket, users);

        // ── Legacy: Event Presence ────────────────────────────────────────────
        socket.on('joinEvent', async ({ eventId }) => {
            socket.join(`event_${eventId}`);
            socket.eventId = eventId;
        });

        socket.on('join_room', (roomName) => {
            socket.join(roomName);
        });

        socket.on('updatePresence', async (data) => {
            const { eventId, lat, lng, visibility } = data;
            if (!eventId) return;
            try {
                await EventPresence.findOneAndUpdate(
                    { userId, eventId },
                    { userId, eventId, lat, lng, visibility, lastSeen: new Date() },
                    { upsert: true, new: true }
                );
                const count = await EventPresence.countDocuments({
                    eventId,
                    lastSeen: { $gte: new Date(Date.now() - 30 * 60_000) },
                });
                io.to(`event_${eventId}`).emit('presenceUpdate', { eventId, totalPresent: count });
                if (visibility) io.to(`event_${eventId}`).emit('userVisible', { userId });
            } catch (err) {
                console.error('Presence update error:', err);
            }
        });

        socket.on('leaveEvent', async ({ eventId }) => {
            socket.leave(`event_${eventId}`);
            await EventPresence.findOneAndUpdate({ userId, eventId }, { visibility: false });
        });

        // ── Legacy: Radar Chat (kept for backwards-compat) ────────────────────
        socket.on('typing', ({ receiverId, chatId }) => {
            const receiverSockets = users.get(receiverId);
            if (receiverSockets) {
                for (const sid of receiverSockets) {
                    io.to(sid).emit('typing', { senderId: userId, chatId });
                }
            }
        });

        socket.on('send_message', async (data, callback) => {
            const { receiverId, content, tempId } = data;
            if (!receiverId || !content) {
                if (callback) callback({ success: false, error: 'Missing fields' });
                return;
            }
            const timestamp = new Date();
            const receiverSockets = users.get(receiverId);
            if (receiverSockets) {
                for (const sid of receiverSockets) {
                    io.to(sid).emit('receive_message', { tempId, senderId: userId, receiverId, content, timestamp, isRead: false });
                }
            }
            if (callback) callback({ success: true, tempId, timestamp });
            try {
                const { Message } = await import('../models/Message.js');
                await Message.create({ sender: userId, receiver: receiverId, content, isRead: false, createdAt: timestamp, updatedAt: timestamp });
            } catch (err) {
                console.error('[Socket Chat] Failed to save message:', err);
            }
        });

        socket.on('mark_read', async ({ senderId }) => {
            const senderSockets = users.get(senderId);
            if (senderSockets) {
                for (const sid of senderSockets) {
                    io.to(sid).emit('messages_read', { byUserId: userId });
                }
            }
            try {
                const { Message } = await import('../models/Message.js');
                await Message.updateMany({ sender: senderId, receiver: userId, isRead: false }, { $set: { isRead: true } });
            } catch (err) {
                console.error('[Socket Chat] Failed to update read status:', err);
            }
        });

        // ── Disconnect ────────────────────────────────────────────────────────
        socket.on('disconnect', () => {
            const userSockets = users.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) users.delete(userId);
            }
            console.log(`[Socket] User disconnected: ${userId}`);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
};
