/**
 * tableUtils.js — Production-grade table/zone label utilities
 * ─────────────────────────────────────────────────────────────
 * Handles decoding of composite seat slugs stored in the DB.
 *
 * DB tableId formats we handle:
 *   1. "VIP-01"             → "VIP-01"          (clean, pass-through)
 *   2. "69dcf6d6_s69"       → "SEAT 69"         (composite hostId slug)
 *   3. "69dcf6d695d02c022c26eeb5_s69" → "SEAT 69" (full ObjectId prefix)
 *   4. "N/A", "--", ""      → null (caller uses fallback)
 *   5. Long pure hex string → null (garbage ObjectId)
 *   6. "General Entry"      → null (caller shows "FLOOR")
 */

import mongoose from 'mongoose';

const GARBAGE_VALUES = new Set(['n/a', '--', 'general entry', 'generalentry', 'null', 'undefined', '']);

/**
 * Decodes a raw tableId string into a human-readable label.
 * Returns null if the value is garbage (caller should show "FLOOR").
 */
export const cleanTableId = (raw) => {
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();

    if (GARBAGE_VALUES.has(trimmed.toLowerCase())) return null;

    // Already a clean, short, human-readable value (e.g. "VIP-01", "T-5")
    if (trimmed.length <= 10) return trimmed.toUpperCase();

    // Pattern 1: {anything}_s{seatNumber}  →  SEAT {N}
    // e.g. "69dcf6d695d02c022c26eeb5_s69" → "SEAT 69"
    const seatMatch = trimmed.match(/_s(\d+)$/i);
    if (seatMatch) return `SEAT ${seatMatch[1]}`;

    // Pattern 2: Pure MongoDB ObjectId (24 hex chars) — garbage, no seat info
    if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-f0-9]{24}$/i.test(trimmed)) return null;

    // Pattern 3: Split on delimiter and find first readable segment
    const parts = trimmed.split(/[-_]/);
    const readable = parts.find(
        p => p.length >= 1 && p.length < 8 && /[A-Za-z0-9]/.test(p) && !/^[a-f0-9]{6,}$/i.test(p)
    );
    if (readable) return readable.toUpperCase();

    return null; // Unrecognised format — caller shows fallback
};

/**
 * Normalises a zone/ticketType string for display.
 * Maps verbose ticket types (from booking system) to concise zone labels.
 */
export const cleanZone = (raw) => {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;

    const upper = trimmed.toUpperCase();

    // Known ticket type → zone label mapping
    const MAP = {
        'GENERAL ACCESS ZONE': 'GENERAL',
        'GENERAL ADMISSION':   'GENERAL',
        'GENERAL':             'GENERAL',
        'MAIN FLOOR':          'FLOOR',
        'FLOOR':               'FLOOR',
        'VIP':                 'VIP',
        'VIP TABLE':           'VIP',
        'VVIP':                'VVIP',
        'PRIVATE COUCH':       'COUCH',
        'COUCH':               'COUCH',
        'BALCONY':             'BALCONY',
    };

    if (MAP[upper]) return MAP[upper];
    
    // Return first meaningful word (handles e.g. "Silver Standing Zone")
    const firstWord = upper.split(/\s+/)[0];
    return firstWord || null;
};
