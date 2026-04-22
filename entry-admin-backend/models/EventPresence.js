import mongoose from 'mongoose';

const eventPresenceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    lat: { type: Number },
    lng: { type: Number },
    visibility: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

// Avoid duplicate presence records
eventPresenceSchema.index({ userId: 1, eventId: 1 }, { unique: true });

// Optimized index for finding nearby users on Discovery
eventPresenceSchema.index({ eventId: 1, visibility: 1, lastSeen: -1 });

export const EventPresence = mongoose.model('EventPresence', eventPresenceSchema);
