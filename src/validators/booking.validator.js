import Joi from 'joi';

export const scanQRSchema = Joi.object({
    qrPayload: Joi.string().min(10).required(),
    eventId: Joi.string().length(24).required() // MongoDB ObjectId length
});
