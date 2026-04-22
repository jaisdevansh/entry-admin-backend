import mongoose from 'mongoose';

const menuItemSchema = new mongoose.Schema({
    name: { type: String },
    type: { type: String },           // e.g., 'Cocktail', 'Mocktail', 'Dish'
    category: { type: String },       // alias — app sends 'category'
    description: { type: String },
    desc: { type: String },           // alias — app sends 'desc'
    price: { type: Number, default: 0 },
    image: { type: String },
    inStock: { type: Boolean, default: true }
}, { _id: false });

const giftSchema = new mongoose.Schema({
    name: { type: String },
    category: { type: String },
    description: { type: String },
    price: { type: Number, default: 0 },
    inStock: { type: Boolean, default: true },
    image: { type: String }
}, { _id: false });

const venueSchema = new mongoose.Schema({
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String },
    venueType: { type: String, default: 'Nightclub' },
    description: { type: String },
    address: { type: String },
    coordinates: {
        lat: { type: Number },
        long: { type: Number },
        lng: { type: Number },        // alias — app may send 'lng'
        latitude: { type: Number },   // alias — app may send 'latitude'
        longitude: { type: Number }   // alias — app may send 'longitude'
    },
    capacity: { type: Number, default: 0 },
    openingTime: { type: String, default: '10:00 PM' },
    closingTime: { type: String, default: '04:00 AM' },
    rules: { type: String },
    heroImage: { type: String },
    images: [{ type: String }],
    amenities: [{ type: String }],
    menu: [menuItemSchema],
    gifts: [giftSchema],
    status: { type: String, enum: ['active', 'pending_verification'], default: 'pending_verification' }
}, { timestamps: true });

venueSchema.index({ status: 1, venueType: 1 });

export const Venue = mongoose.model('Venue', venueSchema);
