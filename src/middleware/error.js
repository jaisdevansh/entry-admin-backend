import { ErrorResponse } from '../utils/errorResponse.js';
import { logger } from '../logs/logger.js';

/**
 * ⚡ PRODUCTION-READY GLOBAL ERROR HANDLER - ADMIN API
 * Handles all errors with proper logging, sanitization, and security
 */
export const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    // ── Mongoose Errors ───────────────────────────────────────────────────────
    
    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        const message = 'Invalid resource identifier';
        error = new ErrorResponse(message, 404);
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0] || 'field';
        const message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
        error = new ErrorResponse(message, 400);
    }

    // Mongoose validation errors
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        error = new ErrorResponse(messages.join(', '), 400);
    }

    // ── JWT Errors ────────────────────────────────────────────────────────────
    
    if (err.name === 'JsonWebTokenError') {
        error = new ErrorResponse('Invalid authentication token', 401);
    }

    if (err.name === 'TokenExpiredError') {
        error = new ErrorResponse('Authentication token expired', 401);
    }

    // ── Multer Errors (File Upload) ───────────────────────────────────────────
    
    if (err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') {
            error = new ErrorResponse('File size too large (max 10MB)', 400);
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            error = new ErrorResponse('Too many files uploaded', 400);
        } else {
            error = new ErrorResponse('File upload error', 400);
        }
    }

    // ── Rate Limit Errors ─────────────────────────────────────────────────────
    
    if (err.name === 'TooManyRequestsError' || err.status === 429) {
        error = new ErrorResponse('Too many requests, please try again later', 429);
    }

    // ── CORS Errors ───────────────────────────────────────────────────────────
    
    if (err.message && err.message.includes('CORS')) {
        error = new ErrorResponse('Access denied', 403);
    }

    // ── Syntax Errors (Malformed JSON) ────────────────────────────────────────
    
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        error = new ErrorResponse('Invalid request format', 400);
    }

    // ── Database Connection Errors ────────────────────────────────────────────
    
    if (err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError') {
        error = new ErrorResponse('Database connection error, please try again', 503);
    }

    // ── Final Error Response ──────────────────────────────────────────────────
    
    const statusCode = error.statusCode || err.statusCode || 500;
    const message = error.message || 'Internal Server Error';

    // ⚡ PRODUCTION LOGGING - Log to file, not console
    if (statusCode >= 500) {
        logger.error(`[${statusCode}] ${req.method} ${req.originalUrl}`, {
            error: message,
            stack: err.stack,
            user: req.user?.id,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });
    } else if (statusCode >= 400) {
        logger.warn(`[${statusCode}] ${req.method} ${req.originalUrl}`, {
            error: message,
            user: req.user?.id,
            ip: req.ip
        });
    }

    // ⚡ SECURITY: Never expose internal errors in production
    const isProduction = process.env.NODE_ENV === 'production';
    const responseMessage = statusCode >= 500 && isProduction 
        ? 'Internal Server Error' 
        : message;

    res.status(statusCode).json({
        success: false,
        message: responseMessage,
        ...(statusCode === 400 && error.errors && { errors: error.errors }),
        ...(!isProduction && { stack: err.stack })
    });
};

/**
 * ⚡ ASYNC ERROR WRAPPER
 * Wraps async route handlers to catch errors automatically
 * Usage: router.get('/path', asyncHandler(myController))
 */
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * ⚡ 404 NOT FOUND HANDLER
 * Must be placed after all routes
 */
export const notFoundHandler = (req, res, next) => {
    const error = new ErrorResponse(`Route ${req.originalUrl} not found`, 404);
    next(error);
};
