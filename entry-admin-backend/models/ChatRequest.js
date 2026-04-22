import mongoose from 'mongoose';

const chatRequestSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' }, // context of where they met
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    message: { type: String } // optional intro message like "Hi" or "Ping"
}, { timestamps: true });

export const ChatRequest = mongoose.model('ChatRequest', chatRequestSchema);
