import mongoose from 'mongoose';

const pointsWalletSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    points: { type: Number, default: 0 }
}, { timestamps: true });

export const PointsWallet = mongoose.model('PointsWallet', pointsWalletSchema);
