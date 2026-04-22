import Joi from 'joi';

export const updateProfileSchema = Joi.object({
    name: Joi.string().min(2).max(50).optional(),
    firstName: Joi.string().allow('').optional(),
    lastName: Joi.string().allow('').optional(),
    gender: Joi.string().valid('Male', 'Female', 'Other', '').optional(),
    phone: Joi.string().min(10).max(15).optional(),
    email: Joi.string().email().optional(),
    profileImage: Joi.string().allow('').optional(),
    bio: Joi.string().max(200).allow('').optional(),
    dob: Joi.alternatives().try(Joi.date(), Joi.string().allow('').optional()).optional(),
    location: Joi.string().allow('').optional(),
    username: Joi.string().pattern(/^[@a-zA-Z0-9_.-]+$/).min(3).max(30).allow('').optional()
});

export const changePasswordSchema = Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).required()
});

export const createBookingSchema = Joi.object({
    hostId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(), // MongoDB ObjectId regex
    serviceId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
    ticketType: Joi.string().optional(),
    pricePaid: Joi.number().optional()
});

export const updateMembershipSchema = Joi.object({
    tier: Joi.string().valid('Essential', 'Gold', 'Black').required()
});

export const bookEventSchema = Joi.object({
    eventId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
    ticketType: Joi.string().required(),
    tableId: Joi.string().optional(),
    seatIds: Joi.array().items(Joi.string()).optional(),
    totalAmount: Joi.number().optional(),
    pricePaid: Joi.number().optional(),
    guestCount: Joi.number().optional(),
    guests: Joi.number().optional(),
    paymentStatus: Joi.string().optional()
});
