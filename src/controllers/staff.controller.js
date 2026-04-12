import { FoodOrder } from '../models/FoodOrder.js';
import { getIO } from '../socket.js';

export const getAvailableOrders = async (req, res, next) => {
    try {
        // Rocket-speed: Single-pass lean query with minimal projection
        const openOrders = await FoodOrder.find({
            status: 'confirmed'
        })
        .select('items zone userId status createdAt subtotal tableId')
        .populate('userId', 'name profileImage')
        .sort({ createdAt: 1 })
        .lean();

        res.status(200).json({ success: true, count: openOrders.length, data: openOrders });
    } catch (err) {
        next(err);
    }
};

// Accept an order with atomic locking
export const acceptOrder = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Atomic lock: Only update if status is still 'confirmed'
        const order = await FoodOrder.findOneAndUpdate(
            { _id: id, status: 'confirmed' },
            { 
                $set: { 
                    status: 'accepted', 
                    assignedStaffId: req.user.id 
                } 
            },
            { new: true }
        );

        if (!order) {
            // It was already accepted by someone else, or doesn't exist
            return res.status(400).json({ 
                success: false, 
                message: 'Order no longer available or already accepted by another staff member.' 
            });
        }

        // Emit Socket Event
        try {
            const io = getIO();
            if (io) {
                // Remove from pool for others
                io.emit('order_accepted', { orderId: order._id, assignedStaffId: req.user.id });
                // Notify user/host
                io.emit('order_status_updated', { orderId: order._id, status: order.status });
            }
        } catch (err) {
            console.error('[Socket] Failed to emit order acceptance:', err.message);
        }

        res.status(200).json({ success: true, message: 'Order accepted', data: order });
    } catch (err) {
        next(err);
    }
};

// Get orders assigned to the logged-in staff member
export const getMyOrders = async (req, res, next) => {
    try {
        const orders = await FoodOrder.find({
            assignedStaffId: req.user.id,
            status: { $in: ['accepted', 'preparing', 'out_for_delivery'] }
        }).populate('userId', 'name').sort({ createdAt: -1 }).lean();

        res.status(200).json({ success: true, data: orders });
    } catch (err) {
        next(err);
    }
};

// Update order status (preparing -> out_for_delivery -> completed)
export const updateOrderStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'preparing', 'out_for_delivery', 'completed'

        if (!['preparing', 'out_for_delivery', 'completed'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status update' });
        }

        const updateData = { status };
        if (status === 'completed') updateData.completedAt = new Date();

        const order = await FoodOrder.findOneAndUpdate(
            { _id: id, assignedStaffId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found or not assigned to you' });
        }

        // Emit Socket Event
        try {
            const io = getIO();
            if (io) {
                io.emit('order_status_updated', { orderId: order._id, status: order.status });
            }
        } catch (err) {
            console.error('[Socket] Failed to emit status update:', err.message);
        }

        res.status(200).json({ success: true, message: 'Status updated', data: order });
    } catch (err) {
        next(err);
    }
};
