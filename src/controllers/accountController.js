const { createAuthClient, supabaseAdmin, isConfigured } = require("../config/supabase");
const { randomUUID } = require("node:crypto");
const { UserModel, ROLES } = require("../models/userModel");
const { CallModel } = require("../models/callModel");
const emailService = require("../config/email");
const { normalizeEmail, isEmail, isUuid, validPassword, passwordMessage } = require("../utils/validation");

const login = (role) => async (req, res) => {
    try {
        if (!isConfigured) return res.status(503).json({ success: false, message: "Authentication service not configured." });
        const email = normalizeEmail(req.body?.login_id || req.body?.email);
        const password = req.body?.password;
        if (!isEmail(email) || typeof password !== "string" || !password || password.length > 128) {
            return res.status(400).json({ success: false, message: "A valid login_id (email) and password are required." });
        }
        const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
        if (error || !data?.user || !data?.session) return res.status(401).json({ success: false, message: "Invalid login credentials." });
        const profile = await UserModel.findById(data.user.id);
        if (!profile || profile.role !== role) return res.status(403).json({ success: false, message: `Access denied. This login is for ${role} accounts only.` });
        if (!profile.is_approved) return res.status(403).json({ success: false, message: "Your account is awaiting admin approval." });
        const metadata = data.user.app_metadata || {};
        if (metadata.must_change_password && !(Date.parse(metadata.temporary_password_expires_at) > Date.now())) {
            return res.status(403).json({ success: false, code: "TEMPORARY_PASSWORD_EXPIRED", message: "Your temporary password has expired. Use Forgot password to set a new password." });
        }
        const user = {
            id: profile.id, login_id: data.user.email, email: data.user.email,
            full_name: profile.full_name, role: profile.role, photo_url: profile.photo_url,
            preferred_language: profile.preferred_language, state: profile.state, city: profile.city
        };
        if (role !== ROLES.ADMIN) user.is_call_available = await CallModel.getUserAvailability(profile.id);
        return res.status(200).json({ success: true, message: `${role} login successful.`, data: {
            token: data.session.access_token, refreshToken: data.session.refresh_token, expiresIn: data.session.expires_in,
            must_change_password: metadata.must_change_password === true,
            ...(role === ROLES.ADMIN ? { admin: user } : { user })
        } });
    } catch (error) {
        console.error("Login failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to log in. Please try again." });
    }
};

const recoveryMessage = "If an approved account matches this email, a password reset link will be emailed to it.";
const forgotPassword = (role) => async (req, res) => {
    if (!isConfigured || !emailService.isEmailConfigured) return res.status(503).json({ success: false, message: "Password recovery email service is not configured." });
    const email = normalizeEmail(req.body?.email || req.body?.login_id);
    if (!isEmail(email)) return res.status(400).json({ success: false, message: "A valid email is required." });
    try {
        const profile = await UserModel.findByEmail(email);
        // Keep the same response for unknown, pending, rejected and wrong-role accounts.
        if (profile?.is_approved && profile.role === role) {
            const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "recovery", email });
            if (error || !data?.properties?.hashed_token) throw error || new Error("Recovery token was not generated.");
            const resetUrl = new URL(process.env.CLIENT_RESET_PASSWORD_URL || `${process.env.CLIENT_URL || "http://localhost:3000"}/reset-password`);
            if (!["https:", "http:"].includes(resetUrl.protocol)) throw new Error("Invalid password reset URL.");
            // A fragment keeps the recovery secret out of HTTP access logs/referrers.
            resetUrl.hash = new URLSearchParams({ token_hash: data.properties.hashed_token, role }).toString();
            const content = emailService.buildPasswordResetEmail({ fullName: profile.full_name, resetUrl: resetUrl.href });
            const result = await emailService.sendEmail({ to: profile.email, ...content });
            if (!result.success) console.error("Password recovery email delivery failed.");
        }
    } catch (error) {
        // Do not reveal whether the account exists when a provider call fails.
        console.error("Password recovery failed:", error.message);
    }
    return res.status(200).json({ success: true, message: recoveryMessage });
};

const updatePassword = async (user, password) => {
    const requestId = user.app_metadata?.registration_request_id;
    const token = randomUUID();
    let claimed = false;
    try {
        // Serialize password changes with admin credential resends. Otherwise a
        // resend could overwrite the password the applicant has just chosen.
        if (isUuid(requestId)) {
            claimed = Boolean(await UserModel.claimRegistrationRequest(requestId, token));
            if (!claimed) throw new Error("Credentials are being updated. Please retry.");
        }
        const { data, error: readError } = await supabaseAdmin.auth.admin.getUserById(user.id);
        if (readError || !data?.user) throw readError || new Error("Account not found.");
        const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
            password,
            app_metadata: { ...data.user.app_metadata, must_change_password: false, temporary_password_expires_at: null }
        });
        if (error) throw error;
    } finally {
        if (claimed) await UserModel.releaseRegistrationRequest(requestId, token)
            .catch((error) => console.error("Password lease release failed:", error.message));
    }
};

const resetPassword = (role) => async (req, res) => {
    if (!isConfigured) return res.status(503).json({ success: false, message: "Authentication service not configured." });
    const { token_hash, password } = req.body || {};
    if (!validPassword(password)) return res.status(400).json({ success: false, message: passwordMessage });
    if (typeof token_hash !== "string" || !/^[a-zA-Z0-9_-]{20,512}$/.test(token_hash)) return res.status(400).json({ success: false, message: "A valid password recovery token is required." });
    try {
        const { data, error } = await createAuthClient().auth.verifyOtp({ token_hash, type: "recovery" });
        if (error || !data?.user) return res.status(400).json({ success: false, message: "Reset link is invalid, expired, or already used. Request a new link." });
        const profile = await UserModel.findById(data.user.id);
        if (!profile?.is_approved || profile.role !== role) return res.status(403).json({ success: false, message: "Password recovery is unavailable for this account." });
        await updatePassword(data.user, password);
        return res.status(200).json({ success: true, message: "Password updated. Log in with your new password." });
    } catch (error) {
        console.error("Password reset failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to update password. Request a new reset link and try again." });
    }
};

const changePassword = async (req, res) => {
    const { current_password, password } = req.body || {};
    if (!validPassword(password)) return res.status(400).json({ success: false, message: passwordMessage });
    if (typeof current_password !== "string" || !current_password || current_password.length > 128 || current_password === password) {
        return res.status(400).json({ success: false, message: "Provide your current password and a different new password." });
    }
    try {
        const { data, error } = await createAuthClient().auth.signInWithPassword({ email: req.user.email, password: current_password });
        if (error || data?.user?.id !== req.user.id) return res.status(401).json({ success: false, message: "Current password is incorrect." });
        await updatePassword(data.user, password);
        return res.status(200).json({ success: true, message: "Password updated. Log in with your new password." });
    } catch (error) {
        console.error("Password change failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to update password. Please try again." });
    }
};

module.exports = { login, forgotPassword, resetPassword, changePassword };
