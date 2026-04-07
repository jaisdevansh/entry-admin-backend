import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    reason: { type: String, enum: ['Spam', 'Abuse', 'Fraud', 'Inappropriate Content', 'Other'], required: true },
    details: { type: String, maxLength: 500 },
    status: { type: String, enum: ['PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED'], default: 'PENDING' }
}, { timestamps: true });

// Prevent duplicate reports from same user for same event
reportSchema.index({ reportedBy: 1, eventId: 1 }, { unique: true });

export const Report = mongoose.model('Report', reportSchema);
