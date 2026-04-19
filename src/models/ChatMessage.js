import mongoose from 'mongoose';

/**
 * ChatMessage — individual message in a conversation.
 * Supports: text | image | video
 * Delivery pipeline: sent → delivered → seen
 */
const chatMessageSchema = new mongoose.Schema(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
        },
        senderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        text: { type: String, default: '' },
        type: {
            type: String,
            enum: ['text', 'image', 'video'],
            default: 'text',
        },
        // For media messages — stores CDN URL only (S3/Cloudinary)
        mediaUrl: { type: String, default: null },

        // Delivery pipeline timestamps
        deliveredAt: { type: Date, default: null },
        seenAt: { type: Date, default: null },
    },
    { timestamps: true } // createdAt = sent timestamp
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Core query: fetch messages in a conversation ordered by time (cursor pagination)
chatMessageSchema.index({ conversationId: 1, createdAt: -1 });
// Sender view: all messages by a user in a conversation
chatMessageSchema.index({ senderId: 1, conversationId: 1 });

export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
