import express from 'express';
import { getAnalyticsSummary, getRevenueTrend, getTopItems, getTopUsers, getBookingTrend } from '../controllers/analytics.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('host', 'admin', 'superadmin'));

router.get('/summary', getAnalyticsSummary);
router.get('/revenue-trend', getRevenueTrend);
router.get('/booking-trend', getBookingTrend);
router.get('/top-items', getTopItems);
router.get('/top-users', getTopUsers);

export default router;
