import mongoose from 'mongoose';

/**
 * Conversation — shared between exactly 2 participants.
 * participantIds is ALWAYS stored sorted so (A,B) == (B,A).
 */
const conversationSchema = new mongoose.Schema(
    {
        // Sorted pair: [minId, maxId] — guarantees uniqueness via compound unique index
        participantIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
            validate: {
                validator: (v) => v.length === 2,
                message: 'A conversation must have exactly 2 participants.',
            },
        },

        // Denormalized last message for fast conversation list rendering
        lastMessage: { type: String, default: '' },
        lastMessageAt: { type: Date, default: null },
        lastMessageSenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

        // Per-participant metadata embedded for O(1) unread count
        participants: [
            {
                userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
                // ID of the last message this participant has "seen"
                lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
                _id: false,
            },
        ],
    },
    { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Primary lookup: find convo by both participants (sorted) → guaranteed unique
conversationSchema.index({ participantIds: 1 }, { unique: true });
// Sort conversation list by latest activity
conversationSchema.index({ lastMessageAt: -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
