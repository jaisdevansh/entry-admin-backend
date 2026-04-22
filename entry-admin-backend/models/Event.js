import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
    type: { type: String, required: true }, // e.g. 'General Access', 'VIP Table'
    price: { type: Number, required: true },
    capacity: { type: Number, required: true },
    sold: { type: Number, default: 0 }
});

const floorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    capacity: { type: Number, required: true },
    bookedCount: { type: Number, default: 0 },
    perks: [{ type: String }],
    color: { type: String, default: '#7C4DFF' }, // Hex color for UI
    icon: { type: String, default: 'star' },    // Ionicon name
    isActive: { type: Boolean, default: true },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' }
});

const eventSchema = new mongoose.Schema({
    hostId: { type: mongoose.Schema.Types.ObjectId, refPath: 'hostModel', required: true },
    hostModel: { type: String, required: true, enum: ['User', 'Host'], default: 'Host' },
    title: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String },
    description: { type: String },
    coverImage: { type: String },
    images: [{ type: String }],
    houseRules: [{
        icon: { type: String },
        title: { type: String },
        detail: { type: String }
    }],
    attendeeCount: { type: Number, default: 0 },
    floorCount: { type: Number, default: 1 },
    locationVisibility: { type: String, enum: ['public', 'delayed', 'hidden'], default: 'public' },
    revealTime: { type: Date },
    isLocationRevealed: { type: Boolean, default: false },
    allowNonTicketView: { type: Boolean, default: false },
    locationData: {
        lat: { type: Number },
        lng: { type: Number },
        address: { type: String }
    },
    freeRefreshments: [{
        title: { type: String, required: true },
        description: { type: String },
        icon: { type: String, default: 'fast-food-outline' }
    }],
    tickets: [ticketSchema],
    floors: [floorSchema],
    status: { type: String, enum: ['DRAFT', 'LIVE', 'PAUSED'], default: 'DRAFT' },
    isFeatured: { type: Boolean, default: false },
    isTrending: { type: Boolean, default: false },
    reportCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    bookingOpenDate: { type: Date }
}, { timestamps: true });

// Compound indexes for fast querying
eventSchema.index({ hostId: 1, createdAt: -1 });
eventSchema.index({ hostId: 1, status: 1 });
eventSchema.index({ status: 1, date: 1 });
eventSchema.index({ title: 'text', description: 'text' }); // ⚡ Rocket-speed event search


export const Event = mongoose.model('Event', eventSchema);
