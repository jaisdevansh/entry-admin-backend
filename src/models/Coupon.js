import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for system coupons
    title: { type: String, required: true },
    code: { type: String, required: true, uppercase: true },
    discountType: { type: String, enum: ['percentage', 'flat'], default: 'percentage' },
    discountValue: { type: Number, required: true },
    minPurchase: { type: Number, default: 0 },
    maxDiscount: { type: Number },
    pointsCost: { type: Number, default: 0 },
    applicableOn: { type: String, enum: ['event', 'gift', 'all'], default: 'all' },
    expiryDays: { type: Number, default: 30 }, // Days valid from purchase
    expiryDate: { type: Date }, // Fixed expiry (optional)
    usageLimit: { type: Number, default: 100 },
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

couponSchema.index({ isActive: 1, pointsCost: 1 });

export const Coupon = mongoose.model('Coupon', couponSchema);
