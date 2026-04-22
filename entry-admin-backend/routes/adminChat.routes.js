import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { getAllChats, getChatByHost, adminReply } from '../controllers/adminChat.controller.js';

const router = express.Router();

router.use(protect);
router.use(authorize('admin', 'superadmin'));

// Admin sees all host chats
router.get('/all', getAllChats);

// Admin reads specific host thread
router.get('/:hostId', getChatByHost);

// Admin replies to a host
router.post('/:hostId/reply', adminReply);

export default router;
