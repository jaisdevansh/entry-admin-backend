import mongoose from 'mongoose';

const issueReportSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
        enum: ['medical', 'harassment', 'fight', 'unsafe', 'other'], 
        required: true 
    },
    message: { type: String, required: true },
    zone: { type: String, default: 'General' },
    tableId: { type: String, default: 'N/A' },
    userName: { type: String, default: 'Guest' }, // Denormalized for cross-DB display
    status: { 
        type: String, 
        enum: ['open', 'in_progress', 'resolved'], 
        default: 'open' 
    },
    assignedSecurityId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date },
}, { timestamps: true });

// Virtual for priority sorting
issueReportSchema.virtual('priority').get(function() {
    const priorities = {
        'medical': 1,
        'harassment': 2,
        'fight': 3,
        'unsafe': 4,
        'other': 5
    };
    return priorities[this.type] || 99;
});

issueReportSchema.index({ status: 1 });
issueReportSchema.index({ type: 1 });
issueReportSchema.index({ assignedSecurityId: 1 });
issueReportSchema.index({ status: 1, createdAt: -1 });         // Status-time filtered queries
issueReportSchema.index({ zone: 1, type: 1, createdAt: -1 }); // Duplicate window detection

export const IssueReport = mongoose.model('IssueReport', issueReportSchema);
