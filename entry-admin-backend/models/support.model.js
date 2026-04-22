import mongoose from 'mongoose';

const supportMessageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    role: { type: String, enum: ['user', 'ai'], required: true },
    metadata: {
        tokens: { type: Number },
        model: { type: String }
    }
}, { timestamps: true });

export const SupportMessage = mongoose.model('SupportMessage', supportMessageSchema);
