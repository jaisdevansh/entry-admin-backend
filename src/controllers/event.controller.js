import { Event } from '../models/Event.js';
import { Report } from '../models/Report.js';
import { Booking } from '../models/booking.model.js';
import { Venue } from '../models/Venue.js';
import { MenuItem } from '../models/MenuItem.js';
import { Gift } from '../models/Gift.js';
import { Floor } from '../models/Floor.js';
import { cacheService } from '../services/cache.service.js';
import { getIO } from '../socket.js';
import { User } from '../models/user.model.js';
import { Host } from '../models/Host.js';
import { bookEventSchema } from '../validators/user.validator.js';

export const createEvent = async (req, res, next) => {
    try {
        console.log(`[createEvent] Creating new event for host: ${req.user.id}`);

        const { 
            title, description, date, startTime, endTime, coverImage, images, 
            houseRules, attendeeCount, floorCount, tickets, status,
            locationVisibility, revealTime, allowNonTicketView, locationData,
            bookingOpenDate
        } = req.body;

        const event = new Event({
            hostId: req.user.id,
            hostModel: req.user.role?.toUpperCase() === 'HOST' ? 'Host' : 'User',
            title,
            description,
            date: new Date(date),
            startTime,
            endTime,
            coverImage,
            images,
            houseRules,
            attendeeCount: attendeeCount || 0,
            floorCount: floorCount || 1,
            locationVisibility: locationVisibility || 'public',
            revealTime: locationVisibility === 'delayed' && revealTime ? new Date(revealTime) : undefined,
            isLocationRevealed: locationVisibility === 'public', // Auto-reveal if public
            allowNonTicketView: allowNonTicketView || false,
            locationData,
            tickets,
            status: status || 'DRAFT',
            bookingOpenDate: bookingOpenDate ? new Date(bookingOpenDate) : undefined
        });

        await event.save();
        console.log(`[createEvent] Event created successfully: ${event._id}`);

        // If directly published, notify
        if (status === 'LIVE') {
            const { sendNotification } = await import('../services/notification.service.js');
            await sendNotification(req.user.id, {
                title: 'Event Published! 🎉',
                message: `Your event "${title}" is now live and accepting bookings.`,
                type: 'SYSTEM'
            });
        }

        return res.status(201).json({
            success: true,
            eventId: event._id,
            message: "Experience Launched Successfully!"
        });
    } catch (error) {
        console.error(`[createEvent] Error:`, error);
        next(error);
    }
};

export const updateEvent = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const updated = await Event.findByIdAndUpdate(eventId, req.body, { new: true });
        return res.status(200).json({ success: true, eventId: updated._id });
    } catch (error) {
        next(error);
    }
};

export const getEventById = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const item = await Event.findById(eventId).lean();
        if (!item) {
            return res.status(404).json({ success: false, message: 'Event not found' });
        }

        // Privacy Masking (Synchronized with user controller)
        let canViewLocation = true;
        
        if (item.locationVisibility === 'hidden') {
            if (!item.isLocationRevealed) canViewLocation = false;
        } else if (item.locationVisibility === 'delayed') {
            const revealTime = item.revealTime ? new Date(item.revealTime) : null;
            const now = new Date();
            if (!item.isLocationRevealed && (!revealTime || now < revealTime)) {
                canViewLocation = false;
            }
        }

        if (!canViewLocation) {
            item.locationData = null;
            item.isLocationMasked = true;
        }

        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
        return res.status(200).json({ success: true, data: item });
    } catch (error) {
        next(error);
    }
};

export const updateEventStatus = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const { status } = req.body;
        const updated = await Event.findByIdAndUpdate(eventId, { status }, { new: true });

        if (status === 'LIVE') {
            const { sendNotification } = await import('../services/notification.service.js');
            await sendNotification(req.user.id, {
                title: 'Event Published! 🎉',
                message: `Your event "${updated.title}" is now live and accepting bookings.`,
                type: 'SYSTEM'
            });
        }

        return res.status(200).json({ success: true, status: updated.status });
    } catch (error) {
        next(error);
    }
};

export const deleteEvent = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        await Event.findByIdAndDelete(eventId);

        return res.status(200).json({ success: true, message: "Event Cancelled" });
    } catch (error) {
        next(error);
    }
};

export const getEvents = async (req, res, next) => {
    try {
        const hostId = req.user.id;
        const CACHE_KEY = `host_events_${hostId}`;
        
        // ⚡ Check cache first
        const cached = await cacheService.get(CACHE_KEY);
        if (cached) return res.status(200).json({ success: true, events: cached });

        const events = await Event.find({ hostId })
            .select('title date startTime coverImage status attendeeCount locationVisibility isLocationRevealed displayPrice')
            .sort({ date: -1 }) // Sort newest first
            .lean();
        
        // ⚡ Cache for 2 minutes
        await cacheService.set(CACHE_KEY, events, 120);
        
        return res.status(200).json({ success: true, events });
    } catch (error) {
        next(error);
    }
};

export const reportEvent = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const { reason, details } = req.body;

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        const existingReport = await Report.findOne({ reportedBy: req.user.id, eventId });
        if (existingReport) {
            return res.status(400).json({ success: false, message: 'You have already reported this event' });
        }

        const report = await Report.create({
            reportedBy: req.user.id,
            eventId,
            reason,
            details
        });

        // Increment event report count and auto-flag/pause if needed
        event.reportCount += 1;
        
        // Auto-pause if more than 5 reports
        if (event.reportCount >= 5 && event.status === 'LIVE') {
            event.status = 'PAUSED';
            // Alert Admin could be added here
        }

        await event.save();
        res.status(201).json({ success: true, message: 'Report submitted successfully' });

    } catch (error) {
        next(error);
    }
};

// [NEW ENDPOINT] Manual Location Reveal Trigger for Host
export const revealEventLocation = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const event = await Event.findOne({ _id: eventId, hostId: req.user.id });
        
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found or unauthorized' });
        }

        if (event.isLocationRevealed) {
            return res.status(400).json({ success: false, message: 'Location is already revealed' });
        }

        event.isLocationRevealed = true;
        await event.save();

        // Broadcast to clients via Socket.io
        import('../socket.js').then(({ getIO }) => {
            const io = getIO();
            if (io) {
                // Anyone viewing the event details page gets real-time override
                io.emit('location_revealed', { eventId: event._id });
            }
        });

        // Trigger push notifications internally via service
        import('../services/notification.service.js').then(async ({ sendNotification }) => {
            // Find all confirmed bookings
            const { Booking } = await import('../models/booking.model.js');
            const bookings = await Booking.find({ 
                eventId: event._id, 
                status: { $in: ['approved', 'active', 'confirmed', 'checked_in'] }
            }).select('userId').lean();
            
            for (const booking of bookings) {
                await sendNotification(
                    booking.userId,
                    'Location Revealed 📍',
                    `The secret location for "${event.title}" is now available. Tap to view.`,
                    'SYSTEM',
                    { type: 'location_reveal', eventId: event._id.toString() }
                );
            }
        });

        res.status(200).json({ success: true, message: 'Location revealed successfully and notifications dispatched' });

    } catch (error) {
        next(error);
    }
};


