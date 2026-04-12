import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { Host } from '../models/Host.js';
import { Staff } from '../models/Staff.js';
import { Admin } from '../models/admin.model.js';
import { Otp } from '../models/otp.model.js';
import admin from '../config/firebase.config.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { registerSchema, loginSchema, refreshTokenSchema, forgotPasswordSchema, resetPasswordSchema, sendOtpSchema, verifyOtpSchema } from '../validators/auth.validator.js';
import sendEmail from '../utils/sendEmail.js';
import { sendSmsOtp, verifySmsOtp } from '../services/twilio.service.js';
import { cacheService } from '../services/cache.service.js';

// ── Username Generation for Google Users ────────────────────────────────────
const generateUsername = (name) => {
    const base = (name || 'user').replace(/\s+/g, '').toLowerCase().slice(0, 5);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${base}${random}`;
};

const getUniqueUsername = async (name) => {
    let username;
    let attempts = 0;
    while (attempts < 10) {
        username = generateUsername(name);
        const exists = await User.findOne({ username });
        if (!exists) return username;
        attempts++;
    }
    // Fallback: use timestamp suffix
    return `user${Date.now().toString().slice(-6)}`;
};

const generateTokens = (user) => {
    const displayName = user.name || (user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : '');
    const accessToken = jwt.sign(
        { userId: user._id, role: user.role, hostId: user.hostId || null },
        process.env.JWT_SECRET || 'supersecretkey123',
        { expiresIn: '15m' }
    );
    const refreshToken = jwt.sign(
        { userId: user._id },
        process.env.JWT_REFRESH_SECRET || 'superrefreshsecret123',
        { expiresIn: '7d' }
    );
    return { accessToken, refreshToken };
};

export const register = async (req, res, next) => {
    try {
        const { error, value } = registerSchema.validate(req.body);
        if (error) return res.status(400).json({ success: false, message: error.details[0].message, data: {} });

        let user = await User.findOne({ email: value.email });
        if (user) return res.status(400).json({ success: false, message: 'Email already exists', data: {} });

        // Create an un-hashed token to send via email
        const verificationTokenRaw = crypto.randomBytes(20).toString('hex');
        const verificationTokenHashed = crypto
            .createHash('sha256')
            .update(verificationTokenRaw)
            .digest('hex');

        user = new User({
            name: value.name,
            email: value.email,
            password: value.password,
            phone: value.phone,
            role: 'user',
            emailVerified: false,
            verificationToken: verificationTokenHashed,
            verificationTokenExpire: Date.now() + 24 * 60 * 60 * 1000 // 24 hours expiry
        });

        user.referralCode = Math.random().toString(36).substring(2, 8).toUpperCase() + user._id.toString().substring(18, 22).toUpperCase();
        await user.save();

        const verifyUrl = `${req.protocol}://${req.get('host')}/auth/verifyemail/${verificationTokenRaw}`;

        const message = `Welcome to Entry Club! \n\nPlease click on the link below to verify your email address: \n\n ${verifyUrl} \n\n Or use this token in the app: ${verificationTokenRaw}`;

        sendEmail({
            email: user.email,
            subject: 'Email Verification - Entry Club',
            message
        }).catch(err => {
            console.error('Background Email sending failed:', err.message);
        });

        res.status(201).json({
            success: true,
            message: 'User registered successfully. A verification email is being sent.',
            data: {}
        });

    } catch (err) {
        next(err);
    }
};

export const sendOtp = async (req, res, next) => {
    try {
        let { identifier } = req.body; 
        if (!identifier) return res.status(400).json({ success: false, message: 'Identifier required' });

        identifier = identifier.trim().toLowerCase();
        const isEmail = identifier.includes('@');

        if (isEmail) {
            // ── EMAIL PATH: generate OTP locally and send via email ──────────
            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Respond instantly, dispatch in background
            res.status(200).json({ 
                success: true, 
                message: 'OTP sequence initiated', 
                data: { type: 'email' } 
            });

            setTimeout(async () => {
                try {
                    await Otp.findOneAndUpdate(
                        { identifier }, 
                        { otp: otpCode, createdAt: new Date() }, 
                        { upsert: true, new: true, setDefaultsOnInsert: true }
                    );
                    console.log(`[AUTH] Email OTP saved for ${identifier}`);
                    const emailMsg = `Your Entry Club one-time password is: ${otpCode}. It will expire in 5 minutes.`;
                    sendEmail({ email: identifier, subject: 'Your Login OTP - Entry Club', message: emailMsg })
                        .then(() => console.log(`[AUTH] OTP Email sent to ${identifier}`))
                        .catch(err => console.error('[AUTH] Background OTP Email failed:', err.message));
                } catch (err) {
                    console.error('[AUTH] Background email OTP failed:', err.message);
                }
            }, 0);

        } else {
            // ── PHONE PATH ────────────────────────────────────────────────────
            const rawPhone = identifier.replace(/\s/g, '');
            const e164Phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;

            // ⚡ PRODUCTION-READY: Use env variable to control Twilio bypass
            const useTwilioBypass = process.env.TWILIO_BYPASS === 'true';
            
            if (useTwilioBypass) {
                // 🔧 BYPASS MODE: Use local DB OTP (for testing/development)
                const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
                await Otp.findOneAndUpdate(
                    { identifier: e164Phone },
                    { otp: otpCode, createdAt: new Date() },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
                console.log(`[AUTH BYPASS] Phone OTP for ${e164Phone}: ${otpCode}`);
                return res.status(200).json({
                    success: true,
                    message: 'OTP sent (bypass mode)',
                    data: { type: 'phone', hint: otpCode }
                });
            }

            // 🔒 PRODUCTION: Use Twilio Verify with retry logic
            try {
                await sendSmsOtp(e164Phone);
                console.log(`[AUTH] Twilio OTP sent to ${e164Phone}`);
                res.status(200).json({ 
                    success: true, 
                    message: 'OTP sent to your phone via SMS', 
                    data: { type: 'phone' } 
                });
            } catch (twilioErr) {
                console.error('[AUTH] Twilio sendSmsOtp failed:', twilioErr.message);
                
                // Fallback to DB OTP if Twilio fails (graceful degradation)
                const fallbackOtp = Math.floor(100000 + Math.random() * 900000).toString();
                await Otp.findOneAndUpdate(
                    { identifier: e164Phone },
                    { otp: fallbackOtp, createdAt: new Date() },
                    { upsert: true, new: true }
                );
                console.log(`[AUTH FALLBACK] Using DB OTP for ${e164Phone}: ${fallbackOtp}`);
                
                return res.status(200).json({ 
                    success: true, 
                    message: 'OTP sent successfully', 
                    data: { type: 'phone', hint: fallbackOtp }
                });
            }
        }

    } catch (err) {
        next(err);
    }
};

export const verifyOtp = async (req, res, next) => {
    try {
        const { error, value } = verifyOtpSchema.validate(req.body);
        if (error) return res.status(400).json({ success: false, message: error.details[0].message, data: {} });

        const { identifier, otp, idToken } = value;
        const isEmail = identifier.includes('@');
        let verified = false;

        if (!isEmail) {
            // ── PHONE PATH ────────────────────────────────────────────────────
            const rawPhone = identifier.replace(/\s/g, '');
            const e164Phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;

            // ⚡ PRODUCTION-READY: Use env variable to control Twilio bypass
            const useTwilioBypass = process.env.TWILIO_BYPASS === 'true';
            
            if (useTwilioBypass) {
                // 🔧 BYPASS MODE: Check against local DB OTP
                const currentOtp = await Otp.findOne({ identifier: e164Phone, otp });
                if (currentOtp) {
                    verified = true;
                    Otp.deleteOne({ _id: currentOtp._id }).catch(e => console.error('OTP Burn Error:', e.message));
                } else {
                    return res.status(401).json({ success: false, message: 'Invalid or expired OTP', data: {} });
                }
            } else {
                // 🔒 PRODUCTION: Verify via Twilio with fallback
                try {
                    verified = await verifySmsOtp(e164Phone, otp);
                    if (!verified) {
                        // Try DB fallback if Twilio says invalid
                        const dbOtp = await Otp.findOne({ identifier: e164Phone, otp });
                        if (dbOtp) {
                            verified = true;
                            Otp.deleteOne({ _id: dbOtp._id }).catch(e => console.error('OTP Burn Error:', e.message));
                        } else {
                            return res.status(401).json({ success: false, message: 'Invalid or expired OTP', data: {} });
                        }
                    }
                } catch (twilioErr) {
                    console.error('[AUTH] Twilio verifySmsOtp error:', twilioErr.message);
                    // Fallback to DB OTP check
                    const dbOtp = await Otp.findOne({ identifier: e164Phone, otp });
                    if (dbOtp) {
                        verified = true;
                        Otp.deleteOne({ _id: dbOtp._id }).catch(e => console.error('OTP Burn Error:', e.message));
                    } else {
                        return res.status(500).json({ success: false, message: 'OTP verification service error. Please try again.' });
                    }
                }
            }
        } else {
            // ── EMAIL PATH: local OTP model check ───────────────────────────
            const currentOtp = await Otp.findOne({ identifier: identifier.toLowerCase(), otp });

            if (currentOtp) {
                verified = true;
                Otp.deleteOne({ _id: currentOtp._id }).catch(e => console.error('OTP Burn Error:', e.message));
            } else {
                return res.status(401).json({ success: false, message: 'Invalid or expired OTP', data: {} });
            }
        }

        if (!verified) {
            return res.status(401).json({ success: false, message: 'Verification failed', data: {} });
        }

        const identifierLower = identifier.toLowerCase();
        const whitelistEmail = 'entryclubindia@gmail.com';
        const whitelistPhone = '7772828027';
        
        let user = null;

        console.log('[Auth Debug] Attempting Login for:', identifierLower);

        // 🔒 STRICT ADMIN WHITELIST: Only these two can EVER have the ADMIN role
        const isAuthorizedAdmin = (identifierLower === whitelistEmail) || (identifierLower.replace(/\s/g, '').endsWith(whitelistPhone));

        if (isAuthorizedAdmin) {
            const isAdminPhone = identifierLower.replace(/\s/g, '').endsWith(whitelistPhone);
            user = await Admin.findOne(isAdminPhone ? { phone: { $regex: new RegExp(`${whitelistPhone}$`) } } : { email: whitelistEmail });
            
            if (!user) {
                // Auto-provision if authorized but doesn't exist in Admin model yet
                user = new Admin({
                    name: 'Stitch Master Admin',
                    username: 'admin_' + whitelistPhone,
                    email: isAdminPhone ? 'masteradmin@entryclub.com' : whitelistEmail,
                    phone: isAdminPhone ? `+91${whitelistPhone}` : undefined,
                    role: 'ADMIN',
                    isActive: true,
                    emailVerified: true
                });
                await user.save();
            }
        }

        // ⚡ HIGH-PERFORMANCE PARALLEL LOOKUP
        if (!user) {
            const isEmail = identifier.includes('@');
            const searchPhoneRaw = !isEmail ? identifier.replace(/\s/g, '') : null;
            const phoneBase = searchPhoneRaw ? searchPhoneRaw.slice(-10) : null; // Get last 10 digits
            
            const query = isEmail 
                ? { email: { $regex: new RegExp(`^${identifierLower}$`, 'i') } }
                : { phone: { $regex: new RegExp(`${phoneBase}$`) } };

            const lookups = [
                isAuthorizedAdmin ? Admin.findOne(query) : Promise.resolve(null), // Only check admin DB if authorized
                Host.findOne(query),
                Staff.findOne(query),
                User.findOne(query)
            ];
            
            const results = await Promise.all(lookups);
            user = results.find(r => r !== null);
        }

        if (!user) {
            // New User: Create with all defaults in one shot
            const tempId = new mongoose.Types.ObjectId();
            const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase() + tempId.toString().substring(18, 22).toUpperCase();
            
            const userPayload = {
                _id: tempId,
                name: '',
                emailVerified: isEmail,
                role: 'user',
                onboardingCompleted: false,
                isActive: true,
                referralCode
            };
            if (isEmail) userPayload.email = identifierLower;
            if (!isEmail) userPayload.phone = identifier;

            user = new User(userPayload);
            await user.save();
        }

        if (!user.isActive) {
            return res.status(403).json({ success: false, message: 'Your account has been deactivated', data: {} });
        }

        const { accessToken, refreshToken } = generateTokens(user);

        // Atomic update for refreshtoken
        await user.constructor.updateOne({ _id: user._id }, { $set: { refreshToken } });

        let message = 'Login successful';
        if (user.role === 'HOST') {
            if (user.hostStatus === 'INVITED') message = 'ONBOARDING_REQUIRED';
            else if (user.hostStatus === 'KYC_PENDING') message = 'WAITING_APPROVAL';
            else if (user.hostStatus === 'REJECTED') message = 'REJECTED';
        }

        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 30 * 24 * 60 * 60 * 1000 
        });

        res.status(200).json({
            success: true,
            message,
            data: {
                id: user._id,
                name: user.name || (user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : ''),
                email: user.email,
                role: user.role,
                staffRole: user.staffType || null, // Keeping for backward compatibility temporarily
                hostId: user.hostId || null,
                profileImage: user.profileImage,
                hostStatus: user.hostStatus || null,
                onboardingCompleted: (user.role && user.role.toLowerCase() !== 'user') ? true : (user.onboardingCompleted ?? false),
                accessToken,
                refreshToken
            }
        });
    } catch (err) {
        next(err);
    }
};

// Deprecated old login method (can be safely left alone or removed)
export const login = async (req, res, next) => {
    res.status(400).json({ success: false, message: 'Deprecated. Use OTP flow.' });
};

export const refresh = async (req, res, next) => {
    try {
        const token = req.body.token || (req.cookies && req.cookies.refreshToken);

        const { error } = refreshTokenSchema.validate({ token });
        if (error || !token) return res.status(400).json({ success: false, message: 'Refresh token required', data: {} });

        const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || 'superrefreshsecret123');
        
        let user = await Admin.findById(decoded.userId);
        if (!user) user = await Host.findById(decoded.userId);
        if (!user) user = await Staff.findById(decoded.userId);
        if (!user) user = await User.findById(decoded.userId);

        if (!user || user.refreshToken !== token) {
            return res.status(403).json({ success: false, message: 'Invalid or expired refresh token', data: {} });
        }

        const displayName = user.name || (user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : '');
        const accessToken = jwt.sign(
            { userId: user._id, role: user.role, hostId: user.hostId || null },
            process.env.JWT_SECRET || 'supersecretkey123',
            { expiresIn: '15m' }
        );

        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.status(200).json({ success: true, message: 'Token refreshed', data: { accessToken, role: user.role, hostId: user.hostId || null } });
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid refresh token', data: {} });
    }
};

export const logout = async (req, res, next) => {
    try {
        if (req.user && req.user.id) {
            const { id, role } = req.user;
            const normalizedRole = role?.toUpperCase();
            
            // Atomic clearance in the correct collection
            if (normalizedRole === 'ADMIN' || normalizedRole === 'SUPERADMIN') {
                await Admin.findByIdAndUpdate(id, { $set: { refreshToken: null } });
            } else if (normalizedRole === 'HOST') {
                await Host.findByIdAndUpdate(id, { $set: { refreshToken: null } });
            } else if (['STAFF', 'WAITER', 'SECURITY'].includes(normalizedRole)) {
                await Staff.findByIdAndUpdate(id, { $set: { refreshToken: null } });
            } else {
                await User.findByIdAndUpdate(id, { $set: { refreshToken: null } });
            }
        }
        res.clearCookie('accessToken');
        res.status(200).json({ success: true, message: 'Logout successful', data: {} });
    } catch (err) {
        next(err);
    }
};

// Staff/Host password-based login (no OTP)
export const staffLogin = async (req, res, next) => {
    try {
        const { email, phone, password } = req.body;

        if (!password || (!email && !phone)) {
            return res.status(400).json({ success: false, message: 'Email/phone and password required' });
        }

        const query = email ? { email: email.toLowerCase() } : { phone };

        // Since Host, Staff, Admin, and User are separate, query them sequentially
        let user = await Admin.findOne(query);
        if (!user) {
            user = await Host.findOne(query);
        }
        if (!user) {
            user = await Staff.findOne(query);
        }
        if (!user) {
            user = await User.findOne(query);
        }

        if (!user || !user.password) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (!['STAFF', 'HOST', 'ADMIN', 'SUPERADMIN', 'waiter', 'security', 'staff', 'host', 'admin', 'superadmin'].includes(user.role?.toUpperCase())) {
            return res.status(403).json({ success: false, message: 'Access denied. This login is for staff/hosts only.' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (!user.isActive) {
            return res.status(403).json({ success: false, message: 'Your account has been deactivated.' });
        }

        const { accessToken, refreshToken } = generateTokens(user);
        user.refreshToken = refreshToken;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                hostId: user.hostId || null,
                preferredZone: user.preferredZone || user.staffType,
                profileImage: user.profileImage,
                accessToken,
                refreshToken
            }
        });
    } catch (err) {
        next(err);
    }
};

export const forgotPassword = async (req, res, next) => {
    try {
        const { error, value } = forgotPasswordSchema.validate(req.body);
        if (error) return res.status(400).json({ success: false, message: error.details[0].message, data: {} });

        const user = await User.findOne({ email: value.email });
        if (!user) {
            return res.status(200).json({ success: true, message: 'If that email exists, a password reset token has been generated.', data: {} });
        }

        const resetToken = crypto.randomBytes(20).toString('hex');

        user.resetPasswordToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

        await user.save({ validateBeforeSave: false });

        const resetUrl = `${req.protocol}://${req.get('host')}/api/v1/auth/resetpassword/${resetToken}`;

        const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please make a PUT or POST request to: \n\n ${resetUrl} \n\n Or use this token in the app: ${resetToken}`;

        try {
            // Send via email - Non-blocking background task
            sendEmail({
                email: user.email,
                subject: 'Password Reset Token',
                message
            }).catch(err => console.error('[AUTH] Background Reset Email failed:', err.message));

            res.status(200).json({
                success: true,
                message: 'Password reset email sent',
                data: {}
            });
        } catch (err) {
            console.error('Email sending failed:', err);
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            await user.save({ validateBeforeSave: false });
            return res.status(500).json({ success: false, message: 'Email could not be sent', data: {} });
        }
    } catch (err) {
        next(err);
    }
};

export const resetPassword = async (req, res, next) => {
    try {
        const { error, value } = resetPasswordSchema.validate(req.body);
        if (error) return res.status(400).json({ success: false, message: error.details[0].message, data: {} });

        const resetPasswordToken = crypto
            .createHash('sha256')
            .update(value.resetToken)
            .digest('hex');

        const user = await User.findOne({
            resetPasswordToken,
            resetPasswordExpire: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token', data: {} });
        }

        user.password = value.newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        user.refreshToken = null;
        await user.save();

        res.status(200).json({ success: true, message: 'Password reset successful. Please login again.', data: {} });
    } catch (err) {
        next(err);
    }
};

export const verifyEmail = async (req, res, next) => {
    try {
        const token = req.params.token || req.body.token;

        if (!token) {
            return res.status(400).json({ success: false, message: 'Verification token is required', data: {} });
        }

        const verificationToken = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const user = await User.findOne({
            verificationToken,
            verificationTokenExpire: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ success: false, message: 'Invalid or expired verification token', data: {} });
        }

        user.emailVerified = true;
        user.verificationToken = undefined;
        user.verificationTokenExpire = undefined;
        await user.save({ validateBeforeSave: false });

        res.status(200).json({ success: true, message: 'Email verified successfully. Please login.', data: {} });
    } catch (err) {
        next(err);
    }
}

export const completeOnboarding = async (req, res, next) => {
    try {
        const { name, username, gender, profileImage } = req.body;
        
        if (!username) {
            return res.status(400).json({ success: false, message: 'Username is mandatory' });
        }

        const usernameLowercase = username.toLowerCase().trim();

        // Check if username is already taken by another user
        const existingUsername = await User.findOne({ 
            username: usernameLowercase, 
            _id: { $ne: req.user.id } 
        });

        if (existingUsername) {
            return res.status(400).json({ success: false, message: 'Username is already taken' });
        }

        // ⚡ Role-Aware Lookup (Admin, Host, Staff, or User)
        let user = await Admin.findById(req.user.id) ||
                   await Host.findById(req.user.id) ||
                   await Staff.findById(req.user.id) ||
                   await User.findById(req.user.id);

        if (!user) {
            console.error('[Onboarding] ID not found in ANY collection:', req.user.id);
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.name = name || user.name;
        user.username = usernameLowercase;
        if (gender !== undefined) user.gender = gender;
        if (profileImage !== undefined) user.profileImage = profileImage;
        user.onboardingCompleted = true;

        await user.save();

        // 🚨 CRITICAL: Invalidate backend profile cache immediately so home dashboard fetches real name!
        await cacheService.delete(cacheService.formatKey('profile', req.user.id));

        res.status(200).json({
            success: true,
            message: 'Onboarding completed',
            data: {
                id: user._id,
                name: user.name,
                onboardingCompleted: user.onboardingCompleted,
                profileImage: user.profileImage
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /auth/google
 * Accepts a Google OAuth access_token from the mobile client,
 * verifies it via Google's userinfo endpoint, and returns app JWT tokens.
 */
export const googleLogin = async (req, res, next) => {
    try {
        const { access_token } = req.body;
        console.log('\n--- [BACKEND DEBUG] Google Login Attempt ---');
        console.log('[DEBUG] Access Token (first 15 chars):', access_token ? access_token.substring(0, 15) + '...' : 'NONE');
        
        if (!access_token) {
            console.error('[DEBUG] Validation Failure: No access_token provided in request body');
            return res.status(400).json({ success: false, message: 'Google access_token required' });
        }

        // Verify with Google and get profile
        console.log('[DEBUG] Calling Google UserInfo endpoint...');
        const googleRes = await fetch(
            `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${access_token}`
        );

        if (!googleRes.ok) {
            const errBody = await googleRes.text();
            console.error('[DEBUG] Google Verification FAILED');
            console.error('[DEBUG] Status Code:', googleRes.status);
            console.error('[DEBUG] Error Body:', errBody);
            return res.status(401).json({ success: false, message: 'Invalid Google token' });
        }

        const profile = await googleRes.json();
        const { email, name, picture, sub: googleId } = profile;
        console.log('[Backend] Google profile acquired for email:', email);

        if (!email) {
            console.error('[Backend] Google profile missing email');
            return res.status(401).json({ success: false, message: 'Google did not return an email' });
        }

        const emailLower = email.toLowerCase();

        // Parallel lookup across all roles
        const [adminUser, hostUser, staffUser, normalUser] = await Promise.all([
            Admin.findOne({ email: { $regex: new RegExp(`^${emailLower}$`, 'i') } }),
            Host.findOne({ email: { $regex: new RegExp(`^${emailLower}$`, 'i') } }),
            Staff.findOne({ email: { $regex: new RegExp(`^${emailLower}$`, 'i') } }),
            User.findOne({ email: { $regex: new RegExp(`^${emailLower}$`, 'i') } }),
        ]);

        let user = adminUser || hostUser || staffUser || normalUser;

        if (!user) {
            // New Google user — auto-provision with username, skip onboarding
            const tempId = new mongoose.Types.ObjectId();
            const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase()
                + tempId.toString().substring(18, 22).toUpperCase();
            const autoUsername = await getUniqueUsername(name || 'user');

            user = new User({
                _id: tempId,
                name: name || '',
                username: autoUsername,
                email: emailLower,
                profileImage: picture || undefined,
                emailVerified: true,
                isVerified: true,
                provider: 'google',
                googleId,
                role: 'user',
                bio: '',
                onboardingCompleted: true,   // ✅ Skip onboarding for Google users
                isActive: true,
                referralCode,
            });
            await user.save();
            console.log(`[Google Auth] New user created: ${emailLower} | username: ${autoUsername}`);
        } else {
            // Existing user — update Google fields if missing
            const updates = {};
            if (!user.profileImage && picture) updates.profileImage = picture;
            if (!user.googleId) updates.googleId = googleId;
            if (!user.username) updates.username = await getUniqueUsername(name || user.name || 'user');
            if (Object.keys(updates).length > 0) {
                await user.constructor.updateOne({ _id: user._id }, { $set: updates });
                Object.assign(user, updates);
            }
        }

        if (!user.isActive) {
            return res.status(403).json({ success: false, message: 'Your account has been deactivated' });
        }

        const { accessToken, refreshToken } = generateTokens(user);
        await user.constructor.updateOne({ _id: user._id }, { $set: { refreshToken } });

        res.status(200).json({
            success: true,
            message: 'Google login successful',
            data: {
                id: user._id,
                name: user.name || name,
                email: user.email,
                role: user.role,
                staffRole: user.staffType || null,
                hostId: user.hostId || null,
                profileImage: user.profileImage || picture,
                hostStatus: user.hostStatus || null,
                username: user.username || null,
                onboardingCompleted: true,   // Google users always skip onboarding
                accessToken,
                refreshToken,
            }
        });
    } catch (err) {
        next(err);
    }
};
