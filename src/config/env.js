import dotenv from 'dotenv';
dotenv.config();

export const env = {
    PORT: process.env.PORT || 3000,
    MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/stitch',
    REDIS_URI: process.env.REDIS_URI || 'redis://localhost:6379',
    JWT_SECRET: process.env.JWT_SECRET || 'supersecretkey123',
    NODE_ENV: process.env.NODE_ENV || 'development',
};
