import mongoose from 'mongoose';

const appRatingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    feedback: { type: String, maxlength: 500 },
}, { timestamps: true });

export const AppRating = mongoose.model('AppRating', appRatingSchema);
