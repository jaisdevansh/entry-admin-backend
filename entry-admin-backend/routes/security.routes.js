import express from 'express';
import { 
    createIssueReport, 
    getOpenIssues, 
    respondToIssue, 
    resolveIssue, 
    getMyIssues, 
    getResolvedHistory,
    verifyTicketGate,
    confirmCheckIn
} from '../controllers/security.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = express.Router();

// User-side: create issue (protect, role: USER, HOST, ADMIN)
router.post('/reports', protect, createIssueReport);

// Security-side: protect, role: security (and admin)
router.use(protect);
router.use(authorize('security', 'host', 'admin', 'superadmin', 'staff'));

// --- MONITORING ---
router.get('/issues/open', getOpenIssues);
router.put('/issues/:id/respond', respondToIssue);

// --- ACTIVE ISSUES ---
router.get('/issues/my', getMyIssues);
router.put('/issues/:id/resolve', resolveIssue);

// --- GATE CONTROL (TACTICAL TWO-STEP) ---
router.post('/verify-ticket', verifyTicketGate);
router.post('/confirm-entry', confirmCheckIn);

// --- HISTORY ---
router.get('/issues/resolved', getResolvedHistory);

export default router;
