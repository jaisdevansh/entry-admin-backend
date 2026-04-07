import express from 'express';
import { getAvailableOrders, acceptOrder, getMyOrders, updateOrderStatus } from '../controllers/staff.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('staff', 'superadmin'));

router.get('/orders/available', getAvailableOrders);
router.post('/orders/:id/accept', acceptOrder);
router.get('/orders/my-orders', getMyOrders);
router.put('/orders/:id/status', updateOrderStatus);

export default router;
