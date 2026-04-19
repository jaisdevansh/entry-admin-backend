import * as chatService from '../services/chat.service.js';
import { getIO }        from '../config/socket.js';
import { logger }       from '../logs/logger.js';
import { Conversation } from '../models/Conversation.js';
import { User }         from '../models/user.model.js';
import { sendNotification } from '../services/notification.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ok  = (res, data, status = 200) => res.status(status).json({ success: true, data });
const err = (res, message, status = 500) => res.status(status).json({ success: false, message });

// ─── POST /api/chat/conversations ─────────────────────────────────────────────
/**
 * Create or get a 1-to-1 conversation with `userId` (the other person).
 */
export const createOrGetConversation = async (req, res) => {
    try {
        const myId   = req.user.userId || req.user.id;
        const { userId: otherId } = req.body;

        if (myId.toString() === otherId.toString()) {
            return err(res, 'Cannot create conversation with yourself', 400);
        }

        const conversation = await chatService.findOrCreateConversation(myId, otherId);
        return ok(res, { conversation }, 200);
    } catch (e) {
        logger.error('[Chat] createOrGetConversation:', e.message);
        return err(res, 'Internal server error');
    }
};

// ─── GET /api/chat/conversations ──────────────────────────────────────────────
export const getConversations = async (req, res) => {
    try {
        const userId        = req.user.userId || req.user.id;
        const conversations = await chatService.getConversationsForUser(userId);
        return ok(res, { conversations });
    } catch (e) {
        logger.error('[Chat] getConversations:', e.message);
        return err(res, 'Internal server error');
    }
};

// ─── GET /api/chat/messages/:conversationId ───────────────────────────────────
export const getMessages = async (req, res) => {
    try {
        const userId         = req.user.userId || req.user.id;
        const { conversationId } = req.params;
        const { cursor, limit } = req.query;

        const result = await chatService.getMessages(
            conversationId,
            userId,
            cursor || null,
            Number(limit) || 20
        );

        return ok(res, result);
    } catch (e) {
        logger.error('[Chat] getMessages:', e.message);
        return err(res, 'Internal server error');
    }
};

// ─── POST /api/chat/messages ──────────────────────────────────────────────────
export const sendMessage = async (req, res) => {
    try {
        const senderId = req.user.userId || req.user.id;
        const { conversationId, text, type, mediaUrl } = req.body;

        const message = await chatService.sendMessage({
            conversationId,
            senderId,
            text,
            type,
            mediaUrl,
        });

        if (message === null) {
            return err(res, 'Not authorized to send messages in this conversation', 403);
        }

        // ── Real-time delivery via Socket.io ──────────────────────────────────
        try {
            const io = getIO();
            // Emit to the conversation room so all participants receive it
            io.to(`conv_${conversationId}`).emit('message:new', {
                _id:            message._id,
                conversationId: message.conversationId,
                senderId:       message.senderId,
                text:           message.text,
                type:           message.type,
                mediaUrl:       message.mediaUrl,
                createdAt:      message.createdAt,
                deliveredAt:    null,
                seenAt:         null,
            });
        } catch (socketErr) {
            logger.warn('[Chat] Socket emit failed:', socketErr.message);
        }

        // ── Push Notification ─────────────────────────────────────────────────
        try {
            const conv = await Conversation.findById(conversationId).select('participantIds');
            if (conv) {
                // Find receiver
                const receiverId = conv.participantIds.find(id => id.toString() !== senderId.toString());
                if (receiverId) {
                    const sender = await User.findById(senderId).select('name');
                    const senderName = sender?.name || 'Someone';

                    let notifTitle = `New Message from ${senderName}`;
                    let notifBody = text;

                    if (type === 'gift') {
                        notifTitle = `You received a gift! 🎁`;
                        notifBody = `${senderName} sent you a gift!`;
                    } else if (type === 'invite') {
                        notifTitle = `New Invite 🎟️`;
                        notifBody = `${senderName} invited you!`;
                    } else if (type !== 'text') {
                        notifBody = `[${type.toUpperCase()}] from ${senderName}`;
                    }

                    await sendNotification(receiverId, {
                        title: notifTitle,
                        message: notifBody,
                        type: 'CHAT',
                        data: {
                            conversationId: conversationId.toString(),
                            senderId: senderId.toString()
                        }
                    });
                }
            }
        } catch (pushErr) {
            logger.warn('[Chat] Push notification failed:', pushErr.message);
        }

        return ok(res, { message }, 201);
    } catch (e) {
        if (e.message === 'FORBIDDEN') return err(res, 'Not a participant of this conversation', 403);
        logger.error('[Chat] sendMessage:', e.message);
        return err(res, 'Internal server error');
    }
};

// ─── POST /api/chat/messages/read ────────────────────────────────────────────
export const markRead = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { conversationId, lastMessageId } = req.body;

        await chatService.markConversationRead(conversationId, userId, lastMessageId);

        // Notify the other participants that the user has seen up to this message
        try {
            const io = getIO();
            io.to(`conv_${conversationId}`).emit('message:seen', {
                conversationId,
                seenBy:         userId,
                lastMessageId,
                seenAt:         new Date(),
            });
        } catch (socketErr) {
            logger.warn('[Chat] Socket seen emit failed:', socketErr.message);
        }

        return ok(res, { marked: true });
    } catch (e) {
        logger.error('[Chat] markRead:', e.message);
        return err(res, 'Internal server error');
    }
};

// ─── GET /api/chat/users/search ───────────────────────────────────────────────
export const searchUsers = async (req, res) => {
    try {
        const myId  = req.user.userId || req.user.id;
        const { q } = req.query;
        const users = await chatService.searchUsers(q, myId);
        return ok(res, { users });
    } catch (e) {
        logger.error('[Chat] searchUsers:', e.message);
        return err(res, 'Internal server error');
    }
};
