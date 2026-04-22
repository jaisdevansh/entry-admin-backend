import { User } from '../models/user.model.js';
import { Host } from '../models/Host.js';
import { Admin } from '../models/admin.model.js';

/**
 * Middleware to ensure the user is an ACTIVE host.
 * This is meant to be chained AFTER protect and authorize('host').
 */
export const requireActiveHost = async (req, res, next) => {
    try {
        let user = await Host.findById(req.user.id);
        
        if (!user) {
            user = await User.findById(req.user.id);
        }
        if (!user) {
            user = await Admin.findById(req.user.id);
        }

        if (!user) {
            return res.status(401).json({ success: false, message: 'Host not found' });
        }

        const role = (user.role || '').toUpperCase();
        if (role !== 'HOST' && role !== 'ADMIN' && role !== 'SUPERADMIN') {
            return res.status(403).json({ success: false, message: 'Not authorized as host' });
        }

        // Only enforce ACTIVE status for actual hosts
        if (role === 'HOST' && user.hostStatus !== 'ACTIVE') {
            return res.status(403).json({ 
                success: false, 
                message: 'Your host profile is not active. Please complete KYC verification.',
                hostStatus: user.hostStatus
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};
