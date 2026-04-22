import Joi from 'joi';

export const registerSchema = Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    phone: Joi.string().min(10).max(15).required()
});

export const loginSchema = Joi.object({
    identifier: Joi.string().required(),
    password: Joi.string().required()
});

export const refreshTokenSchema = Joi.object({
    token: Joi.string().required()
});

export const forgotPasswordSchema = Joi.object({
    email: Joi.string().email().required()
});

export const resetPasswordSchema = Joi.object({
    resetToken: Joi.string().required(),
    newPassword: Joi.string().min(6).required()
});

export const sendOtpSchema = Joi.object({
    identifier: Joi.string().required()
});

export const verifyOtpSchema = Joi.object({
    identifier: Joi.string().required(),
    otp: Joi.string().length(6).required(),
    idToken: Joi.string().optional() // For Firebase alternative
});
