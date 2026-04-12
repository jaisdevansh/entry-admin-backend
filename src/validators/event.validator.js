import Joi from 'joi';

export const createEventSchema = Joi.object({
    title: Joi.string().min(3).max(100).required(),
    date: Joi.string().required(), // accepting any string that can be parsed into a date
    startTime: Joi.string().required(),
    description: Joi.string().allow('', null).optional(),
    coverImage: Joi.string().allow('', null).optional(),
    tickets: Joi.array().items(
        Joi.object({
            _id: Joi.string().optional(),
            type: Joi.string().required(),
            price: Joi.number().min(0).required(),
            capacity: Joi.number().min(1).required(),
            sold: Joi.number().min(0).optional()
        }).unknown(true)
    ).min(1).required(),
    status: Joi.string().valid('draft', 'published', 'cancelled', 'completed', 'DRAFT', 'LIVE', 'PUBLISHED').optional(),
    endTime: Joi.string().allow('', null).optional(),
    floorCount: Joi.number().optional().allow(null),
    images: Joi.array().items(Joi.string().allow('', null)).optional(),
    houseRules: Joi.array().items(
        Joi.alternatives().try(
            Joi.string(),
            Joi.object({ icon: Joi.string().optional(), title: Joi.string().optional(), detail: Joi.string().optional() }).unknown(true)
        )
    ).optional(),
    locationVisibility: Joi.string().valid('public', 'delayed', 'hidden').optional(),
    bookingOpenDate: Joi.string().allow('', null).optional(),
    allowNonTicketView: Joi.boolean().optional(),
    revealTime: Joi.alternatives().try(Joi.string(), Joi.number()).allow('', null).optional(),
    locationData: Joi.object().unknown(true).allow(null).optional(),
    freeRefreshments: Joi.array().items(
        Joi.object({
            title: Joi.string().required(),
            description: Joi.string().allow('', null).optional()
        }).unknown(true)
    ).optional()
}).unknown(true);

export const updateEventStatusSchema = Joi.object({
    status: Joi.string().valid('draft', 'published', 'cancelled', 'completed').required()
});
