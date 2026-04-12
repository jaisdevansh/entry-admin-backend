import { AdminChat } from '../models/AdminChat.js';
import { getIO } from '../socket.js';
import { User } from '../models/user.model.js';

// ── HOST: get their own chat thread ────────────────────────────────────────
export const getAdminChat = async (req, res, next) => {
    try {
        let chat = await AdminChat.findOne({ hostId: req.user.id });
        if (!chat) {
            // Lazy-create thread
            const host = await User.findById(req.user.id).select('name');
            chat = await AdminChat.create({ hostId: req.user.id, hostName: host?.name || 'Host', messages: [] });
        }
        res.status(200).json({ success: true, data: chat });
    } catch (err) {
        next(err);
    }
};

// ── HOST: send a message to admin ──────────────────────────────────────────
export const hostSendMessage = async (req, res, next) => {
    try {
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

        const host = await User.findById(req.user.id).select('name');
        const msg = { sender: 'host', senderId: req.user.id, content: content.trim() };

        const chat = await AdminChat.findOneAndUpdate(
            { hostId: req.user.id },
            {
                $push: { messages: msg },
                $set: {
                    lastMessage: content.trim(),
                    lastMessageAt: new Date(),
                    hostName: host?.name,
                    status: 'open'
                }
            },
            { upsert: true, new: true }
        );

        const newMsg = chat.messages[chat.messages.length - 1];

        // Emit to admin room for real-time admin panel update
        const io = getIO();
        io.to('admin_room').emit('adminChatMessage', {
            chatId: chat._id,
            hostId: req.user.id,
            hostName: host?.name,
            message: newMsg,
        });

        res.status(200).json({ success: true, data: newMsg });
    } catch (err) {
        next(err);
    }
};

// ── ADMIN: get all host chat threads ───────────────────────────────────────
export const getAllChats = async (req, res, next) => {
    try {
        const chats = await AdminChat.find({})
            .sort({ lastMessageAt: -1 })
            .select('hostId hostName lastMessage lastMessageAt status messages');
        res.status(200).json({ success: true, data: chats });
    } catch (err) {
        next(err);
    }
};

// ── ADMIN: get single host thread ──────────────────────────────────────────
export const getChatByHost = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        const chat = await AdminChat.findOne({ hostId });
        if (!chat) return res.status(404).json({ success: false, message: 'No chat found for this host' });

        // Mark all host messages as read
        await AdminChat.updateOne(
            { hostId },
            { $set: { 'messages.$[msg].read': true } },
            { arrayFilters: [{ 'msg.sender': 'host', 'msg.read': false }] }
        );

        res.status(200).json({ success: true, data: chat });
    } catch (err) {
        next(err);
    }
};

// ── ADMIN: reply to a host ──────────────────────────────────────────────────
export const adminReply = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

        const msg = { sender: 'admin', senderId: req.user.id, content: content.trim() };

        const chat = await AdminChat.findOneAndUpdate(
            { hostId },
            {
                $push: { messages: msg },
                $set: { lastMessage: content.trim(), lastMessageAt: new Date() }
            },
            { new: true }
        );

        if (!chat) return res.status(404).json({ success: false, message: 'Host chat not found' });

        const newMsg = chat.messages[chat.messages.length - 1];

        // Push real-time to the host
        const io = getIO();
        io.to(hostId.toString()).emit('adminReply', { message: newMsg });

        res.status(200).json({ success: true, data: newMsg });
    } catch (err) {
        next(err);
    }
};
