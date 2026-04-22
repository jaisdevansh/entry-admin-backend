import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: false },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    scores: {
        vibe:    { type: Number, min: 1, max: 5, required: true },
        service: { type: Number, min: 1, max: 5, required: true },
        music:   { type: Number, min: 1, max: 5, required: true }
    },
    avgScore: { type: Number, required: true },
    feedback: { type: String, maxlength: 1000, default: '' },
    isAnonymous: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: true }
}, { timestamps: true });

// Fast host-side review dashboard queries
reviewSchema.index({ hostId: 1, isPublished: 1 });
reviewSchema.index({ hostId: 1, createdAt: -1 });
reviewSchema.index({ eventId: 1, isPublished: 1, createdAt: -1 });
// Prevent duplicate reviews per event (sparse: only applies when eventId exists)
reviewSchema.index({ userId: 1, eventId: 1 }, { unique: true, sparse: true });

export const Review = mongoose.model('Review', reviewSchema);
