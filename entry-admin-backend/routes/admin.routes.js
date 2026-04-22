import express from 'express';
import { protect, requireAdmin } from '../middleware/auth.middleware.js';
import { cacheService } from '../services/cache.service.js';
import { 
    createHost, 
    getHostList,
    getPendingHosts, 
    verifyHost, 
    suspendHost, 
    toggleEventFlags,
    getAllStaff,
    getUserList,
    getUserProfile,
    getBookingList,
    updateAdminProfile,
    getAdminStats,
    getHostProfile,
    getHostKyc,
    toggleUserStatus,
    deleteHost,
    toggleHostRegistryStatus,
    deleteUser,
    getAdminProfile
} from '../controllers/admin.controller.js';

const router = express.Router();

// All routes require authentication and admin privileges
router.use(protect, requireAdmin);

router.get('/profile', getAdminProfile);
router.put('/profile/update', updateAdminProfile);
router.post('/hosts/create', createHost);
router.get('/hosts', getHostList);
router.get('/hosts/pending', getPendingHosts);
router.get('/hosts/:id', getHostProfile);
router.get('/hosts/:id/kyc', getHostKyc);
router.put('/hosts/:id/status-toggle', toggleHostRegistryStatus);
router.delete('/hosts/:id', deleteHost);
router.put('/hosts/:id/verify', verifyHost);
router.put('/hosts/:id/suspend', suspendHost);
router.put('/events/:eventId/flags', toggleEventFlags);
router.get('/staff', getAllStaff);
router.get('/users', getUserList);
router.get('/users/:id', getUserProfile);
router.put('/users/:id/status', toggleUserStatus);
router.delete('/users/:id', deleteUser);
router.get('/bookings', getBookingList);
router.get('/stats', getAdminStats);
router.post('/cache/clear', async (req, res) => {
    try {
        await cacheService.flushAll();
        res.status(200).json({ success: true, message: 'Registry cache cleared successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Purge failed.' });
    }
});

export default router;
