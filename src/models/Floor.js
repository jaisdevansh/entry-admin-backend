import mongoose from 'mongoose';

const floorSchema = new mongoose.Schema({
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    capacity: { type: Number, required: true },
    bookedCount: { type: Number, default: 0 },
    perks: [{ type: String }],
    color: { type: String, default: '#7C4DFF' },
    icon: { type: String, default: 'star' },
    isActive: { type: Boolean, default: true },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' }
}, { timestamps: true });

export const Floor = mongoose.model('Floor', floorSchema);
