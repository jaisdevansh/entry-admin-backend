import mongoose from 'mongoose';

const payoutSchema = new mongoose.Schema({
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['Success', 'Pending', 'Failed'], default: 'Pending' },
    date: { type: Date, default: Date.now }
}, { timestamps: true });

export const Payout = mongoose.model('Payout', payoutSchema);
