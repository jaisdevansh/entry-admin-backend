import { Booking } from '../models/booking.model.js';
import { FoodOrder } from '../models/FoodOrder.js';
import { Staff } from '../models/Staff.js';
import { cacheService } from '../services/cache.service.js';

// GET /analytics/summary
export const getAnalyticsSummary = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const CACHE_KEY = `analytics_summary_${hostId}`;
        
        let cachedData = await cacheService.get(CACHE_KEY);
        if (cachedData) {
            return res.status(200).json({ success: true, data: cachedData, source: 'cache' });
        }

        // Parallel Aggregation for Speed
        const [ticketsAgg, ordersAgg, staffCount, activeOrdersAgg] = await Promise.all([
            Booking.aggregate([
                { $match: { hostId: hostId, paymentStatus: 'paid', status: { $in: ['approved', 'active', 'checked_in', 'completed'] } } },
                { $group: { _id: null, ticketRevenue: { $sum: '$pricePaid' }, totalTickets: { $sum: 1 } } }
            ]),
            FoodOrder.aggregate([
                { $match: { hostId: hostId, paymentStatus: 'paid' } },
                { $group: { 
                    _id: '$status', 
                    revenue: { $sum: '$totalAmount' }, 
                    count: { $sum: 1 } 
                }}
            ]),
            Staff.countDocuments({ hostId: hostId, isActive: true }), // Improved: filter by hostId
            FoodOrder.countDocuments({ hostId: hostId, status: { $in: ['pending', 'preparing', 'out_for_delivery'] } })
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
        
        const responseData = {
            totalRevenue: ticketRevenue + orderRevenue,
            ticketRevenue,
            orderRevenue,
            totalOrders: totalTicketsCount + totalOrders,
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
        const CACHE_KEY = `analytics_trend_${req.user.id}`;
        let cachedData = await cacheService.get(CACHE_KEY);
        if (cachedData) {
            return res.status(200).json({ success: true, data: cachedData, source: 'cache' });
        }

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const ordersAgg = await FoodOrder.aggregate([
            { $match: { hostId: req.user.id, paymentStatus: 'paid', createdAt: { $gte: thirtyDaysAgo } } },
            { $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                dailyRevenue: { $sum: "$totalAmount" }
            }},
            { $sort: { _id: 1 } }
        ]);

        const bookingsAgg = await Booking.aggregate([
            { $match: { hostId: req.user.id, paymentStatus: 'paid', createdAt: { $gte: thirtyDaysAgo } } },
            { $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                dailyRevenue: { $sum: "$pricePaid" }
            }},
            { $sort: { _id: 1 } }
        ]);

        const trendsMap = new Map();
        [...ordersAgg, ...bookingsAgg].forEach(item => {
            const current = trendsMap.get(item._id) || 0;
            trendsMap.set(item._id, current + item.dailyRevenue);
        });

        const data = Array.from(trendsMap.entries()).map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date));

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
