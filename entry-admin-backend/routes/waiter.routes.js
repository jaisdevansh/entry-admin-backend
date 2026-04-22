import express from 'express';
import { 
    getAvailableOrders, 
    acceptOrder, 
    rejectOrder,
    getMyOrders, 
    getCompletedOrders, 
    updateOrderStatus 
} from '../controllers/waiter.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = express.Router();

// Apply global waiter protection
router.use(protect);
router.use(authorize('waiter', 'staff', 'host', 'admin', 'superadmin'));

// --- ORDER PICKUP ---
router.get('/orders/available', getAvailableOrders);
router.put('/orders/:id/accept', acceptOrder);
router.put('/orders/:id/reject', rejectOrder);

// --- ACTIVE ORDERS ---
router.get('/orders/my', getMyOrders);
router.put('/orders/:id/status', updateOrderStatus);

// --- HISTORY ---
router.get('/orders/completed', getCompletedOrders);

export default router;
