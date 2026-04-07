import mongoose from 'mongoose';

const DeviceTokenSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    fcmToken: {
        type: String,
        required: true,
        unique: true
    },
    role: {
        type: String,
        enum: ['user', 'waiter', 'security', 'admin'],
        required: true,
        index: true
    },
    platform: {
        type: String,
        enum: ['ios', 'android', 'web'],
        default: 'android'
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Ensure one token per device/user pair is updated
DeviceTokenSchema.index({ userId: 1, fcmToken: 1 }, { unique: true });

const DeviceToken = mongoose.model('DeviceToken', DeviceTokenSchema);
export default DeviceToken;
