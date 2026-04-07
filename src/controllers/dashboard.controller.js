import { Event } from '../models/Event.js';
import { Booking } from '../models/booking.model.js';
import { cacheService } from '../services/cache.service.js';
import mongoose from 'mongoose';

export const getDashboardSummary = async (req, res, next) => {
    const hostId = req.user.id;

    try {
        const CACHE_KEY = `dashboard_stats_${hostId}`;
        const cached = await cacheService.get(CACHE_KEY);
        if (cached && typeof cached !== 'string') return res.status(200).json({ success: true, ...cached });
        if (cached && typeof cached === 'string') return res.status(200).json({ success: true, ...(JSON.parse(cached)) });

        // [SCALABLE] Query DB explicitly for what's needed, using 1 single super query for bookings
        const [bookingStats, eventsStats, upcomingEvents] = await Promise.all([
            Booking.aggregate([
                { $match: { hostId: new mongoose.Types.ObjectId(hostId), status: { $ne: 'cancelled' } } },
                {
                    $group: {
                        _id: null,
                        totalBookings: { $sum: 1 },
                        revenue: { $sum: "$pricePaid" },
                        checkedIn: { $sum: { $cond: [{ $eq: ["$status", "checked_in"] }, 1, 0] } }
                    }
                }
            ]),
            
            // Calculate capacity across events
            Event.aggregate([
                { $match: { hostId: new mongoose.Types.ObjectId(hostId), status: { $ne: 'cancelled' } } },
                { $unwind: "$tickets" },
                { $group: {
                    _id: null,
                    totalCapacity: { $sum: "$tickets.capacity" },
                    totalSold: { $sum: "$tickets.sold" }
                }}
            ]),

            Event.find({ hostId, date: { $gte: new Date() } })
                 .sort({ date: 1 }) // Closest upcoming first
                 .limit(5)
                 .select('title date status coverImage attendeeCount')
                 .lean()
        ]);

        const bStats = bookingStats[0] || { totalBookings: 0, revenue: 0, checkedIn: 0 };
        const capacityData = eventsStats[0] || { totalCapacity: 0, totalSold: 0 };
        const capacityUsage = capacityData.totalCapacity > 0
            ? Math.round((capacityData.totalSold / capacityData.totalCapacity) * 100) + '%'
            : '0%';

        const responsePayload = {
            stats: {
                totalBookings: bStats.totalBookings,
                revenue: bStats.revenue,
                checkedIn: bStats.checkedIn,
                upcomingEventsCount: upcomingEvents.length,
                capacityUsage
            },
            upcomingEvents
        };

        await cacheService.set(CACHE_KEY, responsePayload, 30); // 30 second global cache barrier

        res.status(200).json({
            success: true,
            ...responsePayload
        });
    } catch (error) {
        next(error);
    }
};
