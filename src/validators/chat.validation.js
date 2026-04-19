import Joi from 'joi';

// ─── Shared validators ────────────────────────────────────────────────────────

const objectId = () =>
    Joi.string()
        .pattern(/^[a-f\d]{24}$/i)
        .messages({ 'string.pattern.base': '{{#label}} must be a valid MongoDB ObjectId' });

// ─── Conversation ─────────────────────────────────────────────────────────────

export const createConversationSchema = Joi.object({
    userId: objectId().required().label('userId'),
});

// ─── Messages ─────────────────────────────────────────────────────────────────

export const sendMessageSchema = Joi.object({
    conversationId: objectId().required().label('conversationId'),
    text:  Joi.string().trim().max(5000).when('type', {
        is: 'text',
        then: Joi.required(),
        otherwise: Joi.optional().allow('', null),
    }),
    type:     Joi.string().valid('text', 'image', 'video').default('text'),
    mediaUrl: Joi.string().uri().when('type', {
        is: Joi.valid('image', 'video'),
        then: Joi.required(),
        otherwise: Joi.optional().allow('', null),
    }),
});

export const getMessagesSchema = Joi.object({
    cursor: objectId().optional().allow('', null).label('cursor'),
    limit:  Joi.number().integer().min(1).max(100).default(20),
});

export const markReadSchema = Joi.object({
    conversationId: objectId().required().label('conversationId'),
    lastMessageId:  objectId().required().label('lastMessageId'),
});

export const searchUsersSchema = Joi.object({
    q: Joi.string().trim().min(2).max(50).required().label('search query'),
});

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Validates req.body against a Joi schema.
 * Returns 422 with structured errors on failure.
 */
export const validate = (schema, source = 'body') =>
    (req, res, next) => {
        const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
        if (error) {
            const errors = error.details.map((d) => d.message);
            return res.status(422).json({ success: false, message: 'Validation failed', errors });
        }
        req[source] = value; // replace with sanitized/coerced values
        next();
    };
