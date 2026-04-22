import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const hostSchema = new mongoose.Schema({
    name: { type: String, default: 'Stitch Host' },
    username: { type: String, unique: true, sparse: true },
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String }, // For authentication
    role: { type: String, enum: ['HOST'], default: 'HOST' },
    hostStatus: { type: String, enum: ['INVITED', 'KYC_PENDING', 'ACTIVE', 'REJECTED'], default: 'INVITED' },
    createdByAdmin: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    kycSubmitted: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    dateOfBirth: { type: String },
    kyc: {
        isVerified: { type: Boolean, default: false },
        documents: [{
            type: { type: String, enum: ['AADHAR', 'PAN', 'PASSPORT', 'OTHER'] }, // mapped 'type' carefully since 'type' is a mongoose keyword, but inside array of objects it's fine.
            url: { type: String },
            status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' }
        }]
    },
    profileImage: { type: String, default: '' },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
    onboardingCompleted: { type: Boolean, default: false },
    // 📍 LOCATION (NEW)
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
        city: { type: String, default: '' },
        state: { type: String, default: '' },
        country: { type: String, default: 'India' },
        address: { type: String, default: '' }
    },
    refreshToken: { type: String, default: null } // often needed for auth
}, { timestamps: true });

// Pre-save hook to hash password if modified
hostSchema.pre('save', async function (next) {
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
hostSchema.methods.comparePassword = async function (candidatePassword) {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
};

// 2dsphere index for location queries
hostSchema.index({ location: '2dsphere' });
hostSchema.index({ hostStatus: 1 });
hostSchema.index({ createdAt: -1 });
hostSchema.index({ role: 1 }); // Required for Admin panel filtering
hostSchema.index({ name: 'text', email: 'text', phone: 'text' }); // ⚡ Rocket-speed text search

export const Host = mongoose.model('Host', hostSchema);
