import { User } from '../models/user.model.js';
import { Host } from '../models/Host.js';
import { Venue } from '../models/Venue.js';
import { Booking } from '../models/booking.model.js';
import { Payout } from '../models/Payout.js';
import { Media } from '../models/Media.js';
import { Coupon } from '../models/Coupon.js';
import { Waitlist } from '../models/Waitlist.js';
import { Staff } from '../models/Staff.js';
import { MenuItem } from '../models/MenuItem.js';
import { uploadToCloudinary } from '../config/cloudinary.config.js';
import { FoodOrder } from '../models/FoodOrder.js';
import { IncidentReport } from '../models/IncidentReport.js';
import { Review } from '../models/Review.js';
import { Gift } from '../models/Gift.js';
import { cacheService } from '../services/cache.service.js';

// Cache TTL constants
const TTL = { profile: 300, dashboard: 120, list: 180, payments: 300 };
const ckey = (type, hostId) => `host:${type}:${hostId}`;

// --- HOST ACCOUNT PROFILE ---
export const getHostProfile = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const CACHE_KEY = ckey('profile', hostId);
        
        // ⚡ CRITICAL: Check for fresh data flag (set by admin approval)
        const forceRefresh = req.query.refresh === 'true';
        
        if (!forceRefresh) {
            const cached = await cacheService.get(CACHE_KEY);
            if (cached) {
                console.log('[getHostProfile] Returning cached data:', cached.hostStatus);
                return res.status(200).json({ success: true, data: cached });
            }
        }

        console.log('[getHostProfile] Fetching fresh data from DB for host:', hostId);

        // ⚡ OPTIMIZED: Parallel queries with lean() for faster performance
        let [hostUser, venue] = await Promise.all([
            Host.findById(hostId).select('-password -refreshToken').lean(),
            Venue.findOne({ hostId }).select('name address venueType _id').lean()
        ]);

        if (!hostUser) {
            const legacyUser = await User.findById(hostId).lean();
            if (legacyUser && ['host', 'HOST', 'superadmin', 'admin'].includes(legacyUser.role)) {
                const newHost = await Host.create({
                    _id: legacyUser._id, name: legacyUser.name || 'Migrated Host',
                    username: legacyUser.username || `host_${legacyUser._id.toString().slice(-5)}`,
                    email: legacyUser.email, phone: legacyUser.phone,
                    role: 'HOST', hostStatus: legacyUser.onboardingCompleted ? 'ACTIVE' : 'CREATED', isActive: true,
                });
                hostUser = newHost.toObject();
            }
        }

        if (!hostUser) return res.status(404).json({ success: false, message: 'Host not found' });

        const profileData = {
            name: hostUser.name || 'Anonymous Host',
            username: hostUser.username || '',
            profileImage: hostUser.profileImage || '',
            bio: '',
            brandName: venue?.name || '',
            location: hostUser.location?.address || venue?.address || '',
            hostType: venue?.venueType?.toLowerCase() || 'club',
            contactNumber: hostUser.phone || '',
            email: hostUser.email || '',
            instagram: '', website: '',
            venueId: venue?._id,
            hostStatus: hostUser.hostStatus || 'CREATED'
        };

        console.log('[getHostProfile] Fresh data from DB. hostStatus:', profileData.hostStatus);

        await cacheService.set(CACHE_KEY, profileData, 300); // 5 min cache
        res.status(200).json({ success: true, data: profileData });
    } catch (error) { next(error); }
};

export const updateHostProfile = async (req, res, next) => {
    try {
        const { name, username, profileImage, bio, brandName, location, hostType, contactNumber, email, instagram, website } = req.body;
        const hostId = req.user.id;

        if (username) {
            const usernameLower = username.toLowerCase().trim();
            const existing = await Host.findOne({ username: usernameLower, _id: { $ne: hostId } }).select('_id').lean();
            if (existing) return res.status(400).json({ success: false, message: 'Username is already taken' });
        }

        const updatePayload = {};
        if (name !== undefined) updatePayload.name = name;
        if (username !== undefined) updatePayload.username = username.toLowerCase().trim();
        if (location !== undefined) updatePayload['location.address'] = location;
        if (contactNumber !== undefined) updatePayload.phone = contactNumber;
        if (email !== undefined) updatePayload.email = email;

        let finalProfileImage = profileImage;
        if (finalProfileImage && (finalProfileImage.startsWith('data:image') || finalProfileImage.startsWith('file://'))) {
            try {
                finalProfileImage = await uploadToCloudinary(finalProfileImage, 'entry-club/hosts');
            } catch (e) { /* keep original */ }
        }
        if (finalProfileImage !== undefined) updatePayload.profileImage = finalProfileImage;

        const hostUser = await Host.findByIdAndUpdate(hostId, { $set: updatePayload }, { new: true }).select('name username profileImage').lean();
        if (!hostUser) return res.status(404).json({ success: false, message: 'Host not found' });

        // Bust profile cache so next read is fresh
        await cacheService.delete(ckey('profile', hostId));

        res.status(200).json({ success: true, message: 'Profile updated successfully', data: hostUser });
    } catch (error) {
        if (error.name === 'ValidationError') console.error('[HostController] updateProfile Errors:', error.errors);
        next(error);
    }
};

export const completeProfile = async (req, res, next) => {
    try {
        const { aadhaarUrl, panUrl, profileImage, name, dob, location } = req.body;
        const hostId = req.user.id;

        console.log('[completeProfile] Starting for host:', hostId);

        const host = await Host.findById(hostId);
        if (!host) {
            return res.status(404).json({ success: false, message: 'Host not found' });
        }

        console.log('[completeProfile] Current host status:', host.hostStatus);

        if (host.hostStatus !== 'INVITED' && host.hostStatus !== 'CREATED') {
            return res.status(403).json({ success: false, message: 'Onboarding is only available for invited hosts.' });
        }

        if (host.kycSubmitted) {
            return res.status(400).json({ success: false, message: 'KYC documents already submitted for review.' });
        }

        // ⚡ SYNCHRONOUS: Upload and save BEFORE sending response
        console.log('[completeProfile] Starting synchronous uploads...');
        
        // Parallelizing Cloudinary Uploads for Performance
        const uploadTask = async (data, folder) => {
            if (data && data.startsWith('data:')) {
                return await uploadToCloudinary(data, folder);
            }
            return data;
        };

        const [finalProfileImage, finalAadhaar, finalPan] = await Promise.all([
            uploadTask(profileImage, 'host-profiles'),
            uploadTask(aadhaarUrl, 'host-kyc'),
            uploadTask(panUrl, 'host-kyc')
        ]);

        console.log('[completeProfile] Uploads complete. Updating database...');

        // Update Host Fields
        if (name) host.name = name;
        if (dob) host.dateOfBirth = dob;
        if (location) {
            host.location = host.location || {};
            host.location.address = location;
        }
        if (finalProfileImage) host.profileImage = finalProfileImage;

        // kycDocs logic
        const kycDocs = [];
        if (finalAadhaar) kycDocs.push({ type: 'AADHAR', url: finalAadhaar, status: 'PENDING', uploadedAt: new Date() });
        if (finalPan) kycDocs.push({ type: 'PAN', url: finalPan, status: 'PENDING', uploadedAt: new Date() });
        
        if (kycDocs.length > 0) {
            host.kyc = host.kyc || {};
            host.kyc.documents = kycDocs;
            host.markModified('kyc');
            host.markModified('kyc.documents');
        }

        host.profileCompletion = 100;
        host.hostStatus = 'KYC_PENDING';
        host.kycSubmitted = true;

        console.log('[completeProfile] Saving to database...');
        await host.save();
        console.log('[completeProfile] ✅ Database saved. New status:', host.hostStatus);
        
        // ⚡ CLEAR PROFILE CACHE after save
        console.log('[completeProfile] Clearing cache after save...');
        await cacheService.delete(ckey('profile', hostId));
        await cacheService.delete(`auth_status_${hostId}`);
        await cacheService.delete(`host_profile_${hostId}`);
        await cacheService.delete(`hostProfile_${hostId}`);
        console.log('[completeProfile] ✅ Cache cleared.');
        
        // ⚡ AUTO-CREATE VENUE PROFILE from onboarding data
        const existingVenue = await Venue.findOne({ hostId: host._id });
        if (!existingVenue) {
            await Venue.create({
                hostId: host._id,
                name: name || 'My Venue',
                venueType: 'Nightclub',
                address: location || '',
                description: '',
                capacity: 0,
                openingTime: '10:00 PM',
                closingTime: '04:00 AM',
                rules: 'Strictly Elegant',
                heroImage: '',
                images: [],
                amenities: []
            });
            console.log(`[completeProfile] Auto-created venue profile for Host: ${host._id}`);
        }

        // ✅ Send response AFTER everything is saved
        res.status(200).json({
            success: true,
            message: 'Profile submitted for review successfully!',
            data: {
                id: host._id,
                hostStatus: host.hostStatus,
                profileCompletion: 100
            }
        });

        console.log('[completeProfile] ✅ Complete. Response sent.');

    } catch (error) {
        console.error('[completeProfile] ❌ Error:', error);
        next(error);
    }
};

// --- VENUE MANAGEMENT ---
export const getVenueProfile = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const CACHE_KEY = ckey('venue', hostId);
        const cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const venue = await Venue.findOne({ hostId }).lean();
        if (!venue) {
            return res.status(200).json({ success: true, data: {
                name: '', venueType: 'Nightclub', description: '', address: '',
                capacity: 0, openingTime: '10:00 PM', closingTime: '04:00 AM',
                rules: 'Strictly Elegant', heroImage: '', images: [], amenities: []
            }});
        }
        await cacheService.set(CACHE_KEY, venue, TTL.profile);
        res.status(200).json({ success: true, data: venue });
    } catch (error) { next(error); }
};

export const updateVenueProfile = async (req, res, next) => {
    try {
        console.log(`[updateVenueProfile] Updating venue for hostID: ${req.user.id}`);
        const {
            name,
            venueType,
            description,
            address,
            capacity,
            openingTime,
            closingTime,
            rules,
            heroImage,
            images,
            amenities,
            menu,
            coordinates
        } = req.body;

        // Build a clean update object — only include fields that were explicitly sent
        // so that a partial save (e.g. editing description) never wipes out coordinates or heroImage
        const raw = {
            name,
            venueType,
            description,
            address,
            capacity: capacity !== undefined ? (parseInt(capacity) || 0) : undefined,
            openingTime,
            closingTime,
            rules,
            heroImage,
            images,
            amenities,
            menu,
            coordinates,
            hostId: req.user.id
        };

        // Remove undefined keys so $set only touches the fields we received
        const updateObj = Object.fromEntries(
            Object.entries(raw).filter(([, v]) => v !== undefined && v !== null || typeof v === 'number')
        );

        console.log(`[updateVenueProfile] Update object:`, JSON.stringify({ ...updateObj, heroImage: updateObj.heroImage ? 'TRUNCATED' : null }, null, 2));

        console.log(`[updateVenueProfile] Received update for host: ${req.user.id}`);
        const venue = await Venue.findOneAndUpdate(
            { hostId: req.user.id },
            { $set: updateObj },
            { new: true, upsert: true, runValidators: true }
        );
        console.log(`[updateVenueProfile] DB update successful for venue: ${venue._id}`);

        // --- BACKGROUND MENU IMAGE ORCHESTRATION ---
        if (menu && Array.isArray(menu)) {
            (async () => {
                try {
                    let changed = false;
                    const finalMenu = await Promise.all(menu.map(async (item) => {
                        if (item.image && (item.image.startsWith('data:image') || item.image.startsWith('file:'))) {
                            try {
                                const { uploadToCloudinary } = await import('../config/cloudinary.config.js');
                                const cloudUrl = await uploadToCloudinary(item.image, 'venue-menu');
                                changed = true;
                                return { ...item, image: cloudUrl };
                            } catch (e) {
                                console.error('[SYS BKG] Venue menu item upload failed:', item.name, e.message);
                                return item;
                            }
                        }
                        return item;
                    }));

                    if (changed) {
                        await Venue.findByIdAndUpdate(venue._id, { menu: finalMenu });
                        console.log(`[SYS] Background menu images processed for venue: ${venue._id}`);
                    }
                } catch (bgErr) {
                    console.error('[SYS CATCH] Background menu processing critical failure:', bgErr.message);
                }
            })();
        }

        // Notify Real-Time Clients...
        import('../socket.js').then(({ getIO }) => {
            const io = getIO();
            if (io) {
                console.log(`[updateVenueProfile] Emitting venue_updated for host: ${req.user.id}`);
                // Broadcast that this host's venue changed (affects coordinates/address in event details)
                io.emit('venue_updated', { hostId: req.user.id, venueId: venue._id });
                // Also legacy menu_updated for drinks
                io.emit('menu_updated', { hostId: req.user.id, venueId: venue._id });
            }
        }).catch(err => console.log('Socket Notify Error:', err.message));

        // Bust venue + profile caches so next reads are fresh
        await Promise.all([
            cacheService.delete(ckey('venue', req.user.id)),
            cacheService.delete(ckey('profile', req.user.id)),
        ]);

        res.status(200).json({ success: true, message: 'Venue profile updated successfully', data: venue });
    } catch (error) {
        next(error);
    }
};

// --- PAYMENTS & PAYOUTS ---
export const getPayments = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const CACHE_KEY = ckey('payments', hostId);
        const cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const bookings = await Booking.find({ hostId })
            .populate('userId', 'name profileImage')
            .sort({ createdAt: -1 })
            .select('userId ticketType pricePaid paymentStatus createdAt')
            .lean();

        const data = bookings.map(b => ({
            id: b._id, memberName: b.userId?.name || 'Unknown',
            memberImage: b.userId?.profileImage || '',
            plan: b.ticketType || 'Standard', amount: b.pricePaid || 0,
            status: b.paymentStatus === 'paid' ? 'Success' : 'Pending',
            date: b.createdAt
        }));
        await cacheService.set(CACHE_KEY, data, TTL.payments);
        res.status(200).json({ success: true, data });
    } catch (error) { next(error); }
};

export const getPayouts = async (req, res, next) => {
    try {
        const [payouts, earningsAgg] = await Promise.all([
            Payout.find({ hostId: req.user.id }).sort({ date: -1 }).lean(),
            Booking.aggregate([
                { $match: { hostId: req.user.id, paymentStatus: 'paid' } },
                { $group: { _id: null, totalEarnings: { $sum: "$pricePaid" } } }
            ])
        ]);

        const totalEarnings = earningsAgg[0] ? earningsAgg[0].totalEarnings : 0;

        const completedPayouts = payouts
            .filter(p => p.status === 'Success')
            .reduce((sum, p) => sum + p.amount, 0);

        const pendingPayouts = totalEarnings - completedPayouts;

        res.status(200).json({
            success: true,
            data: {
                history: payouts,
                summary: {
                    totalEarnings,
                    pendingPayout: Math.max(0, pendingPayouts),
                    completedPayout: completedPayouts
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// ── STAFF (Staff Collection) ──────────────────────────────────────────
export const getStaff = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const CACHE_KEY = ckey('staff', hostId);
        const cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const staff = await Staff.find({ hostId })
            .select('-password -refreshToken')
            .sort({ createdAt: -1 })
            .lean();
        const data = staff.map(s => ({ ...s, fullName: s.name }));
        await cacheService.set(CACHE_KEY, data, TTL.list);
        res.status(200).json({ success: true, data });
    } catch (error) { next(error); }
};

export const addStaff = async (req, res, next) => {
    try {
        const {
            fullName, firstName, lastName, username, email, phone, staffType, password, isActive
        } = req.body;

        if (!fullName || !staffType || (!phone && !email)) {
            return res.status(400).json({ success: false, message: 'Full name, staff type, and at least one contact (phone or email) are required' });
        }

        const VALID_TYPES = ['WAITER', 'SECURITY', 'MANAGER'];
        if (!VALID_TYPES.includes(staffType)) {
            return res.status(400).json({ success: false, message: `Invalid staffType. Must be one of: ${VALID_TYPES.join(', ')}` });
        }

        // Check for duplicate within this host's staff
        const orQuery = [];
        if (phone) orQuery.push({ phone, hostId: req.user.id });
        if (email) orQuery.push({ email: email.toLowerCase(), hostId: req.user.id });
        if (username) orQuery.push({ username: username.toLowerCase() }); // global unique username

        const existing = await Staff.findOne({ $or: orQuery }).select('_id').lean();
        if (existing) {
            return res.status(400).json({ success: false, message: 'A staff member with this phone/email/username already exists' });
        }

        const staffData = {
            hostId: req.user.id,
            name: fullName,
            username: username?.toLowerCase() || undefined,
            phone: phone || undefined,
            email: email?.toLowerCase() || undefined,
            role: 'STAFF',
            staffType,
            password: password || undefined,
            isActive: isActive !== undefined ? isActive : true,
            emailVerified: false
        };

        const staff = await Staff.create(staffData);
        // Bust staff cache
        await cacheService.delete(ckey('staff', req.user.id));
        const { password: _, refreshToken: __, name: staffName, ...safeStaff } = staff.toObject();
        res.status(201).json({ success: true, data: { ...safeStaff, fullName: staffName }, message: `${staffType} added successfully` });
    } catch (error) { next(error); }
};

export const removeStaff = async (req, res, next) => {
    try {
        const { staffId } = req.params;

        const result = await Staff.findOneAndDelete({ _id: staffId, hostId: req.user.id });
        if (!result) return res.status(404).json({ success: false, message: 'Staff member not found' });
        await cacheService.delete(ckey('staff', req.user.id));
        res.status(200).json({ success: true, message: 'Staff member removed successfully' });
    } catch (error) { next(error); }
};

export const updateStaff = async (req, res, next) => {
    try {
        const { staffId } = req.params;
        const {
            fullName, username, email, phone, staffType, password, isActive
        } = req.body;

        const updateData = {};
        if (fullName !== undefined) updateData.name = fullName;
        if (username !== undefined) updateData.username = username.toLowerCase();
        if (email !== undefined) updateData.email = email.toLowerCase();
        if (phone !== undefined) updateData.phone = phone;
        if (staffType !== undefined) updateData.staffType = staffType;
        if (isActive !== undefined) updateData.isActive = isActive;

        // Re-hash password if changed
        if (password) {
            const bcrypt = await import('bcryptjs');
            updateData.password = await bcrypt.default.hash(password, 10);
        }

        const staff = await Staff.findOneAndUpdate(
            { _id: staffId, hostId: req.user.id },
            { $set: updateData },
            { new: true }
        ).select('-password -refreshToken').lean();
        if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found' });
        await cacheService.delete(ckey('staff', req.user.id));
        staff.fullName = staff.name;
        res.status(200).json({ success: true, data: staff });
    } catch (error) { next(error); }
};

export const getWaitlist = async (req, res, next) => {
    try {
        const waitlist = await Waitlist.find({ hostId: req.user.id })
            .populate('userId', 'name profileImage')
            .sort({ isPriority: -1, createdAt: 1 })
            .lean();
        
        res.status(200).json({ success: true, data: waitlist });
    } catch (error) {
        next(error);
    }
};

export const processWaitlist = async (req, res, next) => {
    try {
        const { waitlistId } = req.params;
        const { action } = req.body; // 'approved' or 'rejected'
        const entry = await Waitlist.findOneAndUpdate(
            { _id: waitlistId, hostId: req.user.id },
            { status: action },
            { new: true }
        );
        res.status(200).json({ success: true, data: entry });
    } catch (error) {
        next(error);
    }
};

// --- SECURITY & INSIGHTS ---
export const getIncidents = async (req, res, next) => {
    try {
        // High-speed resolution: find the venue managed by this host first
        const venue = await Venue.findOne({ hostId: req.user.id }).select('_id').lean();
        if (!venue) return res.status(200).json({ success: true, data: [] });

        const incidents = await IncidentReport.find({ venueId: venue._id })
            .populate('userId', 'name profileImage')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({ success: true, data: incidents });
    } catch (error) {
        next(error);
    }
};

export const resolveIncident = async (req, res, next) => {
    try {
        const { incidentId } = req.params;
        const incident = await IncidentReport.findByIdAndUpdate(incidentId, { status: 'resolved' }, { new: true });
        res.status(200).json({ success: true, data: incident });
    } catch (error) {
        next(error);
    }
};

export const deleteIncident = async (req, res, next) => {
    try {
        const { incidentId } = req.params;
        await IncidentReport.findByIdAndDelete(incidentId);
        res.status(200).json({ success: true, message: 'Incident deleted successfully' });
    } catch (error) {
        next(error);
    }
};

export const submitReview = async (req, res, next) => {
    try {
        const { eventId, hostId, vibe, service, music, feedback, isAnonymous } = req.body;

        // Convert to numbers and validate
        const vibeNum    = Math.min(5, Math.max(1, Number(vibe)   || 1));
        const serviceNum = Math.min(5, Math.max(1, Number(service) || 1));
        const musicNum   = Math.min(5, Math.max(1, Number(music)  || 1));

        const avgScore = parseFloat(((vibeNum + serviceNum + musicNum) / 3).toFixed(1));

        // If eventId provided, try to find a booking (any status)
        let resolvedHostId = hostId;
        if (eventId && !resolvedHostId) {
            const booking = await Booking.findOne({ userId: req.user.id, eventId })
                .select('hostId').lean();
            if (booking?.hostId) resolvedHostId = booking.hostId;
        }

        // Build query — if no eventId, use userId alone (guest review without event link)
        const matchQuery = eventId
            ? { userId: req.user.id, eventId }
            : { userId: req.user.id, createdAt: { $gte: new Date(Date.now() - 60000) } };

        const reviewData = {
            userId: req.user.id,
            ...(eventId && { eventId }),
            ...(resolvedHostId && { hostId: resolvedHostId }),
            scores: { vibe: vibeNum, service: serviceNum, music: musicNum },
            avgScore,
            feedback: feedback || '',
            isAnonymous: isAnonymous || false,
        };

        console.log(`[submitReview] Saving review for user: ${req.user.id}`, reviewData);

        const review = await Review.findOneAndUpdate(
            eventId ? { userId: req.user.id, eventId } : { _id: new (await import('mongoose')).default.Types.ObjectId() },
            reviewData,
            { upsert: true, new: true, runValidators: false }
        );

        console.log(`[submitReview] ✅ Saved to DB: ${review._id}`);
        res.status(201).json({ success: true, data: review, message: 'Review posted successfully!' });
    } catch (error) {
        console.error('[submitReview] Error:', error.message);
        next(error);
    }
};

export const getReviews = async (req, res, next) => {
    try {
        const reviews = await Review.find({ hostId: req.user.id })
            .populate('userId', 'name profileImage')
            .sort({ createdAt: -1 })
            .lean();
        res.status(200).json({ success: true, data: reviews });
    } catch (error) {
        next(error);
    }
};

// --- MEDIA MANAGEMENT ---
export const getMedia = async (req, res, next) => {
    try {
        const media = await Media.find({ hostId: req.user.id }).sort({ createdAt: -1 }).lean();
        res.status(200).json({ success: true, data: media });
    } catch (error) {
        next(error);
    }
};

export const uploadMedia = async (req, res, next) => {
    try {
        const { url, type, fileName, fileSize, mimeType } = req.body;
        const media = await Media.create({
            hostId: req.user.id,
            url,
            type: type || 'image',
            status: 'Pending', // Back to pending until saved
            fileName,
            fileSize,
            mimeType
        });
        res.status(201).json({ success: true, data: media, message: 'Media uploaded for approval' });
    } catch (error) {
        next(error);
    }
};

export const removeMedia = async (req, res, next) => {
    try {
        const { mediaId } = req.params;
        await Media.findOneAndDelete({ _id: mediaId, hostId: req.user.id });
        res.status(200).json({ success: true, message: 'Media removed successfully' });
    } catch (error) {
        next(error);
    }
};

// --- MENU MANAGEMENT (Specialized Unified DB) ---
export const getMenuItems = async (req, res, next) => {
    try {
        console.log(`[getMenuItems] Fetching menu for host: ${req.user.id}`);
        const items = await MenuItem.find({ hostId: req.user.id }).sort({ category: 1, name: 1 }).lean();
        res.status(200).json({ success: true, data: items || [] });
    } catch (error) {
        next(error);
    }
};

export const addMenuItem = async (req, res, next) => {
    try {
        const { name, price, category, desc, image, inStock } = req.body;
        
        // Find Venue ID for this Host
        const venue = await Venue.findOne({ hostId: req.user.id }).select('_id').lean();
        
        const item = await MenuItem.create({
            hostId: req.user.id,
            venueId: venue ? venue._id : undefined,
            name,
            price: parseFloat(price) || 0,
            category,
            desc,
            image,
            inStock: inStock !== undefined ? inStock : true
        });
        
        res.status(201).json({ success: true, data: item, message: 'Menu item created successfully' });
    } catch (error) {
        next(error);
    }
};

export const updateMenuItem = async (req, res, next) => {
    try {
        const { itemId } = req.params;
        const updates = req.body;
        
        if (updates.price) updates.price = parseFloat(updates.price) || 0;
        
        const item = await MenuItem.findOneAndUpdate(
            { _id: itemId, hostId: req.user.id },
            { $set: updates },
            { new: true, runValidators: true }
        ).lean();
        
        if (!item) return res.status(404).json({ success: false, message: 'Menu item not found' });
        
        res.status(200).json({ success: true, data: item, message: 'Menu item updated' });
    } catch (error) {
        next(error);
    }
};

export const removeMenuItem = async (req, res, next) => {
    try {
        const { itemId } = req.params;
        const result = await MenuItem.findOneAndDelete({ _id: itemId, hostId: req.user.id });
        
        if (!result) return res.status(404).json({ success: false, message: 'Menu item not found' });
        res.status(200).json({ success: true, message: 'Menu item removed successfully' });
    } catch (error) {
        next(error);
    }
};

// --- COUPON MANAGEMENT (High Precision Orchestration) ---
export const getCoupons = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const CACHE_KEY = ckey('coupons', hostId);
        const cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const coupons = await Coupon.find({
            $or: [{ hostId }, { hostId: { $exists: false } }, { hostId: null }]
        }).sort({ createdAt: -1 }).lean();
        await cacheService.set(CACHE_KEY, coupons, TTL.list);
        res.status(200).json({ success: true, data: coupons });
    } catch (error) { next(error); }
};

export const createCoupon = async (req, res, next) => {
    try {
        const { code, discountType, discountValue, minPurchase, expiryDate, usageLimit, title, pointsCost, applicableOn } = req.body;
        
        if (!code || !discountValue) {
            return res.status(400).json({ success: false, message: 'code and discountValue are required' });
        }

        // Ensure 'title' is never missing to satisfy strict Schema constraints 
        const atomicTitle = title || `PROMO: ${code.toUpperCase()}`;
        
        const coupon = await Coupon.create({
            hostId: req.user.id, title: atomicTitle,
            code: code.trim().toUpperCase(), discountType: discountType || 'percentage',
            discountValue: Number(discountValue), minPurchase: Number(minPurchase) || 0,
            expiryDate: expiryDate || null, usageLimit: Number(usageLimit) || 100,
            pointsCost: Math.max(0, parseInt(pointsCost) || 0),
            applicableOn: applicableOn || 'all', isActive: true,
        });
        await cacheService.delete(ckey('coupons', req.user.id));
        res.status(201).json({ success: true, data: coupon, message: 'Coupon created successfully' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message || 'Failed to create coupon' });
    }
};

export const removeCoupon = async (req, res, next) => {
    try {
        const { couponId } = req.params;
        await Coupon.findOneAndDelete({ _id: couponId, hostId: req.user.id });
        await cacheService.delete(ckey('coupons', req.user.id));
        res.status(200).json({ success: true, message: 'Coupon removed successfully' });
    } catch (error) { next(error); }
};

export const approveMedia = async (req, res, next) => {
    try {
        await Media.updateMany(
            { hostId: req.user.id, status: 'Pending' },
            { status: 'Approved' }
        );
        res.status(200).json({ success: true, message: 'Gallery confirmed successfully' });
    } catch (error) {
        next(error);
    }
};

export const getDashboardStats = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const CACHE_KEY = ckey('dashboard', hostId);
        const cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const [bookingStats, eventStats] = await Promise.all([
            Booking.aggregate([
                { $match: { hostId, paymentStatus: 'paid' } },
                { $group: { _id: null, totalRevenue: { $sum: '$pricePaid' }, ticketsSold: { $sum: 1 } } }
            ]),
            Event.aggregate([
                { $match: { hostId } },
                { $group: { _id: null, totalViews: { $sum: '$views' },
                    liveEventsCount: { $sum: { $cond: [{ $eq: ['$status', 'LIVE'] }, 1, 0] } },
                    draftEventsCount: { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } } }}
            ])
        ]);

        const bData = bookingStats[0] || { totalRevenue: 0, ticketsSold: 0 };
        const eData = eventStats[0] || { totalViews: 0, liveEventsCount: 0, draftEventsCount: 0 };
        const data = { totalRevenue: bData.totalRevenue, ticketsSold: bData.ticketsSold,
            totalViews: eData.totalViews, activeEvents: eData.liveEventsCount, draftEvents: eData.draftEventsCount };

        await cacheService.set(CACHE_KEY, data, TTL.dashboard);
        res.status(200).json({ success: true, data });
    } catch (error) { next(error); }
};

// --- ORDERS (Food/Drink) ---
export const getOrders = async (req, res, next) => {
    try {
        // FoodOrder already has hostId — query directly, no join needed
        const orders = await FoodOrder.find({ hostId: req.user.id })
            .populate('userId', 'name phone profileImage')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        next(error);
    }
};

export const updateOrderStatus = async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;

        const validStatuses = ['confirmed', 'accepted', 'preparing', 'out_for_delivery', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid order status' });
        }

        const order = await FoodOrder.findByIdAndUpdate(
            orderId,
            { status },
            { new: true }
        );

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        res.status(200).json({ success: true, data: order, message: `Order status updated to ${status}` });
    } catch (error) {
        next(error);
    }
};

// ─── GIFTS (Standalone DB – fast indexed lookups) ────────────────────────────
export const getHostGifts = async (req, res, next) => {
    try {
        const gifts = await Gift.findForHost(req.user.id);
        res.status(200).json({ success: true, data: gifts });
    } catch (error) {
        next(error);
    }
};

export const createHostGift = async (req, res, next) => {
    try {
        const { name, description, price, category, image, inStock } = req.body;
        if (!name || price === undefined || !category) {
            return res.status(400).json({ success: false, message: 'name, price, and category are required' });
        }

        // --- STAGE 1: IMMEDIATE PERSISTENCE (Sub-50ms) ---
        // Create the gift record with a temporary image or placeholder
        const gift = await Gift.create({
            hostId: req.user.id,
            name,
            description,
            price: Number(price),
            category,
            image: (image && image.startsWith('http')) ? image : '', // Placeholder if it's base64/file
            inStock: inStock !== false
        });

        // --- STAGE 2: INSTANT RESPONSE ---
        res.status(201).json({ 
            success: true, 
            data: gift, 
            message: 'Gift added successfully. Processing media in background...' 
        });

        // --- STAGE 3: BACKGROUND ASYNC ASSET ORCHESTRATION ---
        if (image && (image.startsWith('data:') || image.startsWith('file:'))) {
            (async () => {
                try {
                    const finalUrl = await uploadToCloudinary(image, 'host-gifts');
                    await Gift.findByIdAndUpdate(gift._id, { image: finalUrl });
                    console.log(`[SYS] Background Gift Image processed: ${gift._id}`);
                } catch (e) {
                    console.error(`[SYS ERR] Background Gift Image failed: ${gift._id}`, e.message);
                }
            })();
        }
    } catch (error) {
        next(error);
    }
};

export const updateHostGift = async (req, res, next) => {
    try {
        const { giftId } = req.params;
        const { name, description, price, category, image, inStock } = req.body;
        const gift = await Gift.findOneAndUpdate(
            { _id: giftId, hostId: req.user.id },   // ownership check
            { name, description, price: price !== undefined ? Number(price) : undefined, category, image, inStock },
            { new: true, runValidators: true }
        );
        if (!gift) return res.status(404).json({ success: false, message: 'Gift not found' });
        res.status(200).json({ success: true, data: gift });
    } catch (error) {
        next(error);
    }
};

export const removeHostGift = async (req, res, next) => {
    try {
        const { giftId } = req.params;
        // Soft-delete — preserves audit trail, never destroys data
        const deleted = await Gift.softDelete(giftId, req.user.id);
        if (!deleted) return res.status(404).json({ success: false, message: 'Gift not found' });
        res.status(200).json({ success: true, message: 'Gift removed' });
    } catch (error) {
        next(error);
    }
};

// --- GUEST INTERACTION: INCIDENT REPORTING ---
export const submitIncidentReport = async (req, res, next) => {
    try {
        const { title, category, description, location, images, isAnonymous, venueId } = req.body;
        
        // ⚡ ASYNC ORCHESTRATION: Parallelize Cloudinary & DB Lookup
        const [uploadedUrls, resolvedVenueId] = await Promise.all([
            (async () => {
                if (!images || images.length === 0) return [];
                try {
                    const { uploadToCloudinary } = await import('../config/cloudinary.config.js');
                    return await Promise.all(images.map(img => uploadToCloudinary(img, 'entry-club/incidents')));
                } catch (ce) { console.error('[Cloudinary] Incident Upload Fail:', ce.message); return []; }
            })(),
            (async () => {
                if (venueId) return venueId;
                // Auto-resolve: Find where the user is currently checked-in
                const booking = await Booking.findOne({ 
                    userId: req.user.id, 
                    status: { $in: ['active', 'checked_in', 'approved'] } 
                }).select('hostId').lean();
                if (!booking) return null;
                const v = await Venue.findOne({ hostId: booking.hostId }).select('_id').lean();
                return v?._id;
            })()
        ]);

        const report = await IncidentReport.create({
            userId: req.user.id,
            venueId: resolvedVenueId,
            title,
            category,
            description,
            location: location || 'Venue Area',
            images: uploadedUrls,
            isAnonymous: isAnonymous || false,
            status: 'pending'
        });

        // Background Side-Effects (Non-blocking Sync)
        (async () => {
             const { getIO } = await import('../socket.js');
             const io = getIO();
             if (io) {
                const populated = await IncidentReport.findById(report._id).populate('userId', 'name profileImage').lean();
                if (report.isAnonymous && populated.userId) populated.userId = null;
                
                if (resolvedVenueId) io.to(resolvedVenueId.toString()).emit('new_incident', populated);
                io.emit('new_incident', populated); 
            }

            if (category === 'Technical Bug') {
                const devUser = await User.findOne({ username: 'devanshjais20' }).select('_id').lean();
                if (devUser) {
                    const { notificationService } = await import('../services/notification.service.js');
                    notificationService.sendToUser(
                        devUser._id,
                        'Critical: Technical Bug Reported',
                        `New bug: "${title}"`,
                        { type: 'incident', id: report._id.toString() }
                    ).catch(() => {});
                }
            }
        })().catch(e => console.error('[Incident Background Tasks Fail]', e.message));

        res.status(201).json({ success: true, message: 'Incident reported successfully.', data: report });
    } catch (err) {
        next(err);
    }
};

