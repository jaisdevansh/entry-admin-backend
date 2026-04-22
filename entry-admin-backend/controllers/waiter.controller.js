import { FoodOrder } from '../models/FoodOrder.js';
import { WaiterDetails } from '../models/WaiterDetails.js';
import { Staff } from '../models/Staff.js';
import { getIO } from '../socket.js';
import { cacheService } from '../services/cache.service.js';

/**
 * Helper: fetch the waiter's zone/type details.
 */
const getWaiterDetails = async (userId) => {
    const cacheKey = `waiter:details:${userId}`;
    return cacheService.wrap(cacheKey, 3600, () => WaiterDetails.findOne({ userId }).lean());
};

const getStaffData = async (userId) => {
    const cacheKey = `staff:data:${userId}`;
    return cacheService.wrap(cacheKey, 3600, () => Staff.findById(userId).select('hostId').lean());
};

/**
 * @desc  Get available orders for this waiter (zone + type filtered)
 * @route GET /api/v1/waiter/orders/available
 */
export const getAvailableOrders = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const [details, staff] = await Promise.all([
            getWaiterDetails(userId),
            getStaffData(userId)
        ]);

        const hostId = staff?.hostId;
        const section = details?.assignedSection || 'all';
        const cacheKey = `orders:available:${hostId}:${section}`;

        const orders = await cacheService.wrap(cacheKey, 10, async () => {
            const matchQuery = {
                status: 'confirmed',
                paymentStatus: 'paid',
                assignedStaffId: null,
            };

            if (hostId) matchQuery.hostId = hostId;

            if (section !== 'all') {
                matchQuery.zone = { $regex: new RegExp(section, 'i') };
            }

            return FoodOrder.find(matchQuery)
                .select('_id userId senderId receiverId items zone tableId subtotal totalAmount status type createdAt updatedAt')
                .populate('userId', 'name profileImage')
                .populate('senderId', 'name profileImage')
                .populate('receiverId', 'name profileImage')
                .sort({ createdAt: 1 })
                .lean();
        });

        res.status(200).json({ success: true, count: orders.length, data: orders });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc  Accept an order (atomic — first-accept-wins via findOneAndUpdate)
 * @route PUT /api/v1/waiter/orders/:id/accept
 */
export const acceptOrder = async (req, res, next) => {
    try {
        const { id } = req.params;
        const waiterId = req.user.id;

        // Check max active task limit
        const [details, activeCount] = await Promise.all([
            getWaiterDetails(waiterId),
            FoodOrder.countDocuments({
                assignedStaffId: waiterId,
                status: { $in: ['accepted', 'preparing', 'out_for_delivery'] }
            })
        ]);

        const maxTasks = details?.maxActiveOrders || 3;
        if (activeCount >= maxTasks) {
            return res.status(400).json({
                success: false,
                message: `You have reached your max active task limit (${maxTasks}). Complete existing tasks first.`
            });
        }

        // Atomic update — only succeeds if still unassigned & confirmed (prevents double-accept)
        const order = await FoodOrder.findOneAndUpdate(
            { _id: id, status: 'confirmed', assignedStaffId: null },
            { status: 'accepted', assignedStaffId: waiterId, acceptedAt: new Date() },
            { new: true }
        ).populate('userId', 'name');

        if (!order) {
            return res.status(409).json({ success: false, message: 'Order already accepted by another staff member' });
        }

        // --- Cache Invalidation ---
        try {
            const staff = await getStaffData(waiterId);
            const section = details?.assignedSection || 'all';
            await Promise.all([
                cacheService.delete(`orders:available:${staff?.hostId}:${section}`),
                cacheService.delete(`orders:my:${waiterId}`)
            ]);
        } catch (err) {}

        // Real-time broadcast
        try {
            const io = getIO();
            const userId = order.userId?._id?.toString() || order.userId?.toString();
            if (io && userId) {
                io.to(userId).emit('order_updated', { orderId: id, status: 'accepted' });
            }
            // Broadcast to waiter_room so other waiters see it disappear from available pool
            io?.to('waiter_room').emit('order_updated', { orderId: id, status: 'accepted' });

            // Push notification to user
            const { notificationService } = await import('../services/notification.service.js');
            const Notification = (await import('../models/Notification.js')).default;
            const title = 'Order Accepted ✅';
            const body = 'Your order is being handled by our staff.';
            if (userId) {
                await Promise.all([
                    notificationService.sendToUser(userId, title, body, { type: 'order_status', orderId: id }),
                    Notification.create({ userId, title, body, type: 'status', data: { orderId: id, status: 'accepted' } })
                ]);
            }
        } catch (err) {
            console.error('[Notify] acceptOrder:', err.message);
        }

        res.status(200).json({ success: true, data: order });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc  Reject an order (cancellation by staff)
 * @route PUT /api/v1/waiter/orders/:id/reject
 */
export const rejectOrder = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const order = await FoodOrder.findOneAndUpdate(
            { _id: id, status: 'confirmed', assignedStaffId: null },
            { status: 'cancelled' },
            { new: true }
        ).populate('userId', 'name');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order already processed or not found' });
        }

        // Real-time notification to user
        try {
            const io = getIO();
            const userId = order.userId?._id?.toString() || order.userId?.toString();
            if (io && userId) {
                io.to(userId).emit('order_updated', { orderId: id, status: 'cancelled', reason });
            }
            io?.to('waiter_room').emit('order_updated', { orderId: id, status: 'cancelled' });

            const { notificationService } = await import('../services/notification.service.js');
            const Notification = (await import('../models/Notification.js')).default;
            const title = 'Order Cancelled ❌';
            const body = reason ? `Sorry, your order was rejected: ${reason}` : 'Your order could not be fulfilled by staff.';
            
            if (userId) {
                await Promise.all([
                    notificationService.sendToUser(userId, title, body, { type: 'order_status', orderId: id, status: 'cancelled' }),
                    Notification.create({ userId, title, body, type: 'status', data: { orderId: id, status: 'cancelled' } })
                ]);
            }
        } catch (err) {}

        res.status(200).json({ success: true, message: 'Order rejected' });
    } catch (err) {
        next(err);
    }
};

/**
 * @desc  Get waiter's active orders (accepted, preparing, out_for_delivery)
 * @route GET /api/v1/waiter/orders/my
 */
export const getMyOrders = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const cacheKey = `orders:my:${userId}`;

        const orders = await cacheService.wrap(cacheKey, 30, async () => {
            return FoodOrder.find({
                assignedStaffId: userId,
                status: { $in: ['accepted', 'preparing', 'out_for_delivery'] }
            })
            .select('_id userId senderId receiverId items zone tableId subtotal totalAmount status type createdAt updatedAt')
            .populate('userId', 'name profileImage')
            .populate('senderId', 'name profileImage')
            .populate('receiverId', 'name profileImage')
            .sort({ updatedAt: -1 })
            .lean();
        });

        res.status(200).json({ success: true, count: orders.length, data: orders });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc  Get waiter's completed history (last 50)
 * @route GET /api/v1/waiter/orders/completed
 */
export const getCompletedOrders = async (req, res, next) => {
    try {
        const orders = await FoodOrder.find({
            assignedStaffId: req.user.id,
            status: 'completed'
        })
        .populate('userId', 'name profileImage')
        .populate('senderId', 'name profileImage')
        .populate('receiverId', 'name profileImage')
        .sort({ completedAt: -1 })
        .limit(50)
        .lean();

        res.status(200).json({ success: true, count: orders.length, data: orders });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc  Update order status: accepted → preparing → out_for_delivery → completed
 * @route PUT /api/v1/waiter/orders/:id/status
 */
export const updateOrderStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const ALLOWED = ['preparing', 'out_for_delivery', 'completed'];

        if (!ALLOWED.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status transition' });
        }

        const updateData = { status };
        if (status === 'completed') updateData.completedAt = new Date();

        const order = await FoodOrder.findOneAndUpdate(
            { _id: id, assignedStaffId: req.user.id },
            updateData,
            { new: true }
        ).populate('userId', 'name');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found or not assigned to you' });
        }

        // --- Cache Invalidation ---
        try {
            await Promise.all([
                cacheService.delete(`orders:my:${req.user.id}`),
                status === 'completed' && cacheService.delete(`orders:completed:${req.user.id}`)
            ]);
        } catch (err) {}

        // Real-time
        try {
            const io = getIO();
            const userId = order.userId?._id?.toString() || order.userId?.toString();
            if (userId) io?.to(userId).emit('order_updated', { orderId: id, status });
            io?.to('waiter_room').emit('order_updated', { orderId: id, status });

            // Push notification to user
            const { notificationService } = await import('../services/notification.service.js');
            const Notification = (await import('../models/Notification.js')).default;
            const labels = {
                preparing:         { title: 'Preparing Order 👨‍🍳', body: 'Staff is preparing your order now.' },
                out_for_delivery:  { title: 'On the Way 🚀',        body: 'Your order is being delivered to your table.' },
                completed:         { title: '🎉 Delivered!',         body: 'Your order has been successfully delivered. Enjoy!' }
            };
            const { title, body } = labels[status] || { title: 'Order Update', body: `Status: ${status}` };
            if (userId) {
                await Promise.all([
                    notificationService.sendToUser(userId, title, body, { type: 'order_status', orderId: id, status }),
                    Notification.create({ userId, title, body, type: 'status', data: { orderId: id, status } })
                ]);
            }
        } catch (err) {
            console.error('[Notify] updateOrderStatus:', err.message);
        }

        res.status(200).json({ success: true, data: order });
    } catch (error) {
        next(error);
    }
};
