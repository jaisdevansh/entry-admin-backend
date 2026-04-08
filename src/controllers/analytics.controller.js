import { Booking } from '../models/booking.model.js';
import { FoodOrder } from '../models/FoodOrder.js';
import { Staff } from '../models/Staff.js';
import { cacheService } from '../services/cache.service.js';

// GET /analytics/summary
export const getAnalyticsSummary = async (req, res, next) => {
    try {
        const userRole = req.user?.role?.toUpperCase();
        const isAdmin = userRole === 'ADMIN' || userRole === 'SUPERADMIN';
        const hostId = req.user.id;
        
        // ⚡ ADMIN: Show ALL data, HOST: Show only their data
        const CACHE_KEY = isAdmin ? 'analytics_summary_admin_all' : `analytics_summary_${hostId}`;
        
        let cachedData = await cacheService.get(CACHE_KEY);
        if (cachedData) {
            return res.status(200).json({ success: true, data: cachedData, source: 'cache' });
        }

        // ⚡ ADMIN: No hostId filter, HOST: Filter by hostId
        const bookingMatch = isAdmin 
            ? { paymentStatus: 'paid', status: { $in: ['approved', 'active', 'checked_in', 'completed'] } }
            : { hostId: hostId, paymentStatus: 'paid', status: { $in: ['approved', 'active', 'checked_in', 'completed'] } };
        
        const orderMatch = isAdmin
            ? { paymentStatus: 'paid' }
            : { hostId: hostId, paymentStatus: 'paid' };
        
        const staffMatch = isAdmin
            ? { isActive: true }
            : { hostId: hostId, isActive: true };
        
        const activeOrderMatch = isAdmin
            ? { status: { $in: ['pending', 'preparing', 'out_for_delivery'] } }
            : { hostId: hostId, status: { $in: ['pending', 'preparing', 'out_for_delivery'] } };

        // Parallel Aggregation for Speed
        const [ticketsAgg, ordersAgg, staffCount, activeOrdersAgg] = await Promise.all([
            Booking.aggregate([
                { $match: bookingMatch },
                { $group: { _id: null, ticketRevenue: { $sum: '$pricePaid' }, totalTickets: { $sum: 1 } } }
            ]),
            FoodOrder.aggregate([
                { $match: orderMatch },
                { $group: { 
                    _id: '$status', 
                    revenue: { $sum: '$totalAmount' }, 
                    count: { $sum: 1 } 
                }}
            ]),
            Staff.countDocuments(staffMatch),
            FoodOrder.countDocuments(activeOrderMatch)
        ]);

        let orderRevenue = 0;
        let deliveredOrders = 0;
        let rejectedOrders = 0;
        let totalOrders = 0;

        ordersAgg.forEach(grp => {
            totalOrders += grp.count;
            if (['completed', 'out_for_delivery'].includes(grp._id)) {
                orderRevenue += grp.revenue;
                deliveredOrders += grp.count;
            }
            if (['cancelled', 'rejected', 'failed'].includes(grp._id)) {
                rejectedOrders += grp.count;
            }
        });

        const ticketRevenue = ticketsAgg[0]?.ticketRevenue || 0;
        const totalTicketsCount = ticketsAgg[0]?.totalTickets || 0;
        
        // ⚡ ADMIN: Only show ticket revenue and bookings (no food orders, staff, live orders)
        // ⚡ HOST: Show everything
        const responseData = isAdmin ? {
            totalRevenue: ticketRevenue,
            ticketRevenue,
            totalOrders: totalTicketsCount,
            totalTickets: totalTicketsCount,
            deliveredOrders: totalTicketsCount,
            rejectedOrders: 0,
            updatedAt: new Date()
        } : {
            totalRevenue: ticketRevenue + orderRevenue,
            ticketRevenue,
            orderRevenue,
            totalOrders: totalTicketsCount + totalOrders,
            totalTickets: totalTicketsCount,
            totalFoodOrders: totalOrders,
            deliveredOrders,
            rejectedOrders,
            activeStaff: staffCount || 0,
            liveOrders: activeOrdersAgg || 0,
            updatedAt: new Date()
        };

        // Cache for 5 minutes
        await cacheService.set(CACHE_KEY, responseData, 300);

        res.status(200).json({ success: true, data: responseData });
    } catch (err) {
        next(err);
    }
};

// GET /analytics/revenue-trend
export const getRevenueTrend = async (req, res, next) => {
    try {
        const userRole = req.user?.role?.toUpperCase();
        const isAdmin = userRole === 'ADMIN' || userRole === 'SUPERADMIN';
        
        // ⚡ ADMIN: Show ALL revenue, HOST: Show only their revenue
        const CACHE_KEY = isAdmin ? 'analytics_trend_admin_all' : `analytics_trend_${req.user.id}`;
        
        let cachedData = await cacheService.get(CACHE_KEY);
        if (cachedData) {
            return res.status(200).json({ success: true, data: cachedData, source: 'cache' });
        }

        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 29); // Last 30 days including today
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        // ⚡ ADMIN: No hostId filter, HOST: Filter by hostId
        const matchQuery = isAdmin 
            ? { paymentStatus: 'paid', createdAt: { $gte: thirtyDaysAgo } }
            : { hostId: req.user.id, paymentStatus: 'paid', createdAt: { $gte: thirtyDaysAgo } };

        const [ordersAgg, bookingsAgg] = await Promise.all([
            FoodOrder.aggregate([
                { $match: matchQuery },
                { $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    dailyRevenue: { $sum: "$totalAmount" }
                }},
                { $sort: { _id: 1 } }
            ]),
            Booking.aggregate([
                { $match: matchQuery },
                { $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    dailyRevenue: { $sum: "$pricePaid" }
                }},
                { $sort: { _id: 1 } }
            ])
        ]);

        const trendsMap = new Map();
        [...ordersAgg, ...bookingsAgg].forEach(item => {
            const current = trendsMap.get(item._id) || 0;
            trendsMap.set(item._id, current + item.dailyRevenue);
        });

        const data = Array.from(trendsMap.entries())
            .map(([date, revenue]) => ({ date, revenue }))
            .sort((a, b) => a.date.localeCompare(b.date));

        await cacheService.set(CACHE_KEY, data, 600); // 10 minutes cache

        res.status(200).json({ success: true, data });
    } catch(err) { next(err); }
};

// GET /analytics/top-items
export const getTopItems = async (req, res, next) => {
    try {
        const CACHE_KEY = `top_items_${req.user.id}`;
        let cachedData = await cacheService.get(CACHE_KEY);
        if (cachedData) return res.status(200).json({ success: true, data: cachedData, source: 'cache' });

        const userOrders = await FoodOrder.aggregate([
            { $match: { hostId: req.user.id, paymentStatus: 'paid' } },
            { $unwind: "$items" },
            { $group: { _id: "$items.name", totalSold: { $sum: "$items.qty" }, revenue: { $sum: { $multiply: ["$items.qty", "$items.price"] } } }},
            { $sort: { totalSold: -1 } },
            { $limit: 10 }
        ]);
        
        const mapped = userOrders.map(i => ({ name: i._id, totalSold: i.totalSold, revenue: i.revenue }));
        await cacheService.set(CACHE_KEY, mapped, 1800); // 30 min cache

        res.status(200).json({ success: true, data: mapped });
    } catch(err) { next(err); }
};

// GET /analytics/top-users
export const getTopUsers = async (req, res, next) => {
    try {
        const CACHE_KEY = `top_users_${req.user.id}`;
        let cachedData = await cacheService.get(CACHE_KEY);
        if (cachedData) return res.status(200).json({ success: true, data: cachedData, source: 'cache' });

        const topB = await Booking.aggregate([
            { $match: { hostId: req.user.id, paymentStatus: 'paid' } },
            { $group: { _id: "$userId", spent: { $sum: "$pricePaid" } } }
        ]);

        const topO = await FoodOrder.aggregate([
            { $match: { hostId: req.user.id, paymentStatus: 'paid' } },
            { $group: { _id: "$userId", spent: { $sum: "$totalAmount" } } }
        ]);

        const usersMap = new Map();
        [...topB, ...topO].forEach(i => {
            const cur = usersMap.get(i._id.toString()) || 0;
            usersMap.set(i._id.toString(), cur + i.spent);
        });

        const sortedIds = Array.from(usersMap.entries())
            .sort((a,b) => b[1] - a[1])
            .slice(0, 10)
            .map(([uId, spent]) => ({ id: uId, spent }));

        // POPULATE users efficiently in one query
        const { User } = await import('../models/user.model.js');
        const userInfos = await User.find({ _id: { $in: sortedIds.map(s => s.id) } })
            .select('name profileImage email')
            .lean();

        const finalData = sortedIds.map(s => {
            const info = userInfos.find(u => u._id.toString() === s.id);
            return {
                id: s.id,
                name: info?.name || 'Unknown User',
                profileImage: info?.profileImage || '',
                totalSpent: s.spent
            };
        });

        await cacheService.set(CACHE_KEY, finalData, 3600); // 1 hour cache
        res.status(200).json({ success: true, data: finalData });

    } catch(err) { next(err); }
};

// GET /analytics/booking-trend
export const getBookingTrend = async (req, res, next) => {
    try {
        const userRole = req.user?.role?.toUpperCase();
        const isAdmin = userRole === 'ADMIN' || userRole === 'SUPERADMIN';
        
        // ⚡ ADMIN: Show ALL bookings, HOST: Show only their bookings
        const CACHE_KEY = isAdmin ? 'analytics_booking_trend_admin_all' : `analytics_booking_trend_${req.user.id}`;
        
        let cachedData = await cacheService.get(CACHE_KEY);
        if (cachedData) {
            return res.status(200).json({ success: true, data: cachedData, source: 'cache' });
        }

        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 29); // Last 30 days including today
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        // ⚡ ADMIN: No hostId filter, HOST: Filter by hostId
        const matchQuery = isAdmin 
            ? { paymentStatus: 'paid', createdAt: { $gte: thirtyDaysAgo } }
            : { hostId: req.user.id, paymentStatus: 'paid', createdAt: { $gte: thirtyDaysAgo } };

        const bookingsAgg = await Booking.aggregate([
            { $match: matchQuery },
            { $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                count: { $sum: 1 },
                revenue: { $sum: "$pricePaid" }
            }},
            { $sort: { _id: 1 } }
        ]);

        const data = bookingsAgg.map(item => ({
            date: item._id,
            count: item.count,
            revenue: item.revenue
        }));

        await cacheService.set(CACHE_KEY, data, 600); // 10 minutes cache

        res.status(200).json({ success: true, data });
    } catch(err) { next(err); }
};
