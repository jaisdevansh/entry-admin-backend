import { Ticket } from '../models/Ticket.js';

export const createTicket = async (req, res, next) => {
    try {
        const { subject, description, category, priority } = req.body;
        const hostId = req.user.id;

        const ticket = await Ticket.create({
            hostId,
            subject,
            description,
            category,
            priority
        });

        res.status(201).json({
            success: true,
            message: 'Ticket raised successfully',
            data: ticket
        });
    } catch (error) {
        next(error);
    }
};

export const getTickets = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const tickets = await Ticket.find({ hostId })
            .select('subject status priority createdAt')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({
            success: true,
            data: tickets
        });
    } catch (error) {
        next(error);
    }
};

export const getTicketById = async (req, res, next) => {
    try {
        const { ticketId } = req.params;
        const ticket = await Ticket.findOne({ _id: ticketId, hostId: req.user.id })
            .select('subject description status priority category createdAt resolutionNotes')
            .lean();

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        res.status(200).json({
            success: true,
            data: ticket
        });
    } catch (error) {
        next(error);
    }
};
