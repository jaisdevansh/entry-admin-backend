import Joi from 'joi';

/**
 * Universal Joi Validation Middleware
 * Validates req.body, req.query, or req.params against a Joi schema.
 * Prevents NoSQL injections by stripping unknown parameters.
 * 
 * @param {Joi.ObjectSchema} schema - The Joi schema to validate against
 * @param {String} source - 'body', 'query', or 'params'
 */
export const validate = (schema, source = 'body') => (req, res, next) => {
    if (!schema || !schema.validate) {
        return next();
    }

    const { error, value } = schema.validate(req[source], {
        abortEarly: false,
        stripUnknown: true // Crucial for NoSQL injection prevention
    });

    if (error) {
        return res.status(400).json({
            success: false,
            message: 'Validation Error: ' + error.details.map(detail => detail.message).join(', ')
        });
    }

    // Overwrite the request property with the sanitized value
    req[source] = value;
    next();
};
