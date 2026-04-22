import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../logs/logger.js';

export const connectDB = async () => {
    try {
        await mongoose.connect(env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000
        });
        logger.info('MongoDB connected successfully');
    } catch (err) {
        logger.error(`MongoDB connection error: ${err.message}. Ensure MongoDB is running.`);
        // Not calling process.exit(1) so Fastify can still listen on the port
    }
};
