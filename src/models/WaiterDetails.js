import mongoose from 'mongoose';

const waiterDetailsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    waiterType: { type: String, enum: ['order', 'gift', 'both'], default: 'order' },
    assignedSection: { type: String, enum: ['vip', 'general', 'lounge', 'all'], default: 'all' },
    maxActiveOrders: { type: Number, default: 3 }
}, { timestamps: true });

export const WaiterDetails = mongoose.model('WaiterDetails', waiterDetailsSchema);

