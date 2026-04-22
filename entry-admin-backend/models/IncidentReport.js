import mongoose from 'mongoose';

const incidentReportSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', default: null },
    category: { 
        type: String, 
        enum: ['Harassment & Conduct', 'Lost & Found', 'Safety & Security', 'Emergency', 'Billing Issue', 'Technical Bug', 'Something Else'], 
        required: true 
    },
    title: { type: String, required: true },
    description: { type: String, required: true, maxlength: 1000 },
    images: [{ type: String }],
    location: { type: String, default: '' },
    isAnonymous: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'investigating', 'resolved'], default: 'pending' },
    metadata: { type: Object, default: {} }
}, { timestamps: true });

export const IncidentReport = mongoose.model('IncidentReport', incidentReportSchema);
