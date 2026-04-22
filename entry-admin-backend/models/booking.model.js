import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Host', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId }, // E.g., Event or Service Listing

    // Event specific fields
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
    floorId: { type: mongoose.Schema.Types.ObjectId },
    ticketType: { type: String },
    tableId: { type: String },
    seatIds: [{ type: String }],
    guests: { type: Number, default: 1 },
    guestsEntered: { type: Number, default: 0 },
    pricePaid: { type: Number },
    qrPayload: { type: String, sparse: true },
    checkInTime: { type: Date },

    status: { type: String, enum: ['pending', 'approved', 'rejected', 'active', 'checked_in', 'cancelled', 'invalid'], default: 'pending' },
    paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' }
}, { timestamps: true });

bookingSchema.index({ userId: 1, createdAt: -1 });
bookingSchema.index({ hostId: 1, createdAt: -1 });
bookingSchema.index({ eventId: 1, status: 1 });
bookingSchema.index({ eventId: 1, tableId: 1 });
bookingSchema.index({ eventId: 1, seatIds: 1 });
bookingSchema.index({ status: 1, paymentStatus: 1 }); // Required for Revenue aggregation
bookingSchema.index({ createdAt: -1 }); // Global sorting
bookingSchema.index({ paymentStatus: 1 }); // Revenue counting


export const Booking = mongoose.model('Booking', bookingSchema);
