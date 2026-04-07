import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const staffSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, unique: true, sparse: true },
    email: { type: String, sparse: true },
    phone: { type: String, sparse: true },
    password: { type: String }, // Assuming they still need to login via password like users
    role: { 
        type: String, 
        enum: ['USER', 'STAFF', 'HOST', 'ADMIN'],
        default: 'STAFF' 
    },
    staffType: { 
        type: String, 
        enum: ['WAITER', 'SECURITY', 'MANAGER']
    },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    hostId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    completedOrders: { type: Number, default: 0 },
    rating: { type: Number, default: 5.0 },
    profileImage: { type: String, default: '' },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
    onboardingCompleted: { type: Boolean, default: false },
    shiftStartedAt: { type: Date }
}, { timestamps: true });

// Pre-save hook to hash password if modified
staffSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// Method to verify password
staffSchema.methods.comparePassword = async function (candidatePassword) {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
};

// High performance indexes
staffSchema.index({ hostId: 1, isActive: 1, staffType: 1 }); // Host discovery optimization
staffSchema.index({ createdAt: -1 }); // Global list sorting
staffSchema.index({ name: 'text', email: 'text', phone: 'text' }); // ⚡ Pulse-search index

export const Staff = mongoose.model('Staff', staffSchema);
