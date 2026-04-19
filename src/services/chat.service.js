import { Conversation }  from '../models/Conversation.js';
import { ChatMessage }   from '../models/ChatMessage.js';
import { User }          from '../models/user.model.js';
import { cacheService }  from '../services/cache.service.js';
import mongoose          from 'mongoose';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns sorted [id1, id2] for stable unique-pair look-ups */
const sortedPair = (a, b) => {
    const pa = a.toString();
    const pb = b.toString();
    return pa < pb ? [a, b] : [b, a];
};

// Cache TTLs
const TTL_CONV_LIST  = 60;  // 60 s – conversation list
const TTL_ONLINE     = 120; // 120 s – online flag

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Find an existing 1-to-1 conversation or create a new one.
 * Prevents duplicates via sorted participantIds + unique index.
 */
export const findOrCreateConversation = async (myId, otherId) => {
    const ids = sortedPair(
        new mongoose.Types.ObjectId(myId),
        new mongoose.Types.ObjectId(otherId)
    );

    // Try to find existing
    let convo = await Conversation.findOne({ participantIds: { $all: ids, $size: 2 } }).lean();

    if (!convo) {
        // Race-safe upsert — unique index prevents double-creation
        convo = await Conversation.findOneAndUpdate(
            { participantIds: ids },
            {
                $setOnInsert: {
                    participantIds: ids,
                    participants: [
                        { userId: ids[0], lastReadMessageId: null },
                        { userId: ids[1], lastReadMessageId: null },
                    ],
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();
    }

    return convo;
};

/**
 * GET /api/conversations
 * Returns paginated conversation list with last-message + unread count,
 * sorted by lastMessageAt DESC.
 */
export const getConversationsForUser = async (userId) => {
    const cacheKey = `conv_list:${userId}`;
    const cached   = await cacheService.get(cacheKey);
    if (cached) return cached;

    const oid = new mongoose.Types.ObjectId(userId);

    // One aggregation — no N+1
    const conversations = await Conversation.aggregate([
        // 1. My conversations
        { $match: { participantIds: oid } },

        // 2. Sort by activity
        { $sort: { lastMessageAt: -1 } },

        // 3. Limit to 50 recent convos
        { $limit: 50 },

        // 4. Find the other participant's ID
        {
            $addFields: {
                otherUserId: {
                    $arrayElemAt: [
                        {
                            $filter: {
                                input: '$participantIds',
                                as: 'pid',
                                cond: { $ne: ['$$pid', oid] },
                            },
                        },
                        0,
                    ],
                },
                myParticipant: {
                    $arrayElemAt: [
                        {
                            $filter: {
                                input: '$participants',
                                as: 'p',
                                cond: { $eq: ['$$p.userId', oid] },
                            },
                        },
                        0,
                    ],
                },
            },
        },

        // 5. Lookup other user's profile
        {
            $lookup: {
                from: 'users',
                localField: 'otherUserId',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1, profileImage: 1, username: 1 } }],
                as: 'otherUser',
            },
        },
        { $unwind: { path: '$otherUser', preserveNullAndEmpty: false } },

        // 6. Count unread messages — only DB-read when lastReadMessageId set
        {
            $lookup: {
                from: 'chatmessages',
                let: {
                    convId: '$_id',
                    lastRead: '$myParticipant.lastReadMessageId',
                },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$conversationId', '$$convId'] },
                                    { $ne: ['$senderId', oid] },
                                    {
                                        $or: [
                                            { $eq: ['$$lastRead', null] },
                                            { $gt: ['$_id', '$$lastRead'] },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                    { $count: 'n' },
                ],
                as: 'unreadArr',
            },
        },

        // 7. Project final shape
        {
            $project: {
                _id: 1,
                otherUser: 1,
                lastMessage: 1,
                lastMessageAt: 1,
                lastMessageSenderId: 1,
                updatedAt: 1,
                unreadCount: {
                    $ifNull: [{ $arrayElemAt: ['$unreadArr.n', 0] }, 0],
                },
            },
        },
    ]);

    await cacheService.set(cacheKey, conversations, TTL_CONV_LIST);
    return conversations;
};

/**
 * GET /api/messages/:conversationId
 * Cursor-based pagination — returns messages oldest → newest within the page.
 * `cursor` = the _id of the oldest message already loaded (go further back).
 */
export const getMessages = async (conversationId, userId, cursor = null, limit = 20) => {
    const query = { conversationId: new mongoose.Types.ObjectId(conversationId) };

    if (cursor) {
        query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const messages = await ChatMessage.find(query)
        .sort({ _id: -1 })           // newest first for efficient cursor
        .limit(limit + 1)            // fetch one extra to detect hasMore
        .lean();

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    // Return in chronological order
    messages.reverse();

    const nextCursor = hasMore ? messages[0]._id : null;

    return { messages, nextCursor, hasMore };
};

/**
 * POST /api/messages
 * Saves a message, updates conversation denormalized fields, invalidates cache.
 */
export const sendMessage = async ({ conversationId, senderId, text, type = 'text', mediaUrl = null }) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const convOid = new mongoose.Types.ObjectId(conversationId);
        const senderOid = new mongoose.Types.ObjectId(senderId);

        // Verify sender is a participant
        const conv = await Conversation.findOne({
            _id: convOid,
            participantIds: senderOid,
        }).session(session);

        if (!conv) throw new Error('FORBIDDEN');

        // Create message
        const [msg] = await ChatMessage.create(
            [{ conversationId: convOid, senderId: senderOid, text, type, mediaUrl }],
            { session }
        );

        // Update conversation's denormalized last-message fields
        await Conversation.findByIdAndUpdate(
            convOid,
            {
                lastMessage: type === 'text' ? text : `[${type}]`,
                lastMessageAt: msg.createdAt,
                lastMessageSenderId: senderOid,
            },
            { session }
        );

        await session.commitTransaction();

        // Invalidate conversation-list cache for both participants
        const participantStrs = conv.participantIds.map((id) => id.toString());
        await Promise.all(
            participantStrs.map((uid) => cacheService.del(`conv_list:${uid}`))
        );

        return msg;
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

/**
 * POST /api/messages/read
 * Updates lastReadMessageId for the user in a conversation.
 * Emits seen event via socket (handled in controller).
 */
export const markConversationRead = async (conversationId, userId, lastMessageId) => {
    const convOid    = new mongoose.Types.ObjectId(conversationId);
    const userOid    = new mongoose.Types.ObjectId(userId);
    const msgOid     = new mongoose.Types.ObjectId(lastMessageId);

    await Conversation.findOneAndUpdate(
        { _id: convOid, 'participants.userId': userOid },
        { $set: { 'participants.$.lastReadMessageId': msgOid } }
    );

    // Mark messages as seen in DB (for persistence)
    await ChatMessage.updateMany(
        {
            conversationId: convOid,
            senderId: { $ne: userOid },
            seenAt: null,
            _id: { $lte: msgOid },
        },
        { $set: { seenAt: new Date() } }
    );

    // Invalidate cache
    await cacheService.del(`conv_list:${userId}`);
};

/**
 * Set online presence in cache.
 */
export const setUserOnline = async (userId) => {
    await cacheService.set(`online:${userId}`, '1', TTL_ONLINE);
};

export const setUserOffline = async (userId) => {
    await cacheService.del(`online:${userId}`);
};

export const isUserOnline = async (userId) => {
    const val = await cacheService.get(`online:${userId}`);
    return val === '1';
};

/**
 * Search users by name/username/phone for starting a new conversation.
 */
export const searchUsers = async (query, excludeUserId) => {
    if (!query || query.length < 2) return [];
    return User.find({
        _id: { $ne: excludeUserId },
        isActive: true,
        $or: [
            { name: { $regex: query, $options: 'i' } },
            { username: { $regex: query, $options: 'i' } },
            { phone: { $regex: query, $options: 'i' } },
        ],
    })
        .select('name username profileImage')
        .limit(20)
        .lean();
};
