import Joi from 'joi';

export const updateVenueSchema = Joi.object({
    name: Joi.string().min(2).max(100).allow('').optional(),
    venueType: Joi.string().allow('', null).optional(),
    description: Joi.string().allow('', null).optional(),
    address: Joi.string().min(5).allow('').optional(),
    capacity: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    openingTime: Joi.string().allow('', null).optional(),
    closingTime: Joi.string().allow('', null).optional(),
    rules: Joi.string().allow('', null).optional(),
    heroImage: Joi.string().allow('', null).optional(),
    images: Joi.array().items(Joi.string()).optional(),
    amenities: Joi.array().items(Joi.string()).optional()
}).unknown(true);
