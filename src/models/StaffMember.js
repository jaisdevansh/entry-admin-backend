import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * StaffMember — Dedicated collection for all operational staff.
 * 
 * ✅ Why separate from User:
 *  - Users = customers, hosts. Staff = operational workers.
 *  - User collection stays lean; no hostId, preferredZone, onboarding bloat for staff.
 *  - Staff can be added/removed by host without polluting user auth flows.
 *  - Simpler role management: one collection, one query.
 */
const staffMemberSchema = new mongoose.Schema({
    hostId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        sparse: true,
        trim: true
    },
    email: {
        type: String,
        sparse: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String  // Hashed — staff use phone+password login, not OTP
    },
    role: {
        type: String,
        enum: ['waiter', 'security', 'manager', 'reception'],
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    profileImage: {
        type: String,
        default: ''
    },
    refreshToken: {
        type: String,
        default: null
    },

    // ── Waiter-specific ──────────────────────────────────────
    assignedSection: {
        type: String,
        enum: ['vip', 'general', 'lounge', 'all'],
        default: 'all'
    },
    maxActiveOrders: {
        type: Number,
        default: 3
    },
    waiterType: {
        type: String,
        enum: ['order', 'gift', 'both'],
        default: 'both'
    },

    // ── Security-specific ─────────────────────────────────────
    assignedGate: {
        type: String,
        enum: ['gate1', 'gate2', 'vip_entry', 'all'],
        default: 'all'
    },
    dutyType: {
        type: String,
        enum: ['entry_check', 'crowd_control', 'patrolling'],
        default: 'entry_check'
    }
}, { timestamps: true });

// ── Password hashing ──────────────────────────────────────────────────────────
staffMemberSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

staffMemberSchema.methods.comparePassword = async function (candidate) {
    return bcrypt.compare(candidate, this.password);
};

// ── Indexes ───────────────────────────────────────────────────────────────────
// Host staff dashboard: list all staff by host
staffMemberSchema.index({ hostId: 1, role: 1 });
staffMemberSchema.index({ hostId: 1, isActive: 1, createdAt: -1 });

// Login lookups (phone/email must be fast)
// staffMemberSchema.index({ phone: 1 }, { sparse: true });
// staffMemberSchema.index({ email: 1 }, { sparse: true });

// Waiter queue: filter by section + active status
staffMemberSchema.index({ role: 1, isActive: 1, assignedSection: 1 });

export const StaffMember = mongoose.model('StaffMember', staffMemberSchema);
