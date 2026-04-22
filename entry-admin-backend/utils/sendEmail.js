import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

// Only initialize Resend if API key is provided
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const sendEmail = async (options) => {
    if (!resend) {
        console.warn('[RESEND] API key not configured, skipping email send');
        return { id: 'skipped', message: 'Resend API key not configured' };
    }
    
    try {
        const { data, error } = await resend.emails.send({
            from: 'Entry Club <onboarding@resend.dev>', // Resend uses this for testing if no domain is verified
            to: options.email,
            subject: options.subject,
            text: options.message,
        });

        if (error) {
            console.error('[RESEND] API Error:', error);
            throw new Error(error.message);
        }

        console.log('[RESEND] Email sent successfully:', data.id);
        return data;

    } catch (err) {
        console.error('[RESEND] Delivery failed:', err.message);
        throw err;
    }
};

export default sendEmail;
