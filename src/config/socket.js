import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { EventPresence } from '../models/EventPresence.js';

let io;
const users = new Map(); // Map userId to set of socketIds

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    // Authentication middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication required'));
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;
            next();
        } catch (err) {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.user.id;
        
        if (!users.has(userId)) users.set(userId, new Set());
        users.get(userId).add(socket.id);
        
        // Native socket.io targeting
        socket.join(userId.toString());

        // Admins and Security join shared admin room for host chat and emergency notifications
        const normalizedRole = socket.user.role?.toLowerCase();
        
        // Admins and Security join shared admin room
        if (['admin', 'superadmin', 'host', 'security'].includes(normalizedRole)) {
            socket.join('admin_room');
        }
        if (normalizedRole === 'security') {
            socket.join('security_room');
        }
        if (['waiter', 'staff'].includes(normalizedRole)) {
            socket.join('waiter_room');
        }

        // Silently connected
        // Join Event Room for presence
        socket.on('joinEvent', async ({ eventId }) => {
            socket.join(`event_${eventId}`);
            socket.eventId = eventId;
        });

        // Allow clients to explicitly join named rooms (e.g. security_room)
        socket.on('join_room', (roomName) => {
            socket.join(roomName);
        });

        // Update presence / visibility
        socket.on('updatePresence', async (data) => {
            const { eventId, lat, lng, visibility } = data;
            if(!eventId) return;

            try {
                await EventPresence.findOneAndUpdate(
                    { userId, eventId },
                    { userId, eventId, lat, lng, visibility, lastSeen: new Date() },
                    { upsert: true, new: true }
                );
                
                // Broadcast updated stats to anyone listening in room
                const count = await EventPresence.countDocuments({ eventId, lastSeen: { $gte: new Date(Date.now() - 30 * 60000) } }); 
                io.to(`event_${eventId}`).emit('presenceUpdate', { eventId, totalPresent: count });

                if (visibility) {
                    io.to(`event_${eventId}`).emit('userVisible', { userId });
                }
            } catch (err) {
                console.error("Presence update error:", err);
            }
        });

        // Leave Event Room
        socket.on('leaveEvent', async ({ eventId }) => {
            socket.leave(`event_${eventId}`);
            await EventPresence.findOneAndUpdate({ userId, eventId }, { visibility: false });
        });
        
        // Typing
        socket.on('typing', ({ receiverId, chatId }) => {
            const receiverSockets = users.get(receiverId);
            if(receiverSockets) {
                for (const sid of receiverSockets) {
                    io.to(sid).emit('typing', { senderId: userId, chatId });
                }
            }
        });

        // ─── Radar Chat / Direct Messaging ──────────────────────────────
        
        // Handle sending messages instantly and persist to DB in background
        socket.on('send_message', async (data, callback) => {
            const { receiverId, content, tempId } = data;
            if (!receiverId || !content) {
                if(callback) callback({ success: false, error: 'Missing fields' });
                return;
            }

            const timestamp = new Date();

            // Emit to receiver immediately if online for sub-10ms delivery
            const receiverSockets = users.get(receiverId);
            if (receiverSockets) {
                for (const sid of receiverSockets) {
                    io.to(sid).emit('receive_message', {
                        tempId, // Send back tempId so receiver can acknowledge if needed, or largely used by sender
                        senderId: userId,
                        receiverId,
                        content,
                        timestamp,
                        isRead: false
                    });
                }
            }

            // Acknowledge back to sender immediately so UI updates optimizing latency
            if (callback) {
                callback({ success: true, tempId, timestamp });
            }

            // Persist to MongoDB asynchronously in background
            try {
                // Dynamically import Message to avoid circular dependencies if any
                const { Message } = await import('../models/Message.js');
                await Message.create({
                    sender: userId,
                    receiver: receiverId,
                    content,
                    isRead: false,
                    // use same timestamp to keep consistency
                    createdAt: timestamp,
                    updatedAt: timestamp
                });
            } catch (err) {
                console.error('[Socket Chat] Failed to save message:', err);
            }
        });

        // Handle marking messages as read
        socket.on('mark_read', async ({ senderId }) => {
            const senderSockets = users.get(senderId);
            if (senderSockets) {
                for (const sid of senderSockets) {
                    io.to(sid).emit('messages_read', { byUserId: userId });
                }
            }
            // Persist read status in background
            try {
                const { Message } = await import('../models/Message.js');
                await Message.updateMany(
                    { sender: senderId, receiver: userId, isRead: false },
                    { $set: { isRead: true } }
                );
            } catch (err) {
                console.error('[Socket Chat] Failed to update read status:', err);
            }
        });

        socket.on('disconnect', () => {
            const userSockets = users.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    users.delete(userId);
                }
            }
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};
