import mongoose from 'mongoose';

const waitlistSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    partySize: { type: Number, default: 1 },
    isPriority: { type: Boolean, default: false }, // If the user bought the Waitlist Priority package
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    transactionId: { type: String, default: null } // To securely verify priority payment
}, { timestamps: true });

// Host dashboard: all waitlist entries per event
waitlistSchema.index({ hostId: 1, eventId: 1, status: 1 });
// User: did I join this waitlist?
waitlistSchema.index({ userId: 1, eventId: 1 }, { unique: true });
// Priority queue ordering
waitlistSchema.index({ eventId: 1, isPriority: -1, createdAt: 1 });

export const Waitlist = mongoose.model('Waitlist', waitlistSchema);
