import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const adminSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    passwordHash: { type: String },
    role: { type: String, enum: ['ADMIN'], default: 'ADMIN', immutable: true },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    profileImage: { type: String, default: '' },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
    onboardingCompleted: { type: Boolean, default: false },
    lastLoginAt: { type: Date }
}, { timestamps: true });

// Hash password before save
adminSchema.pre('save', async function (next) {
    if (!this.isModified('passwordHash')) return next();
    try {
        const salt = await bcrypt.genSalt(12);
        this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// Verify password
adminSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.passwordHash);
};

// Indexes
adminSchema.index({ phone: 1 });
adminSchema.index({ role: 1 });
adminSchema.index({ createdAt: -1 });
adminSchema.index({ isActive: 1 });

export const Admin = mongoose.model('Admin', adminSchema);
