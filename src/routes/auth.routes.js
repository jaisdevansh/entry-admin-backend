import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { Admin } from '../models/admin.model.js';
import { Host } from '../models/Host.js';
import { Staff } from '../models/Staff.js';
import mongoose from 'mongoose';
import { register, login, refresh, logout, forgotPassword, resetPassword, verifyEmail, sendOtp, verifyOtp, completeOnboarding, googleLogin } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validator.middleware.js';
import { registerSchema, loginSchema, refreshTokenSchema, forgotPasswordSchema, resetPasswordSchema, sendOtpSchema, verifyOtpSchema } from '../validators/auth.validator.js';

const router = express.Router();

// ── Username generation for Google users ─────────────────────────────────────
const generateUsername = (name) => {
    const base = (name || 'user').replace(/\s+/g, '').toLowerCase().slice(0, 5);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${base}${random}`;
};
const getUniqueUsername = async (name) => {
    let attempts = 0;
    while (attempts < 10) {
        const username = generateUsername(name);
        const exists = await User.findOne({ username });
        if (!exists) return username;
        attempts++;
    }
    return `user${Date.now().toString().slice(-6)}`;
};

// ── Passport Google Strategy (for web-based OAuth flow) ──────────────────────
// Only initialize if Google OAuth credentials are provided
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:  process.env.NODE_ENV === 'production' 
            ? 'https://test-53pw.onrender.com/api/auth/callback/google'
            : 'http://localhost:3000/api/auth/callback/google',
        scope: ['profile', 'email'],
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            console.log('--- [BACKEND DEBUG] Google Strategy Callback ---');
            const email = profile.emails?.[0]?.value?.toLowerCase();
            console.log('[DEBUG] Google Email acquired:', email);
            const name  = profile.displayName || '';
            const picture = profile.photos?.[0]?.value || '';
            const googleId = profile.id;

        if (!email) {
            console.error('[DEBUG] No email found in Google profile');
            return done(new Error('No email from Google'), null);
        }

        // Find user across all collections in parallel
        console.log('[DEBUG] Searching for user in DB...');
        const [adminUser, hostUser, staffUser, normalUser] = await Promise.all([
            Admin.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }),
            Host.findOne({  email: { $regex: new RegExp(`^${email}$`, 'i') } }),
            Staff.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }),
            User.findOne({  email: { $regex: new RegExp(`^${email}$`, 'i') } }),
        ]);

        let user = adminUser || hostUser || staffUser || normalUser;

        if (!user) {
            console.log('[DEBUG] New user! Provisioning with auto-username...');
            const tempId = new mongoose.Types.ObjectId();
            const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase()
                + tempId.toString().substring(18, 22).toUpperCase();
            const autoUsername = await getUniqueUsername(name);

            user = new User({
                _id: tempId,
                name,
                username: autoUsername,
                email,
                profileImage: picture || undefined,
                emailVerified: true,
                isVerified: true,
                provider: 'google',
                googleId,
                role: 'user',
                bio: '',
                onboardingCompleted: true,   // ✅ No onboarding for Google users
                isActive: true,
                referralCode,
            });
            await user.save();
            console.log(`[DEBUG] User created: ${email} | username: ${autoUsername}`);
        } else {
            console.log('[DEBUG] Existing user found. Role:', user.role);
            // Patch missing fields for existing users
            const updates = {};
            if (!user.profileImage && picture) updates.profileImage = picture;
            if (!user.googleId) updates.googleId = googleId;
            if (!user.username) updates.username = await getUniqueUsername(name || user.name || 'user');
            if (Object.keys(updates).length > 0) {
                await user.constructor.updateOne({ _id: user._id }, { $set: updates });
                Object.assign(user, updates);
            }
        }

        return done(null, user);
    } catch (err) {
        console.error('[DEBUG] Strategy Error:', err.message);
        return done(err, null);
    }
}));
} else {
    console.warn('[Google OAuth] Credentials not configured, Google login disabled');
}

// ── Google OAuth Routes ───────────────────────────────────────────────────────

// Step 1: Redirect user to Google login page
router.get('/google', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(503).json({ success: false, message: 'Google OAuth not configured' });
    }
    console.log('--- [BACKEND DEBUG] GET /api/auth/google hit ---');
    const redirectUri = req.query.redirectUri || 'entry-club://auth';
    const state = Buffer.from(JSON.stringify({ redirectUri })).toString('base64');
    passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next);
});

// Step 2: Google calls back → generate JWT → deep-link back to app
router.get('/callback/google',
    (req, res, next) => {
        console.log('--- [BACKEND DEBUG] Callback hit from Google ---');
        // Handle failed authentication
        if (req.query.error) {
            let redirectUri = 'entry-club://auth';
            if (req.query.state) {
                try {
                    const decoded = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
                    if (decoded.redirectUri) redirectUri = decoded.redirectUri;
                } catch(e) {}
            }
            return res.redirect(`${redirectUri}?error=google_failed`);
        }
        passport.authenticate('google', { session: false })(req, res, next);
    },
    (req, res) => {
        try {
            console.log('--- [BACKEND DEBUG] Handling Final Callback ---');
            const user = req.user;
            
            let redirectUri = 'entry-club://auth';
            if (req.query.state) {
                try {
                    const decoded = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
                    if (decoded.redirectUri) redirectUri = decoded.redirectUri;
                } catch(e) {}
            }

            if (!user) {
                console.error('[DEBUG] No user object in request after passport auth');
                return res.redirect(`${redirectUri}?error=no_user`);
            }

            console.log('[DEBUG] Generating JWT for user:', user.email);
            const token = jwt.sign(
                { userId: user._id, role: user.role, hostId: user.hostId || null },
                process.env.JWT_SECRET || 'supersecretkey123',
                { expiresIn: '7d' }
            );

            const params = new URLSearchParams({
                token,
                role:                user.role || 'user',
                name:                user.name || '',
                email:               user.email || '',
                profileImage:        user.profileImage || '',
                onboardingCompleted: 'true',   // ✅ Google users always skip onboarding
                hostId:              user.hostId?.toString() || '',
                username:            user.username || '',
            });

            const deepLink = `${redirectUri}?${params.toString()}`;
            console.log('[DEBUG] Redirecting back to app via Deep Link:', deepLink.substring(0, 50) + '...');
            return res.redirect(deepLink);
        } catch (err) {
            console.error('[Google Callback] Error:', err.message);
            return res.redirect(`entry-club://auth?error=server_error`);
        }
    }
);

// ── Existing Auth Routes (unchanged) ─────────────────────────────────────────
router.post('/send-otp', validate(sendOtpSchema), sendOtp);
router.post('/verify-otp', validate(verifyOtpSchema), verifyOtp);
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', validate(refreshTokenSchema), refresh);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);
router.get('/verifyemail/:token', verifyEmail);
router.post('/verifyemail', verifyEmail);
router.post('/logout', protect, logout);
router.post('/onboarding', protect, completeOnboarding);
router.post('/google', googleLogin); // Legacy: mobile token-based fallback

export default router;
