import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { Admin } from '../models/admin.model.js';
import { Host } from '../models/Host.js';
import { Staff } from '../models/Staff.js';
import { cacheService } from '../services/cache.service.js';

export const protect = async (req, res, next) => {
    try {
        let token;

        // Check for token in cookies first, then auth header
        if (req.cookies && req.cookies.accessToken) {
            token = req.cookies.accessToken;
        } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            console.log('[Auth] No token provided');
            return res.status(401).json({ success: false, message: 'Not authorized to access this route', data: {} });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey123');
        console.log('[Auth] Token decoded:', { userId: decoded.userId, role: decoded.role });

        // ⚡ HIGH-PERFORMANCE ROLE & STATUS VALIDATION (Sub-ms via Redis)
        const CACHE_KEY = `auth_status_${decoded.userId}`;
        let cached = await cacheService.get(CACHE_KEY);
        
        let userRole = decoded.role;
        let isActive = true;

        if (!cached) {
            const projection = 'role isActive';
            // Check in priority order: Admin > Host > Staff > User
            const user = await Admin.findById(decoded.userId).select(projection).lean() ||
                   await Host.findById(decoded.userId).select(projection).lean() ||
                   await Staff.findById(decoded.userId).select(projection).lean() ||
                   await User.findById(decoded.userId).select(projection).lean();
            
            if (user) {
                userRole = user.role;
                isActive = user.isActive;
                console.log('[Auth] User found:', { userId: decoded.userId, role: userRole, isActive });
                await cacheService.set(CACHE_KEY, { role: userRole, isActive }, 120);
            } else {
                console.log('[Auth] User not found in any collection:', decoded.userId);
                return res.status(401).json({ success: false, message: 'Token is invalid or expired' });
            }
        } else {
            userRole = cached.role;
            isActive = cached.isActive;
            console.log('[Auth] Cache hit:', { userId: decoded.userId, role: userRole, isActive });
        }

        if (!isActive) {
            console.log('[Auth] User inactive:', decoded.userId);
            return res.status(401).json({ success: false, message: 'Your administrative session has been revoked.' });
        }

        const userId = decoded.userId || decoded.id || decoded._id;
        
        req.user = { 
            ...decoded, 
            id: userId, 
            _id: userId, 
            userId: userId,
            role: userRole 
        };
        
        next();
    } catch (error) {
        console.error('[Auth Middleware] Error:', error.message);
        return res.status(401).json({ success: false, message: 'Token is invalid or expired', data: {} });
    }
};

export const requireAdmin = (req, res, next) => {
    if (req.user && (req.user.role?.toUpperCase() === 'ADMIN' || req.user.role?.toUpperCase() === 'SUPERADMIN')) {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Not authorized as an admin' });
    }
};

export const requireHost = (req, res, next) => {
    const role = req.user?.role?.toUpperCase();
    if (role === 'HOST' || role === 'ADMIN' || role === 'SUPERADMIN') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Not authorized: Host access required' });
    }
};

export const requireStaff = (req, res, next) => {
    const role = req.user?.role?.toUpperCase();
    if (role === 'STAFF' || role === 'ADMIN' || role === 'SUPERADMIN' || role === 'HOST') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Not authorized: Staff access required' });
    }
};

export const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        
        const userRole = req.user.role.toLowerCase();
        
        // Admin overrides all generic roles
        if (userRole === 'admin' || userRole === 'superadmin') {
            return next();
        }

        if (roles.map(r => r.toLowerCase()).includes(userRole)) {
            next();
        } else {
            res.status(403).json({ success: false, message: `Not authorized: Resource requires [${roles.join(', ')}] role` });
        }
    };
};
