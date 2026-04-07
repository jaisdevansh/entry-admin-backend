import mongoose from 'mongoose';

/** 
 * Gift — Standalone collection, owned by Host.
 * 
 * Design decisions:
 *  1. hostId index           → O(1) lookup for all gifts by host
 *  2. (hostId, inStock)      → Discovery queries filter by inStock=true, covered by compound index
 *  3. (hostId, sortOrder)    → Host reorders gifts; compound index keeps sort free
 *  4. isDeleted soft-delete  → Gifts removed by host are recoverable; audit trail intact
 *  5. sortOrder              → Host controls display ordering on user-facing gift tabs
 *  6. tags[]                 → Client-side filter chips (Chocolates, Flowers) without extra queries
 */

const giftSchema = new mongoose.Schema(
    {
        hostId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        price: {
            type: Number,
            required: true,
            min: 0,
        },
        category: {
            type: String,
            required: true,
            trim: true,
        },
        tags: {
            type: [String],
            default: [],
        },
        image: {
            type: String,        // Cloudinary URL — empty string means no image
            default: '',
        },
        inStock: {
            type: Boolean,
            default: true,
        },
        sortOrder: {
            type: Number,
            default: 0,          // Lower = shown first; host can reorder
        },
        isDeleted: {
            type: Boolean,
            default: false,      // Soft-delete: never hard-remove from DB
        },
    },
    {
        timestamps: true,
        // Lean serialization hints
        toJSON: { virtuals: false },
        toObject: { virtuals: false },
    }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Discovery query: Gift.find({ hostId, inStock: true }).sort({ sortOrder })
// This compound index covers all 3 fields → zero collection scans
giftSchema.index({ hostId: 1, isDeleted: 1, inStock: 1, sortOrder: 1 });

// Host panel "my gifts" list — sorted by creation (newest first)
giftSchema.index({ hostId: 1, isDeleted: 1, createdAt: -1 });

// ─── Static helpers ───────────────────────────────────────────────────────────
/**
 * findForHost — all non-deleted gifts for a host, ordered by sortOrder
 * Usage: await Gift.findForHost(hostId)
 */
giftSchema.statics.findForHost = function (hostId) {
    return this.find({ hostId, isDeleted: false })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
};

/**
 * findForDiscovery — only in-stock, non-deleted gifts (user-facing)
 * Usage: await Gift.findForDiscovery(hostId)
 */
giftSchema.statics.findForDiscovery = function (hostId) {
    return this.find({ hostId, isDeleted: false, inStock: true })
        .sort({ sortOrder: 1 })
        .select('name description price category image tags')  // Minimal projection
        .lean();
};

/**
 * softDelete — marks isDeleted=true instead of hard remove
 * Usage: await Gift.softDelete(giftId, hostId)
 */
giftSchema.statics.softDelete = function (giftId, hostId) {
    return this.findOneAndUpdate(
        { _id: giftId, hostId, isDeleted: false },
        { isDeleted: true },
        { new: true }
    );
};

export const Gift = mongoose.model('Gift', giftSchema);
