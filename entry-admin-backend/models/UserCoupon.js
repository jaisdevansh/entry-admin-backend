import mongoose from 'mongoose';

const userCouponSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true },
    isUsed: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

userCouponSchema.index({ userId: 1, isUsed: 1 });
userCouponSchema.index({ userId: 1, couponId: 1 });

export const UserCoupon = mongoose.model('UserCoupon', userCouponSchema);
