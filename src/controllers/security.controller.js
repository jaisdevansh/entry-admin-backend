import mongoose from 'mongoose';
import { IssueReport } from '../models/IssueReport.js';
import { Booking } from '../models/booking.model.js';
import { getIO } from '../socket.js';

/**
 * Extracts a readable table label from a composite tableId slug like "69dcf6d6_s42".
 * Returns the seat number or a clean label.
 */
const cleanTableId = (raw) => {
    if (!raw || raw === 'N/A' || raw === '--') return null;
    const trimmed = raw.trim();
    if (trimmed.length <= 10) return trimmed.toUpperCase(); // Already clean
    // Pattern: {hexId}_s{seatNumber} — extract seat number
    const seatMatch = trimmed.match(/_s(\d+)$/i);
    if (seatMatch) return `SEAT ${seatMatch[1]}`;
    // Try splitting by dash/underscore and find shortest non-ObjectId part
    const parts = trimmed.split(/[-_]/);
    const shortPart = parts.find(p => p.length < 8 && /[A-Za-z0-9]/.test(p) && !mongoose.Types.ObjectId.isValid(p));
    if (shortPart) return shortPart.toUpperCase();
    return null; // Garbage — caller should use fallback
};

/**
 * @desc    Submit an issue report (User-side)
 * @route   POST /api/v1/security/reports
 */
export const createIssueReport = async (req, res, next) => {
    try {
        const { eventId, type, message, tableId, zone } = req.body;

        // Duplicate prevention: same zone + type within 5 minutes
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const duplicate = await IssueReport.findOne({
            eventId,
            type,
            zone: zone || 'General',
            status: { $in: ['open', 'in_progress'] },
            createdAt: { $gte: fiveMinutesAgo }
        });
        if (duplicate) {
            return res.status(200).json({ success: true, data: duplicate, message: 'Existing open issue already tracking this incident' });
        }

        // Automatically fetch location from booking if not provided
        let finalTable = tableId;
        let finalZone = zone;

        if (!finalTable || finalTable === 'N/A' || finalTable === '--' || finalTable.trim() === '' || !finalZone) {
            const bookingQuery = { userId: req.user.id };
            if (eventId) bookingQuery.eventId = eventId;

            const booking = await Booking.findOne(bookingQuery)
                .select('tableId ticketType guests')
                .sort({ createdAt: -1 })
                .lean();
                
            if (booking) {
                const rawTable = booking.tableId;
                const parsedTable = cleanTableId(rawTable);
                finalTable = parsedTable || (finalTable && finalTable !== 'N/A' ? finalTable : null);
                finalZone = (booking.ticketType && booking.ticketType.trim() !== '') ? booking.ticketType : (finalZone && finalZone !== 'General' ? finalZone : null);
            }
        }
        // Always clean the final table value before saving
        if (finalTable) {
            const cleaned = cleanTableId(finalTable);
            if (cleaned) finalTable = cleaned;
        }

        const report = await IssueReport.create({
            userId: req.user.id,
            userName: req.user.name || req.user.username || 'Guest', // Denormalize for display
            eventId,
            hostId: req.body.hostId || null,
            type,
            message,
            tableId: finalTable || 'General Entry',
            zone: finalZone || 'Main Floor',
            status: 'open'
        });

        // Emit real-time alert to all security
        try {
            const io = getIO();
            if (io) {
                io.to('security_room').emit('new_issue', {
                    id: report._id,
                    type: report.type,
                    message: report.message,
                    zone: report.zone,
                    tableId: report.tableId,
                    createdAt: report.createdAt
                });
            }

            // Send Push to all Security (New Notification System)
            const { notificationService } = await import('../services/notification.service.js');
            const title = '🚨 Safety Alert';
            const body = `${report.type.toUpperCase()} reported at ${report.zone?.toUpperCase()} Table ${report.tableId}`;
            
            await notificationService.sendToRole('security', title, body, { 
                type: 'issue',
                issueId: report._id.toString() 
            });

            // Record in user's Notification history
            const Notification = (await import('../models/Notification.js')).default;
            await Notification.create({
                userId: req.user.id,
                title: 'Report Received 🚨',
                body: `We have received your report regarding ${report.type}. Security has been notified.`,
                type: 'issue',
                data: { issueId: report._id }
            });
        } catch (err) {
            console.error('[Notification] Failed to alert security:', err.message);
        }

        res.status(201).json({ success: true, data: report });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get all open issues (Security-only)
 * @route   GET /api/v1/security/issues/open
 */
export const getOpenIssues = async (req, res, next) => {
    try {
        // DB-level priority sort using aggregation - no JS sorting loops
        const issues = await IssueReport.aggregate([
            { $match: { status: 'open' } },
            {
                $addFields: {
                    priorityOrder: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$type', 'medical'] }, then: 1 },
                                { case: { $eq: ['$type', 'harassment'] }, then: 2 },
                                { case: { $eq: ['$type', 'fight'] }, then: 3 },
                                { case: { $eq: ['$type', 'unsafe'] }, then: 4 },
                            ],
                            default: 5
                        }
                    }
                }
            },
            { $sort: { priorityOrder: 1, createdAt: -1 } },
            {
                // Try to populate from local users collection (admin/staff/host)
                // If not found (user is in user-backend DB), fall back to stored userName
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userInfo',
                    pipeline: [{ $project: { name: 1, profileImage: 1 } }]
                }
            },
            {
                $addFields: {
                    // Use populated name if found, else use stored userName field
                    displayName: {
                        $cond: [
                            { $gt: [{ $size: '$userInfo' }, 0] },
                            { $arrayElemAt: ['$userInfo.name', 0] },
                            '$userName'
                        ]
                    }
                }
            },
            { $project: { userInfo: 0 } }
        ]);

        res.status(200).json({ success: true, count: issues.length, data: issues });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Respond to an issue (Assign to self)
 * @route   PUT /api/v1/security/issues/:id/respond
 */
export const respondToIssue = async (req, res, next) => {
    try {
        const { id } = req.params;
        const guardId = req.user.id;

        const issue = await IssueReport.findOneAndUpdate(
            { _id: id, status: 'open' },
            { 
                status: 'in_progress', 
                assignedSecurityId: guardId 
            },
            { new: true }
        ).populate('userId', 'name');

        if (!issue) {
            return res.status(400).json({ success: false, message: 'Issue already responded to or invalid' });
        }

        // Notify security team
        try {
            const io = getIO();
            if (io) io.emit('issue_updated', { id, status: 'in_progress' });
        } catch (err) {}

        res.status(200).json({ success: true, data: issue });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Resolve an issue
 * @route   PUT /api/v1/security/issues/:id/resolve
 */
export const resolveIssue = async (req, res, next) => {
    try {
        const { id } = req.params;
        const guardId = req.user.id;

        const issue = await IssueReport.findOneAndUpdate(
            { _id: id, assignedSecurityId: guardId },
            { 
                status: 'resolved', 
                resolvedAt: new Date() 
            },
            { new: true }
        );

        if (!issue) {
            return res.status(404).json({ success: false, message: 'Issue not found or not assigned to you' });
        }

        // Notify security team
        try {
            const io = getIO();
            if (io) io.emit('issue_updated', { id, status: 'resolved' });
        } catch (err) {}

        res.status(200).json({ success: true, data: issue });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get security guard's active issues
 * @route   GET /api/v1/security/issues/my
 */
export const getMyIssues = async (req, res, next) => {
    try {
        const issues = await IssueReport.find({
            assignedSecurityId: req.user.id,
            status: 'in_progress'
        })
        .select('type message zone tableId status createdAt userId')
        .populate('userId', 'name profileImage')
        .sort({ updatedAt: -1 })
        .lean();

        res.status(200).json({ success: true, data: issues });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get security's resolved history
 * @route   GET /api/v1/security/issues/resolved
 */
export const getResolvedHistory = async (req, res, next) => {
    try {
        const issues = await IssueReport.find({
            status: 'resolved'
        })
        .select('type message zone tableId status resolvedAt userId assignedSecurityId')
        .populate('userId', 'name profileImage')
        .sort({ resolvedAt: -1 })
        .limit(50)
        .lean();

        res.status(200).json({ success: true, data: issues });
    } catch (error) {
        next(error);
    }
};
/**
 * @desc    Step 1: Scan and Verify Ticket (Lookup only)
 * @route   POST /api/v1/security/verify-ticket
 */
export const verifyTicketGate = async (req, res, next) => {
    try {
        const { qrPayload } = req.body;
        // Determine host context: If user is "staff" (guard), use their assigned hostId. If "host", use their own id.
        const hostContextId = req.user.role === 'host' ? req.user.id : (req.user.hostId || req.user.assignedHostId);

        if (!qrPayload) {
            return res.status(400).json({ success: false, message: 'Missing scan data' });
        }

        // Search by either QR Payload field or the actual MongoDB ID (since mobile sends bookingId)
        console.log(`[Security Scan] Raw Payload: ${qrPayload}`);

        let targetId = qrPayload;
        
        // 🛠️ SMART EXTRACTION: If payload is composite (STITCH|ID|ZONE|...)
        if (qrPayload.includes('|')) {
            const parts = qrPayload.split('|');
            // Try to find a part that is a valid MongoDB ID (usually the 2nd part)
            const validId = parts.find(p => mongoose.Types.ObjectId.isValid(p));
            if (validId) {
                targetId = validId;
                console.log(`[Security Scan] Extracted Booking ID: ${targetId}`);
            }
        }

        const isObjectId = mongoose.Types.ObjectId.isValid(targetId);
        
        let query = {
            $or: [
                { qrPayload: qrPayload },
                { qrPayload: targetId },
                ...(isObjectId ? [{ _id: targetId }] : [])
            ]
        };

        // Attempt 1: Strict lookup with host context
        let booking = null;
        if (hostContextId) {
            booking = await Booking.findOne({ ...query, hostId: hostContextId }).populate('userId', 'name profileImage email phone').lean();
        }

        // Attempt 2: Flexible lookup if Attempt 1 fails
        if (!booking) {
            booking = await Booking.findOne(query).populate('userId', 'name profileImage email phone').lean();
        }
        
        if (booking && hostContextId && booking.hostId.toString() !== hostContextId.toString()) {
            console.warn(`[Security Warning] Ticket for different host: Guard(${hostContextId}) vs Ticket(${booking.hostId})`);
        }

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Ticket Not Found. Access Denied.' });
        }

        // 🛠️ DATA INTEGRITY & ENHANCED DISPLAY
        const totalGuests = booking.guests || 1;
        const enteredCount = booking.guestsEntered || 0;
        const guestName = booking.userId?.name || 'Guest Member';
        const guestImg = booking.userId?.profileImage || null;

        // Smart Table & Type labels
        let displayType = (booking.ticketType || 'GENERAL').trim().toUpperCase();
        let displayTable = (booking.tableId || 'GENERAL').trim();

        // 🛠️ CLEAN TABLE ID: Remove long Mongo IDs if present in the string
        // If tableId looks like an ObjectId or contains one (69cbbe...), we extract the readable part
        if (displayTable.length > 15) {
            // Priority: Extract anything like V-1, VIP-01, T-5 at the end after an underscore or dash
            const parts = displayTable.split(/[-_]/);
            const shortName = parts.find(p => p.length < 8 && /[A-Za-z0-9]/.test(p) && !mongoose.Types.ObjectId.isValid(p));
            if (shortName) {
                displayTable = shortName.toUpperCase();
            } else {
                // Fallback: If it's just a raw ID, use ticketType info
                displayTable = displayType.includes('VIP') ? 'VIP-AREA' : 'GENERAL';
            }
        } else {
            displayTable = displayTable.toUpperCase();
        }

        if (displayType.includes('VIP')) displayType = 'VIP TABLE';
        if (displayType.includes('COUCH')) displayType = 'PRIVATE COUCH';
        if (displayType.includes('NORMAL') || displayType.includes('GENERAL')) displayType = 'GENERAL ADMISSION';

        const responseData = {
            ...booking,
            ticketType: displayType,
            tableId: displayTable,
            guests: totalGuests,
            enteredCount: enteredCount,
            remainingGuests: Math.max(0, totalGuests - enteredCount),
            guest: {
                name: guestName,
                image: guestImg,
                role: displayType
            }
        };

        console.log(`[Security Audit] Ticket Verified: ${guestName} | Guests: ${enteredCount}/${totalGuests} | Table: ${displayTable}`);

        // If even one person can still enter, we consider it valid for scanning
        const isFullyUsed = enteredCount >= totalGuests || booking.status === 'checked_in';

        if (isFullyUsed) {
            return res.status(400).json({ success: false, message: 'Ticket fully used (All guests checked in)', data: responseData });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Ticket is cancelled', data: responseData });
        }

        res.status(200).json({ success: true, data: responseData });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Step 2: Confirm Entry (Check-in)
 * @route   POST /api/v1/security/confirm-entry
 */
export const confirmCheckIn = async (req, res, next) => {
    try {
        const { bookingId, count = 1 } = req.body;
        const hostContextId = req.user.role === 'host' ? req.user.id : (req.user.hostId || req.user.assignedHostId);

        const booking = await Booking.findOne({ _id: bookingId, hostId: hostContextId });

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const totalGuests = booking.guests || 1;
        const currentEntered = booking.guestsEntered || 0;
        const canTake = totalGuests - currentEntered;
        
        // Don't let them enter more than remaining
        const actualEntry = Math.min(count, canTake);
        
        if (actualEntry <= 0) {
            return res.status(400).json({ success: false, message: 'Booking already fully checked-in' });
        }

        booking.guestsEntered = currentEntered + actualEntry;
        
        // If all have entered, mark entire booking as checked_in
        if (booking.guestsEntered >= totalGuests) {
            booking.status = 'checked_in';
            booking.checkInTime = new Date();
        }

        await booking.save();

        res.status(200).json({ 
            success: true, 
            message: `${actualEntry} guest(s) entered. Total: ${booking.guestsEntered}/${totalGuests}`,
            data: {
                guestsEntered: booking.guestsEntered,
                totalGuests: totalGuests
            }
        });
    } catch (error) {
        next(error);
    }
};
