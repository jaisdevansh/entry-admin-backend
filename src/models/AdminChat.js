import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    sender: { type: String, enum: ['host', 'admin'], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: { type: String, required: true },
    read: { type: Boolean, default: false },
}, { timestamps: true });

const adminChatSchema = new mongoose.Schema({
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    hostName: { type: String },
    messages: [messageSchema],
    lastMessage: { type: String },
    lastMessageAt: { type: Date },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
}, { timestamps: true });

adminChatSchema.index({ lastMessageAt: -1 });

export const AdminChat = mongoose.model('AdminChat', adminChatSchema);
