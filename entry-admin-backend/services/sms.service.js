/**
 * sms.service.js
 * ─────────────────────────────────────────────────────────────
 * Wraps 2Factor API for sending and checking SMS OTPs.
 * Uses API key for authentication.
 * ─────────────────────────────────────────────────────────────
 */

const API_KEY = process.env.TWO_FACTOR_API_KEY || 'd9f99e52-39cd-11f1-9800-0200cd936042';
const BASE_URL = 'https://2factor.in/API/V1';

/**
 * Send an OTP via 2factor to a phone number.
 * @param {string} phoneNumber  E.164 format, e.g. "+919876543210"
 * @returns {Promise<{sid: string, status: string}>}
 */
export const sendSmsOtp = async (phoneNumber) => {
    // 2factor usually works best with plain numbers or E.164 without the '+'
    const cleanPhone = phoneNumber.replace('+', ''); 

    const url = `${BASE_URL}/${API_KEY}/SMS/${cleanPhone}/AUTOGEN`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.Status !== 'Success') {
        throw new Error(`[2Factor] Error sending OTP: ${data.Details}`);
    }

    console.log(`[2Factor] OTP sent to ${cleanPhone} | Session: ${data.Details}`);
    return { sid: data.Details, status: data.Status };
};

/**
 * Verify the OTP code a user entered.
 * @param {string} phoneNumber  E.164 format
 * @param {string} code         6-digit OTP entered by the user
 * @returns {Promise<boolean>}  true = valid, false = invalid/expired
 */
export const verifySmsOtp = async (phoneNumber, code) => {
    const cleanPhone = phoneNumber.replace('+', '');
    
    // VERIFY3 API endpoint
    const url = `${BASE_URL}/${API_KEY}/SMS/VERIFY3/${cleanPhone}/${code}`;

    const response = await fetch(url);
    const data = await response.json();

    console.log(`[2Factor] Verify check for ${cleanPhone}: ${data.Status} - ${data.Details}`);
    
    // According to 2factor documentation for VERIFY3, Status is 'Success' if matched
    return data.Status === 'Success' && data.Details === 'OTP Matched';
};
