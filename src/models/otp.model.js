import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
    identifier: { type: String, required: true },
    otp: { type: String, required: true },
    createdAt: { type: Date, expires: '5m', default: Date.now } // Automatically deletes after 5 mins
});

export const Otp = mongoose.model('Otp', otpSchema);
