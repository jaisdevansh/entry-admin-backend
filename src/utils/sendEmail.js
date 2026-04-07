import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async (options) => {
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
