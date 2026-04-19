import mongoose from 'mongoose';
import { Booking } from '../models/booking.model.js';
import { FoodOrder } from '../models/FoodOrder.js';
import { cacheService } from '../services/cache.service.js';
import { sendNotification } from '../services/notification.service.js';

export const getMyBookings = async (req, res, next) => {
    try {
        const cacheKey = `my_bookings_${req.user.id}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const bookings = await Booking.find({ userId: req.user.id })
            .select('eventId hostId status paymentStatus ticketType tableId seatIds guests pricePaid createdAt')
            .populate('eventId', 'title date coverImage startTime venue')
            .populate('hostId', 'name profileImage')
            .sort({ createdAt: -1 })
            .lean();

        await cacheService.set(cacheKey, bookings, 30); // 30s cache — explicit bust happens on booking create/update
        res.status(200).json({ success: true, data: bookings });
    } catch (err) { next(err); }
};

export const getBookingById = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'Invalid booking identifier format' });
        }

        // ⚡ Single query — lean() keeps hostId as string before populate
        const booking = await Booking.findById(id)
            .populate('eventId')
            .lean();

        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        // hostId stays as plain string in lean() result (no populate = never null)
        booking.hostIdRaw = booking.hostId?.toString() || null;

        res.status(200).json({ success: true, data: booking });
    } catch (err) { next(err); }
};

export const cancelBooking = async (req, res, next) => {
    try {
        const { id } = req.params;
        const booking = await Booking.findOneAndUpdate(
            { _id: id, userId: req.user.id, status: { $ne: 'cancelled' } },
            { status: 'cancelled' },
            { new: true }
        );
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found or already cancelled' });
        res.status(200).json({ success: true, message: 'Booking cancelled' });
    } catch (err) { next(err); }
};

export const getMyFoodOrders = async (req, res, next) => {
    try {
        const cacheKey = `my_orders_${req.user.id}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: typeof cached === 'string' ? JSON.parse(cached) : cached });

        const orders = await FoodOrder.find({ userId: req.user.id })
            .populate('eventId', 'title date')
            .sort({ createdAt: -1 })
            .lean();

        await cacheService.set(cacheKey, orders, 120); // 2 min cache (orders update frequently)
        res.status(200).json({ success: true, data: orders });
    } catch (err) { next(err); }
};

export const getBookings = async (req, res, next) => {
    try {
        const { eventId, status, search, page = 1, limit = 20 } = req.query;
        let query = { hostId: req.user.id };

        if (eventId) query.eventId = eventId;
        if (status) query.status = status;
        // Search by user name would require aggregation or populate matching. Simplified here:

        const skip = (page - 1) * limit;

        const bookings = await Booking.find(query)
            .select('userId eventId ticketType tableId seatIds guests pricePaid checkInTime status paymentStatus createdAt')
            .populate('userId', 'name email profileImage')
            .populate('eventId', 'title date')
            .skip(skip)
            .limit(Number(limit))
            .sort({ createdAt: -1 })
            .lean();

        const total = await Booking.countDocuments(query);

        res.status(200).json({
            success: true,
            data: bookings,
            pagination: {
                total,
                pages: Math.ceil(total / limit),
                current: Number(page)
            }
        });
    } catch (error) {
        next(error);
    }
};

export const checkInQR = async (req, res, next) => {
    try {
        const { qrPayload, identifier } = req.body;
        // Host ID can come from direct host login, or from the hostId field on a staff member's record
        const hostContextId = req.user.role === 'host' ? req.user.id : req.user.hostId;

        const booking = await Booking.findOne({ 
            $or: [{ qrPayload }, { _id: (identifier?.length === 24) ? identifier : undefined }],
            hostId: hostContextId 
        }).populate('userId', 'name');

        if (!booking) {
            return res.status(404).json({ success: false, ticketStatus: "Invalid" });
        }

        if (booking.status === 'checked_in') {
            return res.status(400).json({ success: false, ticketStatus: "Already Used" });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ success: false, ticketStatus: "Invalid" });
        }

        booking.status = 'checked_in';
        booking.checkInTime = new Date();
        await booking.save();
        await cacheService.delete('admin_dashboard_stats');
        
        // Targeted Invalidation (Huge Performance Booster over flushAll)
        const uId = booking.userId?._id || booking.userId;
        await cacheService.delete(`my_bookings_${uId}`);
        await cacheService.delete('events_all_guest_v11');

        // ── Push Notifications ────────────────────────────────────────────────
        try {
            const userName = booking.userId?.name || 'A guest';
            
            // 1. Notify User
            if (uId) {
                await sendNotification(uId, {
                    title: 'Welcome Inside! 🎉',
                    message: `You have successfully checked in. Have a great time!`,
                    type: 'SUCCESS',
                    data: { bookingId: booking._id.toString() }
                });
            }

            // 2. Notify Host
            if (hostContextId) {
                await sendNotification(hostContextId, {
                    title: 'Guest Checked In ✅',
                    message: `${userName} just checked in.`,
                    type: 'INFO',
                    data: { bookingId: booking._id.toString() }
                });
            }
        } catch (pushErr) {
            console.error('[Booking CheckIn] Push Err:', pushErr.message);
        }

        res.status(200).json({ success: true, ticketStatus: "Checked In", bookingId: booking._id });
    } catch (error) {
        next(error);
    }
};

export const updateBookingStatus = async (req, res, next) => {
    try {
        const { bookingId } = req.params;
        const { status } = req.body; // 'approved' or 'rejected'
        
        const booking = await Booking.findOneAndUpdate(
            { _id: bookingId, hostId: req.user.id },
            { status },
            { new: true }
        );

        if (booking) {
            await cacheService.delete('admin_dashboard_stats');
            const uId = booking.userId?._id || booking.userId;
            await cacheService.delete(`my_bookings_${uId}`);
            await cacheService.delete('events_all_guest_v11');
        }

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        res.status(200).json({ success: true, data: booking });
    } catch (error) {
        next(error);
    }
};
