import mongoose from 'mongoose';

const referralRewardSchema = new mongoose.Schema({
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    pointsAmount: { type: Number, default: 50 },
    status: { type: String, enum: ['pending', 'unlocked'], default: 'pending' },
}, { timestamps: true });

referralRewardSchema.index({ referrerId: 1, status: 1 });

export const ReferralReward = mongoose.model('ReferralReward', referralRewardSchema);
