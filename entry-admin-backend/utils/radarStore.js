import Redis from 'ioredis';

// Attempt to connect to local Redis. If it fails, fallback to memory to prevent the server crashing on machines without Redis.
let redisClient;
try {
    redisClient = new Redis({
        host: '127.0.0.1',
        port: 6379,
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
            // Keep it silent if no redis, just stop retrying
            return null;
        }
    });

    redisClient.on('error', (err) => {
        // Silent block
    });
} catch (e) {
    // Ignored
}

// Fallback Memory Store (if Redis is not installed in the Windows machine)
// It manages automatic TTL for inactive users
const memoryStore = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of memoryStore.entries()) {
        if (now - value.lastSeen > 30000) { // 30s TTL
            memoryStore.delete(key);
        }
    }
}, 5000);

export const updateLocation = async (userId, data) => {
    const payload = {
        ...data,
        lastSeen: Date.now()
    };
    
    if (redisClient && redisClient.status === 'ready') {
        // Set with 30s EXPIRE for automatic removal
        await redisClient.set(`radar:user:${userId}`, JSON.stringify(payload), 'EX', 30);
    } else {
        memoryStore.set(String(userId), payload);
    }
};

export const getNearbyUsers = async (myUserId, myLat, myLong, radius = 5000) => {
    let users = [];
    
    if (redisClient && redisClient.status === 'ready') {
        const keys = await redisClient.keys('radar:user:*');
        for (let key of keys) {
            const uid = key.replace('radar:user:', '');
            if (uid !== String(myUserId)) {
                const val = await redisClient.get(key);
                if (val) {
                    const parsed = JSON.parse(val);
                    if (parsed.visibility) {
                        users.push({ userId: uid, ...parsed });
                    }
                }
            }
        }
    } else {
        const now = Date.now();
        for (const [uid, val] of memoryStore.entries()) {
            if (uid !== String(myUserId) && val.visibility && (now - val.lastSeen <= 30000)) {
                users.push({ userId: uid, ...val });
            }
        }
    }

    // Filter by approx distance 
    users = users.map(u => {
        const distance = calculateDistanceInMeters(myLat, myLong, u.latitude, u.longitude);
        return { ...u, distance: Math.round(distance) };
    }).filter(u => u.distance <= radius).sort((a,b) => a.distance - b.distance);

    return users;
};

// Haversine formula
function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

export const removeUser = async (userId) => {
    if (redisClient && redisClient.status === 'ready') {
        await redisClient.del(`radar:user:${userId}`);
    } else {
        memoryStore.delete(String(userId));
    }
};
