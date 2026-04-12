import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' }, // Tie chat to an event initially
    lastMessage: { type: String },
    lastMessageTime: { type: Date }
}, { timestamps: true });

export const Chat = mongoose.model('Chat', chatSchema);
