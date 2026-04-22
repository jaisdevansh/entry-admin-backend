import express from 'express';
import { getDashboardSummary } from "../controllers/dashboard.controller.js";
import {
    createEvent,
    getEvents,
    getEventById,
    updateEvent,
    updateEventStatus,
    deleteEvent,
    revealEventLocation
} from "../controllers/event.controller.js";
import { getBookings, checkInQR, updateBookingStatus } from "../controllers/booking.controller.js";
import {
    createTicket,
    getTickets,
    getTicketById
} from "../controllers/ticket.controller.js";
import {
    getHostProfile,
    updateHostProfile,
    getVenueProfile,
    updateVenueProfile,
    getPayments,
    getPayouts,
    getStaff,
    addStaff,
    removeStaff,
    updateStaff,
    getMedia,
    uploadMedia,
    approveMedia,
    removeMedia,
    getCoupons,
    createCoupon,
    removeCoupon,
    getWaitlist,
    processWaitlist,
    getOrders,
    updateOrderStatus,
    getIncidents,
    resolveIncident,
    deleteIncident,
    getReviews,
    completeProfile,
    getDashboardStats,
    getHostGifts,
    createHostGift,
    updateHostGift,
    removeHostGift,
    getMenuItems,
    addMenuItem,
    updateMenuItem,
    removeMenuItem
} from '../controllers/host.controller.js';
import {
    getAdminChat,
    hostSendMessage
} from '../controllers/adminChat.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { requireActiveHost } from '../middleware/hostStatus.middleware.js';
import { validate } from '../middleware/validator.middleware.js';
import { createEventSchema } from '../validators/event.validator.js';
import { updateVenueSchema } from '../validators/venue.validator.js';
import { scanQRSchema } from '../validators/booking.validator.js';

const router = express.Router();

// Apply global host authentication to all /host/* routes
router.use(protect);
router.use(authorize('host', 'admin', 'superadmin'));

// --- DASHBOARD ---
router.get('/dashboard/summary', getDashboardSummary);
router.get('/dashboard/stats', getDashboardStats);

// --- PROFILE ---
router.get('/profile', getHostProfile);
router.put('/profile/update', updateHostProfile);
router.post('/onboarding', completeProfile);
router.put('/profile/complete', completeProfile); // Legacy fallback
router.get('/venue-profile', getVenueProfile);
router.put('/profile/venue', validate(updateVenueSchema), updateVenueProfile);

// --- PAYMENTS & PAYOUTS ---
router.get('/payments', getPayments);
router.get('/payouts', getPayouts);

// --- STAFF ---
router.get('/staff', getStaff);
router.post('/staff/add', addStaff);
router.delete('/staff/remove/:staffId', removeStaff);
router.put('/staff/update/:staffId', updateStaff);

// --- MEDIA ---
router.get('/media', getMedia);
router.post('/media/upload', uploadMedia);
router.put('/media/approve', approveMedia);
router.delete('/media/remove/:mediaId', removeMedia);

// --- COUPONS ---
router.get('/coupons', getCoupons);
router.post('/coupons', createCoupon);
router.delete('/coupons/:couponId', removeCoupon);

// --- TICKETS ---
router.post('/tickets', createTicket);
router.get('/tickets', getTickets);
router.get('/tickets/:ticketId', getTicketById);

// --- EVENTS ---
// Active Hosts only for creating, updating, publishing events
router.post('/events', requireActiveHost, validate(createEventSchema), createEvent);
router.get('/events', getEvents);
router.get('/events/:eventId', getEventById);
router.put('/events/:eventId', requireActiveHost, updateEvent);
router.patch('/events/:eventId/status', requireActiveHost, updateEventStatus);
router.delete('/events/:eventId', requireActiveHost, deleteEvent);
router.post('/events/:eventId/reveal-location', requireActiveHost, revealEventLocation);

// --- BOOKINGS ---
router.get('/bookings', getBookings);
router.post('/bookings/check-in', validate(scanQRSchema), checkInQR);
router.put('/bookings/:bookingId/status', updateBookingStatus);

// --- WAITLIST ---
router.get('/waitlist', getWaitlist);
router.put('/waitlist/:waitlistId/process', processWaitlist);

// --- ORDERS ---
router.get('/orders', getOrders);
router.put('/orders/:orderId/status', updateOrderStatus);

// --- SECURITY & INSIGHTS ---
router.get('/incidents', getIncidents);
router.put('/incidents/:incidentId/resolve', resolveIncident);
router.delete('/incidents/:incidentId', deleteIncident);
router.get('/reviews', getReviews);

// --- ADMIN CHAT ---
router.get('/admin-chat', getAdminChat);
router.post('/admin-chat/send', hostSendMessage);

// --- GIFTS (Standalone DB) ---
router.get('/gifts', getHostGifts);
router.post('/gifts', createHostGift);
router.put('/gifts/:giftId', updateHostGift);
router.delete('/gifts/:giftId', removeHostGift);

// --- MENU (Standalone DB - per host) ---
router.get('/menu', getMenuItems);
router.post('/menu', addMenuItem);
router.put('/menu/:itemId', updateMenuItem);
router.delete('/menu/:itemId', removeMenuItem);

export default router;
