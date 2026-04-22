import mongoose from 'mongoose';

const drinkRequestItemSchema = new mongoose.Schema({
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    name: { type: String, required: true }
});

const drinkRequestSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    items: [drinkRequestItemSchema],
    message: { type: String, maxLength: 200 },
    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'expired', 'completed_payment'], default: 'pending' },
    totalAmount: { type: Number, required: true },
    expiresAt: { type: Date } 
}, { timestamps: true });

// Indexing for quick retrieval by user
drinkRequestSchema.index({ receiverId: 1, status: 1 });
drinkRequestSchema.index({ senderId: 1, status: 1 });

export const DrinkRequest = mongoose.model('DrinkRequest', drinkRequestSchema);
