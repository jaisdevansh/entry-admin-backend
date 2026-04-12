import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    body: {
        type: String,
        required: true
    },
    message: { // Legacy Support
        type: String
    },
    type: {
        type: String,
        enum: ['order', 'issue', 'status', 'event', 'system', 'booking', 'info', 'success', 'warning', 'ai', 'membership'],
        default: 'system',
        index: true
    },
    data: {
        type: Object,
        default: {}
    },
    metadata: { // Legacy Support
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    isRead: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Sync body/message for compatibility
NotificationSchema.pre('save', function(next) {
    if (this.body && !this.message) this.message = this.body;
    if (this.message && !this.body) this.body = this.message;
    if (this.data && (!this.metadata || Object.keys(this.metadata).length === 0)) this.metadata = this.data;
    if (this.metadata && (!this.data || Object.keys(this.data).length === 0)) this.data = this.metadata;
    next();
});

// Optimized for fast retrieval of user's inbox
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });

const Notification = mongoose.model('Notification', NotificationSchema);
export default Notification;
export { Notification }; // Support both default and named export
