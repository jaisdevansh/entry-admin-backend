import { User } from '../models/user.model.js';
import { Host } from '../models/Host.js';
import { Event } from '../models/Event.js';
import { Staff } from '../models/Staff.js';
import { Booking } from '../models/booking.model.js';
import { Admin } from '../models/admin.model.js';
import { cacheService } from '../services/cache.service.js';
import { sendNotification } from '../services/notification.service.js';
import { uploadToCloudinary } from '../config/cloudinary.config.js';

// ── CREATE HOST ─────────────────────────────────────────────────────────────
export const createHost = async (req, res, next) => {
    try {
        const { email, phone, name } = req.body;
        
        const query = {
            $or: [
                ...(email ? [{ email }] : []),
                ...(phone ? [{ phone }] : [])
            ]
        };
        
        if (query.$or.length === 0) {
            return res.status(400).json({ success: false, message: 'Must provide email or phone' });
        }

        const existingInfo = await Host.findOne(query).select('_id').lean();

        if (existingInfo) {
            return res.status(400).json({ 
                success: false, 
                message: 'Host already exists with this email or phone' 
            });
        }

        const newHost = await Host.create({
            name: name || 'New Host',
            email: email || undefined,
            phone: phone || undefined,
            role: 'HOST',
            hostStatus: 'INVITED',
            createdByAdmin: true,
            isVerified: false
        });

        // Invalidate relevant cache patterns
        await cacheService.delete('admin_dashboard_stats');
        // Targeted clean up for hosts
        await cacheService.delete('events_all_guest_v11');

        res.status(201).json({
            success: true,
            data: {
                id: newHost._id,
                name: newHost.name,
                email: newHost.email,
                phone: newHost.phone,
                role: newHost.role,
                hostStatus: newHost.hostStatus
            },
            message: 'Host created successfully. They can now log in via OTP to complete their profile.'
        });

    } catch (error) {
        next(error);
    }
};

// ── GET ALL HOSTS (Admin Management) ─────────────────────────────────────────
export const getHostList = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
        const search = req.query.search || '';
        const status = req.query.status; // Optional filter
        const skip = (page - 1) * limit;

        const query = { role: 'HOST' };
        
        if (search) {
            query.$text = { $search: search };
        }

        if (status) query.hostStatus = status;

        const [hosts, total] = await Promise.all([
            Host.find(query)
                .select('name email hostStatus profileImage createdAt')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 })
                .lean(),
            Host.countDocuments(query)
        ]);

        const responsePayload = {
            success: true,
            count: hosts.length,
            total,
            pages: Math.ceil(total / limit),
            data: hosts
        };

        res.status(200).json(responsePayload);
    } catch (error) {
        next(error);
    }
};

// ── GET HOST DETAILED PROFILE ───────────────────────────────────────────────
export const getHostProfile = async (req, res, next) => {
    try {
        const { id } = req.params;
        const CACHE_KEY = `admin_host_prof_${id}`;
        
        let cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ success: true, data: cached, source: 'cache_hit' });

        // Exclude KYC Documents structurally to stop base64 10MB network bombs
        const host = await Host.findById(id).select('-password -__v -kyc.documents').lean();
        if (!host) return res.status(404).json({ success: false, message: 'Host not found' });
        
        await cacheService.set(CACHE_KEY, host, 120);

        res.status(200).json({ success: true, data: host });
    } catch (error) {
        next(error);
    }
};

// ── GET HOST KYC DOCUMENTS ──────────────────────────────────────────────────
export const getHostKyc = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Exclusively fetch documents for the KYC render mount.
        const host = await Host.findById(id).select('kyc.documents').lean();

        if (!host) return res.status(404).json({ success: false, message: 'Host not found' });

        res.status(200).json({ success: true, data: host.kyc?.documents || [] });
    } catch (error) {
        next(error);
    }
};

// ── GET PENDING HOSTS ───────────────────────────────────────────────────────
export const getPendingHosts = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const skip = (page - 1) * limit;

        const [pendingHosts, count] = await Promise.all([
            Host.find({ hostStatus: 'KYC_PENDING' })
                .select('name email phone kyc profileImage createdAt hostStatus')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 })
                .lean(),
            Host.countDocuments({ hostStatus: 'KYC_PENDING' })
        ]);
        
        const responseData = { 
            success: true, 
            count: pendingHosts.length, 
            total: count,
            pages: Math.ceil(count / limit),
            data: pendingHosts 
        };

        res.status(200).json(responseData);
    } catch (error) {
        next(error);
    }
};

// ── VERIFY HOST (APPROVE OR REJECT) ─────────────────────────────────────────
export const verifyHost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { action, reason } = req.body; // action: 'approve' or 'reject'

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Action must be approve or reject' });
        }

        if (action === 'reject' && !reason) {
            return res.status(400).json({ success: false, message: 'Rejection reason is required' });
        }

        const host = await Host.findById(id);
        
        if (!host || host.role !== 'HOST') {
            return res.status(404).json({ success: false, message: 'Host not found' });
        }

        if (host.hostStatus !== 'KYC_PENDING') {
            return res.status(400).json({ success: false, message: 'Host is not pending KYC approval' });
        }

        if (action === 'approve') {
            host.hostStatus = 'ACTIVE';
            host.isVerified = true;
            host.kycRejectionReason = '';
            
            // Smart Notification
            await sendNotification(host._id, {
                title: 'You are now live 🎉',
                message: 'Your host profile has been verified! You can now create and publish events.',
                type: 'SYSTEM'
            });

        } else if (action === 'reject') {
            host.hostStatus = 'REJECTED';
            host.kycRejectionReason = reason;

            // Smart Notification
            await sendNotification(host._id, {
                title: 'Action Required: Profile Rejected',
                message: `Your profile submission was rejected: ${reason}. Please update your documents.`,
                type: 'SYSTEM' // Using existing system type, can add ALERT if supported
            });
        }

        await host.save();

        // Proactive Cache Invalidation
        await cacheService.delete(`auth_status_${id}`);
        await cacheService.delete('admin_dashboard_stats');
        await cacheService.delete('events_all_guest_v11'); 

        res.status(200).json({
            success: true,
            message: `Host ${action}d successfully.`,
            data: {
                id: host._id,
                hostStatus: host.hostStatus,
                kycRejectionReason: host.kycRejectionReason
            }
        });
    } catch (error) {
        next(error);
    }
};

// ── SUSPEND / BAN HOST ──────────────────────────────────────────────────────
export const suspendHost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const host = await Host.findById(id);
        if (!host || host.role !== 'HOST') {
            return res.status(404).json({ success: false, message: 'Host not found' });
        }

        host.hostStatus = 'SUSPENDED';
        await host.save();

        if (reason) {
            await sendNotification(host._id, {
                title: 'Account Suspended',
                message: `Your host privileges have been suspended: ${reason}`,
                type: 'SYSTEM'
            });
        }

        // Proactive Cache Invalidation
        await cacheService.delete(`auth_status_${id}`);
        await cacheService.delete('events_all_guest_v11');

        res.status(200).json({ success: true, message: 'Host suspended and events paused.' });
    } catch (error) {
        next(error);
    }
};

// ── TOGGLE EVENT FEATURED/TRENDING ──────────────────────────────────────────
export const toggleEventFlags = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const { isFeatured, isTrending } = req.body;

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        if (isFeatured !== undefined) event.isFeatured = isFeatured;
        if (isTrending !== undefined) event.isTrending = isTrending;

        await event.save();
        res.status(200).json({ success: true, data: event });
    } catch (error) {
        next(error);
    }
};

// ── GET ALL STAFF (Admin) ───────────────────────────────────────────────────
export const getAllStaff = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 30;
        const skip = (page - 1) * limit;
        const typeFilter = req.query.type; 
        const hostId = req.query.hostId;

        const CACHE_KEY = `admin_staff_p${page}_t${typeFilter || 'ALL'}_h${hostId || 'ALL'}`;
        const cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ ...cached, source: 'cache_hit' });

        const query = {};
        if (typeFilter) query.staffType = typeFilter;
        if (hostId) query.hostId = hostId; // Strict architecture rule: never mix host data!

        const [staff, total] = await Promise.all([
            Staff.find(query)
                .select('name email phone staffType isActive createdAt hostId')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 })
                .lean(),
            Staff.countDocuments(query)
        ]);

        const response = {
            success: true,
            count: staff.length,
            total,
            pages: Math.ceil(total / limit),
            data: staff
        };

        await cacheService.set(CACHE_KEY, response, 120);

        res.status(200).json(response);
    } catch (error) {
        next(error);
    }
};

// ── GET ALL USERS (Admin) ───────────────────────────────────────────────────
export const getUserList = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const query = search ? { $text: { $search: search } } : {};

        const [users, total] = await Promise.all([
            User.find(query)
                .select('name email phone profileImage isActive role createdAt')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 })
                .lean(),
            User.countDocuments(query)
        ]);

        const response = {
            success: true,
            count: users.length,
            total,
            pages: Math.ceil(total / limit),
            data: users
        };

        // Cache removed: Admin list must always reflect real-time identity state
        res.status(200).json(response);
    } catch (error) {
        next(error);
    }
};

// ── GET USER DETAILED PROFILE (Admin) ───────────────────────────────────────
export const getUserProfile = async (req, res, next) => {
    try {
        const { id } = req.params;
        const CACHE_KEY = `admin_user_prof_${id}`;

        let cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ success: true, data: cached, source: 'cache_hit' });

        const [user, bookings] = await Promise.all([
            User.findById(id).select('-password -__v').lean(),
            Booking.find({ userId: id })
                .select('eventId pricePaid status createdAt')
                .populate('eventId', 'title')
                .sort({ createdAt: -1 })
                .limit(10)
                .lean()
        ]);

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const data = { ...user, bookings };
        await cacheService.set(CACHE_KEY, data, 120);

        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// ── GET ALL BOOKINGS (Admin) ────────────────────────────────────────────────
export const getBookingList = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 30;
        const status = req.query.status; 
        const skip = (page - 1) * limit;

        const query = status ? { status } : {};

        const [bookings, total] = await Promise.all([
            Booking.find(query)
                .select('userId hostId eventId pricePaid guests status createdAt')
                .populate('userId', 'name email profileImage')
                .populate('hostId', 'name profileImage')
                .populate('eventId', 'title')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 })
                .lean(),
            Booking.countDocuments(query)
        ]);

        const response = {
            success: true,
            count: bookings.length,
            total,
            pages: Math.ceil(total / limit),
            data: bookings
        };

        res.status(200).json(response);
    } catch (error) {
        next(error);
    }
};
// ── GET ADMIN DASHBOARD STATS ──────────────────────────────────────────────
export const getAdminStats = async (req, res, next) => {
    try {

        const [userCount, activeHosts, totalHosts, pendingHosts, totalBookings, revenueAgg] = await Promise.all([
            User.countDocuments({ role: 'user' }),
            Host.countDocuments({ role: 'HOST', hostStatus: 'ACTIVE' }),
            Host.countDocuments({ role: 'HOST' }),
            Host.countDocuments({ hostStatus: { $in: ['INVITED', 'KYC_PENDING'] } }),
            Booking.countDocuments({ status: { $in: ['approved', 'active', 'completed'] } }),
            Booking.aggregate([
                { $match: { paymentStatus: 'paid', status: { $ne: 'cancelled' } } },
                { $group: { _id: null, total: { $sum: '$pricePaid' } } }
            ])
        ]);

        const stats = {
            users: userCount,
            activeHosts: activeHosts,
            hosts: totalHosts,
            pendingHosts,
            bookings: totalBookings,
            totalRevenue: revenueAgg[0]?.total || 0,
            updatedAt: new Date()
        };

        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

export const updateAdminProfile = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { name, profileImage } = req.body;

        const updateData = { name };
        if (profileImage && !profileImage.startsWith('data:image')) {
            updateData.profileImage = profileImage;
        }

        const admin = await Admin.findByIdAndUpdate(
            adminId,
            { $set: updateData },
            { new: true, lean: true }
        ).select('name email username role profileImage');

        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });

        if (profileImage && profileImage.startsWith('data:image')) {
            (async () => {
                try {
                    const cloudUrl = await uploadToCloudinary(profileImage, 'admin-profiles');
                    await Admin.findByIdAndUpdate(adminId, { $set: { profileImage: cloudUrl } });
                    console.log(`[ADMIN BG] Profile image synchronized for: ${adminId}`);
                } catch (err) {
                    console.error('[ADMIN BG ERROR] Background sync failed:', err.message);
                }
            })();
        }

        res.status(200).json({
            success: true,
            data: { ...admin, profileImage: profileImage || admin.profileImage },
            message: 'Admin profile updated (processing assets in background)'
        });
    } catch (error) {
        next(error);
    }
};
export const toggleUserStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.isActive = isActive;
        await user.save();

        // Proactive Cache Clearance for consistency
        await cacheService.delete(`auth_status_${id}`);
        await cacheService.delete(`admin_user_prof_${id}`);
        await cacheService.delete('admin_dashboard_stats');

        res.status(200).json({ 
            success: true, 
            message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
            data: { id: user._id, isActive: user.isActive }
        });
    } catch (error) {
        next(error);
    }
};
export const deleteHost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const host = await Host.findByIdAndDelete(id);
        if (!host) return res.status(404).json({ success: false, message: 'Host not found' });

        // Cleanup: remove all events from this host
        await Event.deleteMany({ hostId: id });

        await cacheService.delete('events_all_guest_v11');
        await cacheService.delete('admin_dashboard_stats');
        res.status(200).json({ success: true, message: 'Host and associated events purged from registry' });
    } catch (error) {
        next(error);
    }
};

export const toggleHostRegistryStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'ACTIVE' or 'SUSPENDED'

        const host = await Host.findById(id);
        if (!host) return res.status(404).json({ success: false, message: 'Host not found' });

        host.hostStatus = status;
        await host.save();

        if (status === 'SUSPENDED') {
            await Event.updateMany({ hostId: id, status: 'LIVE' }, { status: 'PAUSED' });
        }

        await cacheService.delete(`auth_status_${id}`);
        await cacheService.delete('events_all_guest_v11');
        res.status(200).json({ success: true, message: `Host status updated to ${status}` });
    } catch (error) {
        next(error);
    }
};

// ── PERMANENT USER PURGE ────────────────────────────────────────────────────
export const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const user = await User.findByIdAndDelete(id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found in registry' });

        // Cleanup: remove all bookings associated with this user
        await Booking.deleteMany({ userId: id });
        
        // Fleet-wide cache invalidation
        await cacheService.delete(`admin_user_prof_${id}`);
        await cacheService.delete('admin_dashboard_stats');

        res.status(200).json({ 
            success: true, 
            message: 'User identity permanently purged from fleet registry' 
        });
    } catch (error) {
        next(error);
    }
};
