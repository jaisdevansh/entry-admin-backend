/**
 * chat.socket.js
 * ──────────────
 * Handles ALL real-time chat events on top of the shared Socket.io instance.
 * Registered once from initSocket() in config/socket.js.
 *
 * Rooms strategy:
 *   - conv_{conversationId}  → both participants join, receive messages/typing
 *   - {userId}               → personal room for online/offline broadcasts
 *
 * Events  (Client → Server):
 *   chat:join_conversation   { conversationId }
 *   chat:leave_conversation  { conversationId }
 *   message:send             { conversationId, text, type?, mediaUrl?, tempId? }
 *   typing:start             { conversationId }
 *   typing:stop              { conversationId }
 *
 * Events  (Server → Client):
 *   message:new              { _id, conversationId, senderId, text, type, mediaUrl, createdAt, tempId? }
 *   message:delivered        { messageId, conversationId, deliveredAt }
 *   message:seen             { conversationId, seenBy, lastMessageId, seenAt }
 *   user:typing              { conversationId, userId, isTyping }
 *   user:online              { userId }
 *   user:offline             { userId }
 *   error                    { message }
 */

import { ChatMessage }  from '../../models/ChatMessage.js';
import { Conversation } from '../../models/Conversation.js';
import * as chatService from '../../services/chat.service.js';
import { logger }       from '../../logs/logger.js';
import mongoose         from 'mongoose';

// Typing state – keyed by `${conversationId}:${userId}` → timeout handle
const typingTimers = new Map();
const TYPING_TIMEOUT_MS = 5_000; // auto clear typing after 5 s of silence

export const registerChatSocket = (io, socket, onlineUsers) => {
    // Extract user id from verified JWT payload (set by socket auth middleware)
    const userId = (
        socket.user.userId ||
        socket.user.id     ||
        socket.user.sub    ||
        socket.user._id
    )?.toString();

    if (!userId) return; // shouldn't happen — auth already validated

    // ── Helper: safe emit with error boundary ─────────────────────────────────
    const safeEmit = (target, event, payload) => {
        try { target.emit(event, payload); }
        catch (e) { logger.warn(`[ChatSocket] safeEmit "${event}" failed: ${e.message}`); }
    };

    // ── Online Presence ───────────────────────────────────────────────────────
    chatService.setUserOnline(userId).catch(() => {});

    // Broadcast online status to everyone who shares a conversation room
    // (We broadcast to their personal room; frontend subscribes per conversation)
    socket.broadcast.emit('user:online', { userId });

    // ─────────────────────────────────────────────────────────────────────────
    // JOIN CONVERSATION ROOM
    // Client must join a room before receiving messages for that conversation.
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('chat:join_conversation', async ({ conversationId }) => {
        try {
            if (!mongoose.Types.ObjectId.isValid(conversationId)) {
                return safeEmit(socket, 'error', { message: 'Invalid conversationId' });
            }

            // Verify the user is actually a participant
            const conv = await Conversation.findOne({
                _id: conversationId,
                participantIds: new mongoose.Types.ObjectId(userId),
            }).lean();

            if (!conv) {
                return safeEmit(socket, 'error', { message: 'Not authorized for this conversation' });
            }

            const room = `conv_${conversationId}`;
            socket.join(room);
            logger.info(`[ChatSocket] User ${userId} joined room ${room}`);

            // Mark messages as delivered for this user now that they are "seen"
            await _markDelivered(conversationId, userId, io);
        } catch (e) {
            logger.error('[ChatSocket] join_conversation error:', e.message);
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // LEAVE CONVERSATION ROOM
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('chat:leave_conversation', ({ conversationId }) => {
        socket.leave(`conv_${conversationId}`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SEND MESSAGE  (real-time path — also persists to DB)
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('message:send', async (data, callback) => {
        try {
            const { conversationId, text, type = 'text', mediaUrl = null, tempId } = data || {};

            // ── Validate input ────────────────────────────────────────────────
            if (!conversationId || (!text && type === 'text')) {
                const e = { message: 'conversationId and text are required' };
                if (typeof callback === 'function') callback({ success: false, ...e });
                return safeEmit(socket, 'error', e);
            }
            if (!mongoose.Types.ObjectId.isValid(conversationId)) {
                const e = { message: 'Invalid conversationId' };
                if (typeof callback === 'function') callback({ success: false, ...e });
                return safeEmit(socket, 'error', e);
            }

            // ── Persist ───────────────────────────────────────────────────────
            const message = await chatService.sendMessage({
                conversationId,
                senderId: userId,
                text:     text?.trim() || '',
                type,
                mediaUrl,
            });

            if (!message) {
                const e = { message: 'Not authorized or conversation not found' };
                if (typeof callback === 'function') callback({ success: false, ...e });
                return;
            }

            const payload = {
                _id:            message._id,
                conversationId: message.conversationId,
                senderId:       message.senderId,
                text:           message.text,
                type:           message.type,
                mediaUrl:       message.mediaUrl,
                createdAt:      message.createdAt,
                tempId:         tempId || null,
            };

            // ── Broadcast to conversation room (both participants) ─────────────
            io.to(`conv_${conversationId}`).emit('message:new', payload);

            // ── ACK to sender ─────────────────────────────────────────────────
            if (typeof callback === 'function') {
                callback({ success: true, message: payload });
            }

            // ── Mark delivered if receiver is online in this room ─────────────
            await _markDelivered(conversationId, userId, io);

        } catch (e) {
            logger.error('[ChatSocket] message:send error:', e.message);
            if (typeof callback === 'function') {
                callback({ success: false, message: 'Failed to send message' });
            }
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TYPING INDICATORS
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('typing:start', ({ conversationId }) => {
        if (!conversationId) return;
        const key = `${conversationId}:${userId}`;

        // Clear any existing auto-stop timer
        if (typingTimers.has(key)) {
            clearTimeout(typingTimers.get(key));
        }

        // Broadcast to everyone else in the room
        socket.to(`conv_${conversationId}`).emit('user:typing', {
            conversationId,
            userId,
            isTyping: true,
        });

        // Auto-stop after timeout in case client forgets to send typing:stop
        const timer = setTimeout(() => {
            socket.to(`conv_${conversationId}`).emit('user:typing', {
                conversationId,
                userId,
                isTyping: false,
            });
            typingTimers.delete(key);
        }, TYPING_TIMEOUT_MS);

        typingTimers.set(key, timer);
    });

    socket.on('typing:stop', ({ conversationId }) => {
        if (!conversationId) return;
        const key = `${conversationId}:${userId}`;

        if (typingTimers.has(key)) {
            clearTimeout(typingTimers.get(key));
            typingTimers.delete(key);
        }

        socket.to(`conv_${conversationId}`).emit('user:typing', {
            conversationId,
            userId,
            isTyping: false,
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('disconnecting', () => {
        // Clean up all typing timers for this socket
        for (const [key, timer] of typingTimers.entries()) {
            if (key.endsWith(`:${userId}`)) {
                clearTimeout(timer);
                typingTimers.delete(key);
            }
        }
    });

    socket.on('disconnect', async () => {
        // Only mark offline if no other socket for this user is connected
        const userRoom = io.sockets.adapter.rooms.get(userId.toString());
        if (!userRoom || userRoom.size === 0) {
            await chatService.setUserOffline(userId).catch(() => {});
            socket.broadcast.emit('user:offline', { userId });
        }
    });
};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Mark undelivered messages in a conversation as delivered
 * (for messages received by the other participant after they joined the room).
 */
async function _markDelivered(conversationId, receiverUserId, io) {
    try {
        const convOid     = new mongoose.Types.ObjectId(conversationId);
        const receiverOid = new mongoose.Types.ObjectId(receiverUserId);

        const updated = await ChatMessage.updateMany(
            {
                conversationId: convOid,
                senderId:       { $ne: receiverOid },
                deliveredAt:    null,
            },
            { $set: { deliveredAt: new Date() } }
        );

        if (updated.modifiedCount > 0) {
            // Notify conversation room about delivery
            io.to(`conv_${conversationId}`).emit('message:delivered', {
                conversationId,
                deliveredTo:  receiverUserId,
                deliveredAt:  new Date(),
            });
        }
    } catch (e) {
        logger.warn('[ChatSocket] _markDelivered error:', e.message);
    }
}
