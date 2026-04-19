import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import compression from 'compression';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import passport from 'passport';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';

dotenv.config();

import { logger } from './src/logs/logger.js';

const NODE_ENV  = process.env.NODE_ENV || 'development';
const MONGO_URI = process.env.MONGO_URI;
const PORT      = process.env.PORT || 3002;

// ── Auth (shared — host/admin also log in via OTP) ────────────────────────────
import authRoutes    from './src/routes/auth.routes.js';

// ── Admin / Host / Staff Routes ───────────────────────────────────────────────
import adminRoutes    from './src/routes/admin.routes.js';
import adminChatRoutes from './src/routes/adminChat.routes.js';
import analyticsRoutes from './src/routes/analytics.routes.js';
import hostRoutes     from './src/routes/host.routes.js';
import staffRoutes    from './src/routes/staff.routes.js';
import waiterRoutes   from './src/routes/waiter.routes.js';
import securityRoutes from './src/routes/security.routes.js';
import chatRoutes     from './src/routes/chat.routes.js';
import { errorHandler, notFoundHandler } from './src/middleware/error.js';

// ── App Setup ─────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

// ⚡ PRODUCTION SECURITY - Helmet with strict CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// ⚡ INPUT SANITIZATION - Prevent NoSQL injection & XSS
app.use(mongoSanitize()); // Prevents NoSQL injection
app.use(xss()); // Prevents XSS attacks

app.use(compression());

// ⚡ PRODUCTION CORS - Whitelist specific origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:8081', 'http://localhost:19000', 'exp://192.168.0.0/--/']; // Dev fallback

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || origin.startsWith('exp://')) {
            callback(null, true);
        } else {
            logger.warn(`[CORS] Blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));
app.options('*', cors());

// ⚡ PRODUCTION RATE LIMITING - Higher limits for admin
app.use(rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 2000, // Higher for admin operations
    message: { success: false, message: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
}));

// ⚡ REQUEST TIMEOUT - Prevent hanging requests
app.use((req, res, next) => {
    req.setTimeout(30000); // 30 seconds
    res.setTimeout(30000);
    next();
});

// ⚡ REQUEST LOGGING - Production-safe
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) {
            logger.warn(`[SLOW API] ${req.method} ${req.originalUrl} - ${duration}ms`);
        }
    });
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(NODE_ENV === 'production' ? morgan('tiny') : morgan('dev'));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/',       (_, res) => res.json({ status: 'active', service: 'admin-api', env: NODE_ENV }));
app.get('/health', (_, res) => res.status(200).json({ success: true, service: 'admin-api', ts: new Date().toISOString() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',             authRoutes);      // host/admin login
app.use('/api/auth',         authRoutes);
app.use('/admin',            adminRoutes);
app.use('/admin-chat',       adminChatRoutes);
app.use('/host',             hostRoutes);
app.use('/analytics',        analyticsRoutes);
app.use('/api/v1/staff',     staffRoutes);
app.use('/api/v1/waiter',    waiterRoutes);
app.use('/api/v1/security',  securityRoutes);
app.use('/api/chat',         chatRoutes);  // 🆕 Production Chat System

// ⚡ 404 Handler - Must be after all routes
app.use(notFoundHandler);

// ⚡ Global Error Handler - Must be last
app.use(errorHandler);

// ── DB + Start ────────────────────────────────────────────────────────────────
const startServer = async () => {
    try {
        if (!MONGO_URI) { logger.error('MONGO_URI missing'); process.exit(1); }
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000, maxPoolSize: 50 });
        logger.info('✔ MongoDB connected (admin-api)');

        const { initSocket } = await import('./src/socket.js');

        const server = app.listen(PORT, '0.0.0.0', () => logger.info(`🚀 Admin API on port ${PORT}`));
        server.keepAliveTimeout = 65000;
        server.headersTimeout   = 66000;
        initSocket(server);

        // Pre-warm admin stats cache
        setTimeout(async () => {
            try {
                const { Host }    = await import('./src/models/Host.js');
                const { Booking } = await import('./src/models/booking.model.js');
                const { User }    = await import('./src/models/user.model.js');
                const { cacheService } = await import('./src/services/cache.service.js');
                const [userCount, activeHosts, totalHosts, pendingHosts, totalBookings, revenueAgg] = await Promise.all([
                    User.countDocuments({ role: 'user' }),
                    Host.countDocuments({ role: 'HOST', hostStatus: 'ACTIVE' }),
                    Host.countDocuments({ role: 'HOST' }),
                    Host.countDocuments({ hostStatus: { $in: ['INVITED', 'KYC_PENDING'] } }),
                    Booking.countDocuments({ status: { $in: ['approved', 'active', 'completed'] } }),
                    Booking.aggregate([{ $match: { paymentStatus: 'paid', status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$pricePaid' } } }])
                ]);
                await cacheService.set('admin_dashboard_stats', {
                    users: userCount, activeHosts, hosts: totalHosts,
                    pendingHosts, bookings: totalBookings,
                    totalRevenue: revenueAgg[0]?.total || 0,
                    updatedAt: new Date()
                }, 300);
                logger.info('⚡ Admin cache warm-up complete');
            } catch(e) { logger.warn('[AdminCache] ' + e.message); }
        }, 3000);

    } catch(err) { logger.error(err.message); process.exit(1); }
};

startServer();

// ⚡ PRODUCTION ERROR HANDLERS - Prevent crashes
process.on('uncaughtException', (err) => { 
    logger.error('💥 UNCAUGHT EXCEPTION - Shutting down gracefully', err); 
    process.exit(1); 
});

process.on('unhandledRejection', (err) => { 
    logger.error('💥 UNHANDLED REJECTION - Shutting down gracefully', err); 
    process.exit(1); 
});

process.on('SIGTERM', () => {
    logger.info('👋 SIGTERM received - Shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('👋 SIGINT received - Shutting down gracefully');
    process.exit(0);
});
