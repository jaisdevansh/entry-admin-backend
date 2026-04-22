import mongoose from 'mongoose';

const mediaSchema = new mongoose.Schema({
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    url: { type: String, required: true },
    type: { type: String, enum: ['image', 'video'], default: 'image' },
    status: { type: String, enum: ['Approved', 'Pending', 'Rejected'], default: 'Pending' },
    fileName: { type: String },
    fileSize: { type: Number },
    mimeType: { type: String }
}, { timestamps: true });

export const Media = mongoose.model('Media', mediaSchema);
