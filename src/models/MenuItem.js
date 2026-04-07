import mongoose from 'mongoose';

const menuItemSchema = new mongoose.Schema({
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue' },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    desc: { type: String },
    image: { type: String },
    inStock: { type: Boolean, default: true }
}, { timestamps: true });

menuItemSchema.index({ hostId: 1, category: 1 });
menuItemSchema.index({ eventId: 1, category: 1 });
menuItemSchema.index({ venueId: 1, category: 1 });

export const MenuItem = mongoose.model('MenuItem', menuItemSchema);
