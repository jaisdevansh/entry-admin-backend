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
import { errorHandler } from './src/middleware/error.js';

// ── App Setup ─────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] }));
app.options('*', cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, message: { success: false, message: 'Too many requests' } }));
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

app.use((req, res) => res.status(404).json({ success: false, message: 'Endpoint not found' }));
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
process.on('uncaughtException',  (err) => { logger.error('Uncaught Exception',  err); process.exit(1); });
process.on('unhandledRejection', (err) => { logger.error('Unhandled Rejection', err); process.exit(1); });
