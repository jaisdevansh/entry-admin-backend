/**
 * twilio.service.js
 * ─────────────────────────────────────────────────────────────
 * Wraps Twilio Verify v2 API for sending and checking SMS OTPs.
 * Uses environment variables:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 *   TWILIO_VERIFY_SERVICE_SID, TWILIO_PHONE_NUMBER
 * ─────────────────────────────────────────────────────────────
 */

import twilio from 'twilio';

// Lazy-init so the app boots even when creds are missing in dev
let client = null;

const getClient = () => {
    if (!client) {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken  = process.env.TWILIO_AUTH_TOKEN;
        if (!accountSid || !authToken) {
            throw new Error('[Twilio] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set in .env');
        }
        client = twilio(accountSid, authToken);
    }
    return client;
};

/**
 * Send an OTP via Twilio Verify to a phone number.
 * @param {string} phoneNumber  E.164 format, e.g. "+919876543210"
 * @returns {Promise<{sid: string, status: string}>}
 */
export const sendSmsOtp = async (phoneNumber) => {
    const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!verifySid) throw new Error('[Twilio] TWILIO_VERIFY_SERVICE_SID not set in .env');

    const verification = await getClient()
        .verify.v2
        .services(verifySid)
        .verifications
        .create({ to: phoneNumber, channel: 'sms' });

    console.log(`[Twilio] OTP sent to ${phoneNumber} | SID: ${verification.sid} | Status: ${verification.status}`);
    return { sid: verification.sid, status: verification.status };
};

/**
 * Verify the OTP code a user entered.
 * @param {string} phoneNumber  E.164 format
 * @param {string} code         6-digit OTP entered by the user
 * @returns {Promise<boolean>}  true = valid, false = invalid/expired
 */
export const verifySmsOtp = async (phoneNumber, code) => {
    const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!verifySid) throw new Error('[Twilio] TWILIO_VERIFY_SERVICE_SID not set in .env');

    const check = await getClient()
        .verify.v2
        .services(verifySid)
        .verificationChecks
        .create({ to: phoneNumber, code });

    console.log(`[Twilio] Verify check for ${phoneNumber}: ${check.status}`);
    return check.status === 'approved';
};

