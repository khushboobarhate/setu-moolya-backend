const { findRegistrationAccount, linkPendingProfile } = require("../services/registrationAccount");
const { randomUUID, randomBytes } = require("node:crypto");
const { supabaseAdmin, isConfigured } = require("../config/supabase");
const { UserModel, ROLES, REG_STATUS } = require("../models/userModel");
const emailService = require("../config/email");
const { CallModel } = require("../models/callModel");
const { CropModel } = require("../models/cropModel");
const { login } = require("./accountController");
const { pagination, isUuid, normalizeEmail, isEmail, text } = require("../utils/validation");

const adminLogin = login(ROLES.ADMIN);
const getAdminProfile = (req, res) => res.status(200).json({ success: true, data: { id: req.user.id, email: req.user.email, full_name: req.user.profile.full_name, role: req.user.role, is_approved: req.user.is_approved, must_change_password: req.user.must_change_password } });
const publicRequest = ({ review_token, review_started_at, ...request }) => ({
    ...request, is_processing: Boolean(review_token && Date.parse(review_started_at) > Date.now() - 10 * 60 * 1000)
});
const applicantRole = (role) => [ROLES.FARMER, ROLES.BUYER].includes(role);

const getDashboard = async (req, res) => {
    const paging = pagination(req.query);
    const { role, status = REG_STATUS.PENDING } = req.query;
    if (!paging || role && !applicantRole(role) || ![...Object.values(REG_STATUS), "all"].includes(status)) {
        return res.status(400).json({ success: false, message: "Use role farmer/buyer, status pending/approved/rejected/all, page >= 1 and limit 1–100." });
    }
    try {
        const result = await UserModel.listRegistrationRequests({ role: role || null, status: status === "all" ? null : status, ...paging });
        const requests = result.requests.map(publicRequest);
        return res.status(200).json({ success: true, data: {
            requests,
            ...(status === REG_STATUS.PENDING ? { pending_requests: requests } : {}),
            pagination: { total: result.total, page: result.page, totalPages: result.totalPages, limit: paging.limit }
        } });
    } catch (error) {
        console.error("Admin dashboard failed:", error.message);
        return res.status(500).json({ success: false, message: "Failed to fetch registration requests." });
    }
};

// A database lease also prevents approve/reject/resend races across processes.
const review = (action) => async (req, res) => {
    if (!isConfigured) return res.status(503).json({ success: false, message: "Database service not configured." });
    if (!isUuid(req.params.requestId)) return res.status(400).json({ success: false, message: "Invalid registration request ID." });
    const token = randomUUID();
    let claimed = false;
    try {
        const request = await UserModel.findRegistrationRequestById(req.params.requestId);
        if (!request) return res.status(404).json({ success: false, message: "Registration request not found." });
        const locked = await UserModel.claimRegistrationRequest(request.id, token);
        if (!locked) return res.status(409).json({ success: false, message: "This request is being processed. Refresh its status before retrying." });
        claimed = true;
        return await action(req, res, locked, token);
    } catch (error) {
        console.error("Admin review failed:", error.message);
        return res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "This email already has an active registration or account." : "Unable to process registration. Refresh the request status before retrying." });
    } finally {
        if (claimed) await UserModel.releaseRegistrationRequest(req.params.requestId, token)
            .catch((error) => console.error("Review lease release failed:", error.message));
    }
};

const temporaryCredentials = () => {
    const hours = Number(process.env.TEMP_PASSWORD_HOURS || 48);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error("TEMP_PASSWORD_HOURS must be between 1 and 168.");
    return { password: `aA1!${randomBytes(24).toString("base64url")}`, expiresAt: new Date(Date.now() + hours * 3600000).toISOString() };
};

const deliverCredentials = async (request, userId, credentials, token, res) => {
    const content = emailService.buildApprovalEmail({
        fullName: request.full_name, role: request.role, loginId: request.approved_login_email || request.email,
        password: credentials.password, expiresAt: credentials.expiresAt,
        loginUrl: process.env.CLIENT_LOGIN_URL || `${process.env.CLIENT_URL || "http://localhost:3000"}/login`
    });
    let sent = false;
    try {
        const result = await emailService.sendEmail({ to: request.email, ...content });
        sent = result.success;
    } catch (error) {
        console.error("Credential email failed:", error.message);
    }
    await UserModel.updateReviewedRequest(request.id, token, {
        credentials_email_status: sent ? "sent" : "failed",
        credentials_email_sent_at: sent ? new Date().toISOString() : null
    });
    return res.status(200).json({ success: true,
        message: sent ? "Registration approved. Temporary credentials were accepted by the email service."
            : "Registration approved, but the credential email failed. Use Send credentials to retry.",
        data: {
            request_id: request.id, user_id: userId, login_id: request.approved_login_email || request.email,
            role: request.role, full_name: request.full_name, status: REG_STATUS.APPROVED,
            email_sent: sent, credentials_email_status: sent ? "sent" : "failed", can_resend_credentials: !sent
        }
    });
};

const approveRequest = review(async (req, res, request, token) => {
    if (request.status !== REG_STATUS.PENDING) return res.status(409).json({ success: false, message: `Request is already ${request.status}. Use Send credentials to retry an unsent credential email.` });
    if (!applicantRole(request.role) || !isEmail(request.email)) return res.status(400).json({ success: false, message: "A farmer/buyer role and valid contact email are required. Update the request email before approval." });
    if (!emailService.isEmailConfigured) return res.status(503).json({ success: false, message: "Configure SMTP email before approving registrations." });
    const credentials = temporaryCredentials();
    let profile = await findRegistrationAccount(request);
    // Keep linked accounts after failures: the SQL approval might have committed
    // before a network error, and pending accounts can be recovered on retry.
    if (profile) {
        // Recover an account left by an interrupted approval, without creating a duplicate.
        if (profile.is_approved || profile.email !== request.email) throw new Error("Existing account does not match the pending request.");
        const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
            password: credentials.password,
            app_metadata: { role: request.role, registration_request_id: request.id, must_change_password: true, temporary_password_expires_at: credentials.expiresAt, session_version: randomUUID() }
        });
        if (error) throw error;
    } else {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email: request.email, password: credentials.password, email_confirm: true,
            app_metadata: { role: request.role, registration_request_id: request.id, must_change_password: true, temporary_password_expires_at: credentials.expiresAt, session_version: randomUUID() },
            user_metadata: { full_name: request.full_name, phone: request.mobile_number }
        });
        if (error || !data?.user) throw error || new Error("Account creation failed.");
        profile = { id: data.user.id };
    }
    // The Auth trigger may run before service app_metadata is populated.
    await linkPendingProfile(profile.id, request);
    // Profile details and request approval are committed in one SQL transaction.
    await UserModel.completeApproval(request.id, profile.id, token, req.user.id);
    return deliverCredentials(request, profile.id, credentials, token, res);
});

const sendCredentials = review(async (req, res, request, token) => {
    if (request.status !== REG_STATUS.APPROVED || !request.approved_user_id) return res.status(409).json({ success: false, message: "Approve this request before sending credentials." });
    if (!emailService.isEmailConfigured) return res.status(503).json({ success: false, message: "Configure SMTP email before sending credentials." });
    if (!isEmail(request.email)) return res.status(400).json({ success: false, message: "A valid contact email is required." });
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(request.approved_user_id);
    if (error || !data?.user) throw error || new Error("Approved account not found.");
    if (data.user.app_metadata?.demo_account) return res.status(409).json({ success: false, message: "Demo credentials are managed by the demo setup command. No email is sent to reserved demo addresses." });
    if (!data.user.app_metadata?.must_change_password) return res.status(409).json({ success: false, message: "This user has already set a password. They should use Forgot password." });
    const credentials = temporaryCredentials();
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
        password: credentials.password,
        app_metadata: { ...data.user.app_metadata, must_change_password: true, temporary_password_expires_at: credentials.expiresAt, session_version: randomUUID() }
    });
    if (updateError) throw updateError;
    await UserModel.updateReviewedRequest(request.id, token, { credentials_email_status: "pending", credentials_email_sent_at: null });
    return deliverCredentials(request, data.user.id, credentials, token, res);
});

const rejectRequest = review(async (req, res, request, token) => {
    if (request.status !== REG_STATUS.PENDING) return res.status(409).json({ success: false, message: `Request is already ${request.status}.` });
    const reason = text(req.body?.reason);
    if (!reason || reason.length > 2000) return res.status(400).json({ success: false, message: "Provide a rejection reason of 1–2000 characters." });
    // An interrupted approval may have created an unapproved account. Remove it
    // before rejection so the applicant can submit corrected details.
    const orphan = await findRegistrationAccount(request);
    if (orphan) {
        if (orphan.is_approved) throw new Error("An approved account is linked to this pending request.");
        const { error } = await supabaseAdmin.auth.admin.deleteUser(orphan.id);
        if (error) throw error;
    }
    await UserModel.updateReviewedRequest(request.id, token, {
        status: REG_STATUS.REJECTED, rejection_reason: reason, reviewed_by: req.user.id, reviewed_at: new Date().toISOString()
    });
    const result = isEmail(request.email) ? await emailService.sendEmail({ to: request.email,
        ...emailService.buildRejectionEmail({ fullName: request.full_name, role: request.role, reason }) }) : { success: false };
    return res.status(200).json({ success: true, message: result.success ? "Registration rejected and notification sent." : "Registration rejected. Notification email was not sent.",
        data: { request_id: request.id, status: REG_STATUS.REJECTED, rejection_reason: reason, email_sent: result.success } });
});

const updateRequestEmail = review(async (req, res, request, token) => {
    if (request.status !== REG_STATUS.PENDING) return res.status(409).json({ success: false, message: "Only pending requests can be corrected." });
    const email = normalizeEmail(req.body?.email);
    if (!isEmail(email)) return res.status(400).json({ success: false, message: "A valid contact email is required." });
    if (await UserModel.findByRegistrationRequestId(request.id)) return res.status(409).json({ success: false, message: "An account is already being created for this request. Retry approval before editing its email." });
    if (await UserModel.findByEmail(email)) return res.status(409).json({ success: false, message: "An account already uses this email." });
    const updated = await UserModel.updateReviewedRequest(request.id, token, { email });
    return res.status(200).json({ success: true, data: publicRequest(updated) });
});

const getRequestDetail = async (req, res) => {
    if (!isUuid(req.params.requestId)) return res.status(400).json({ success: false, message: "Invalid registration request ID." });
    try {
        const request = await UserModel.findRegistrationRequestById(req.params.requestId);
        if (!request) return res.status(404).json({ success: false, message: "Registration request not found." });
        return res.status(200).json({ success: true, data: publicRequest(request) });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch request details." });
    }
};
const listApprovedUsers = async (req, res) => {
    const paging = pagination(req.query, 20);
    const role = req.query.role || ROLES.FARMER;
    if (!paging || !applicantRole(role)) return res.status(400).json({ success: false, message: "Use role farmer/buyer, page >= 1 and limit 1–100." });
    try {
        return res.status(200).json({ success: true, data: await UserModel.findByRole(role, paging) });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to list users." });
    }
};
const listAllCrops = async (req, res) => {
    try {
        const crops = await CropModel.findAllAvailable();
        return res.status(200).json({ success: true, count: crops.length, data: crops });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to list crops." });
    }
};
const listAllCallLogs = async (req, res) => {
    try {
        const calls = await CallModel.listUserCalls("");
        return res.status(200).json({ success: true, count: calls.length, data: calls });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to list call logs." });
    }
};

module.exports = { adminLogin, getAdminProfile, getDashboard, approveRequest, sendCredentials, rejectRequest, updateRequestEmail, getRequestDetail, listApprovedUsers, listAllCrops, listAllCallLogs };
