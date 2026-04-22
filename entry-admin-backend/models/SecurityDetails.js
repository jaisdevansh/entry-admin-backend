import mongoose from 'mongoose';

const securityDetailsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    assignedGate: { type: String, enum: ['gate1', 'gate2', 'vip_entry', 'all'], default: 'all' },
    dutyType: { type: String, enum: ['entry_check', 'crowd_control', 'patrolling'], default: 'entry_check' }
}, { timestamps: true });

export const SecurityDetails = mongoose.model('SecurityDetails', securityDetailsSchema);
