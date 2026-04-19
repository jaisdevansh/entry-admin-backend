import express       from 'express';
import rateLimit     from 'express-rate-limit';
import { protect }   from '../middleware/auth.middleware.js';
import {
    createOrGetConversation,
    getConversations,
    getMessages,
    sendMessage,
    markRead,
    searchUsers,
} from '../controllers/chat.controller.js';
import {
    validate,
    createConversationSchema,
    sendMessageSchema,
    getMessagesSchema,
    markReadSchema,
    searchUsersSchema,
} from '../validators/chat.validation.js';

const router = express.Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────
const messageLimiter = rateLimit({
    windowMs: 60_000,       // 1 minute window
    max: 120,               // 120 messages/min per IP — generous for real usage
    message: { success: false, message: 'Too many messages. Slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const generalLimiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    message: { success: false, message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── All routes require authentication ─────────────────────────────────────────
router.use(protect);

// ── Conversation endpoints ────────────────────────────────────────────────────

/** POST /api/chat/conversations — create or get a conversation */
router.post(
    '/conversations',
    generalLimiter,
    validate(createConversationSchema),
    createOrGetConversation
);

/** GET /api/chat/conversations — list all conversations for logged-in user */
router.get('/conversations', generalLimiter, getConversations);

// ── Message endpoints ─────────────────────────────────────────────────────────

/** GET /api/chat/messages/:conversationId — cursor-paginated history */
router.get(
    '/messages/:conversationId',
    generalLimiter,
    validate(getMessagesSchema, 'query'),
    getMessages
);

/** POST /api/chat/messages — send a message */
router.post(
    '/messages',
    messageLimiter,
    validate(sendMessageSchema),
    sendMessage
);

/** POST /api/chat/messages/read — mark conversation as read */
router.post(
    '/messages/read',
    generalLimiter,
    validate(markReadSchema),
    markRead
);

// ── User search ───────────────────────────────────────────────────────────────

/** GET /api/chat/users/search?q= — find users to start a chat with */
router.get(
    '/users/search',
    generalLimiter,
    validate(searchUsersSchema, 'query'),
    searchUsers
);

export default router;
