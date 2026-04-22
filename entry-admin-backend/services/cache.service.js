import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
dotenv.config();

/**
 * High-Performance Cache Service using Upstash Redis
 * Optimized for: Sub-10ms latency, automatic in-memory fallback, and production scaling.
 */
class HighPerformanceCache {
    constructor() {
        this.isUpstashEnabled = false;
        this.localStore = new Map(); // Performance fallback for local dev

        const url = process.env.UPSTASH_REDIS_REST_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN;

        if (url && token) {
            try {
                this.client = new Redis({ url, token });
                this.isUpstashEnabled = true;
                console.log('[Cache Engine] Upstash Redis Hybrid Layer Active ✅');
            } catch (err) {
                console.warn('[Cache Engine] Initialization failed. Falling back to local memory.');
                this.isUpstashEnabled = false;
            }
        } else {
            console.log('[Cache Engine] Running in Legacy/Local mode (Memory Cache). To optimize globally, add UPSTASH keys to .env');
            this.isUpstashEnabled = false;
        }
    }

    /**
     * Standardized Cache Key Generator (Multi-Segment)
     * @param {string} prefix 
     * @param {...string} segments
     */
    formatKey(prefix, ...segments) {
        return [prefix, ...segments].join(':');
    }

    /**
     * High-Level Fetch-Through Proxy
     * @param {string} key 
     * @param {number} ttl 
     * @param {Function} fetchFn 
     */
    async wrap(key, ttl, fetchFn) {
        return this.fetchWithCache(key, fetchFn, ttl);
    }

    /**
     * Cache-First Data Fetcher
     * @param {string} key Cache key
     * @param {Function} fetchFn Function to retrieve data from DB if cache miss
     * @param {number} ttl Seconds before expiry
     */
    async fetchWithCache(key, fetchFn, ttl = 300) {
        const cached = await this.get(key);
        if (cached) return cached;

        const freshData = await fetchFn();
        if (freshData) {
            await this.set(key, freshData, ttl);
        }
        return freshData;
    }

    async set(key, value, ttl = 300) {
        try {
            if (this.isUpstashEnabled) {
                await this.client.set(key, value, { ex: ttl });
            } else {
                this.localStore.set(key, { value, exp: Date.now() + (ttl * 1000) });
            }
        } catch (err) {
            console.error('[Cache Set Error]', err);
        }
    }

    async get(key) {
        try {
            if (this.isUpstashEnabled) {
                return await this.client.get(key);
            } else {
                const item = this.localStore.get(key);
                if (!item) return null;
                if (Date.now() > item.exp) {
                    this.localStore.delete(key);
                    return null;
                }
                return item.value;
            }
        } catch (err) {
            console.error('[Cache Get Error]', err);
            return null;
        }
    }

    async delete(key) {
        try {
            if (this.isUpstashEnabled) {
                await this.client.del(key);
            } else {
                this.localStore.delete(key);
            }
        } catch (err) {
            console.error('[Cache Delete Error]', err);
        }
    }

    // High-Performance Alias for Redis-Standard 'del'
    async del(key) {
        return this.delete(key);
    }

    async flushAll() {
        try {
            if (this.isUpstashEnabled) {
                await this.client.flushall();
            } else {
                this.localStore.clear();
            }
            console.log('[Cache Engine] Full Purge Completed.');
        } catch (err) {
            console.error('[Cache Flush Error]', err);
        }
    }
}

export const cacheService = new HighPerformanceCache();
