const { supabase, supabaseAdmin, isConfigured } = require("../config/supabase");
const { UserModel, ROLES, REG_STATUS } = require("../models/userModel");
const { sendEmail, buildApprovalEmail, buildRejectionEmail } = require("../config/email");
const { CallModel } = require("../models/callModel");
const { CropModel } = require("../models/cropModel");
require("dotenv").config();

// ================================================================
// Controller: Admin Login
// ================================================================

/**
 * @route   POST /api/admin/login
 * @desc    Admin direct login with email and password
 * @access  Public
 * @body    { email, password }
 */
const adminLogin = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({ success: false, message: "Database service not configured." });
        }

        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required." });
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            return res.status(401).json({ success: false, message: "Invalid admin credentials.", error: error.message });
        }

        // Confirm user has admin role in profiles table
        const profile = await UserModel.findById(data.user.id);
        if (!profile || profile.role !== ROLES.ADMIN) {
            // Sign out the session immediately if not admin
            await supabase.auth.signOut();
            return res.status(403).json({
                success: false,
                message: "Access denied. This portal is restricted to Administrators only."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Admin login successful.",
            data: {
                token: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresIn: data.session.expires_in,
                admin: {
                    id: data.user.id,
                    email: data.user.email,
                    full_name: profile.full_name,
                    role: profile.role
                }
            }
        });
    } catch (error) {
        console.error("Admin Login Error:", error);
        return res.status(500).json({ success: false, message: "An error occurred during admin login.", error: error.message });
    }
};

// ================================================================
// Controller: Admin Dashboard – Pending Requests
// ================================================================

/**
 * @route   GET /api/admin/dashboard
 * @desc    Fetch all pending registration requests (Farmers + Buyers)
 * @access  Protected (Admin)
 * @query   role (optional: "farmer" | "buyer"), page, limit
 */
const getDashboard = async (req, res) => {
    try {
        const { role, page = 1, limit = 50 } = req.query;

        const result = await UserModel.listRegistrationRequests({
            role: role || null,
            status: REG_STATUS.PENDING,
            page: parseInt(page),
            limit: parseInt(limit)
        });

        return res.status(200).json({
            success: true,
            message: `Fetched ${result.requests.length} pending registration request(s).`,
            data: {
                pending_requests: result.requests,
                pagination: {
                    total: result.total,
                    page: result.page,
                    totalPages: result.totalPages,
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        console.error("Admin Dashboard Error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch dashboard data.", error: error.message });
    }
};

// ================================================================
// Controller: Admin – Approve Registration
// ================================================================

/**
 * @route   POST /api/admin/requests/:requestId/approve
 * @desc    Approve a farmer or buyer registration request.
 *          Creates Supabase Auth user, stores profile, sends approval email.
 * @access  Protected (Admin)
 */
const approveRequest = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({ success: false, message: "Database service not configured." });
        }

        const { requestId } = req.params;

        // Fetch the registration request
        const regRequest = await UserModel.findRegistrationRequestById(requestId);
        if (!regRequest) {
            return res.status(404).json({ success: false, message: "Registration request not found." });
        }
        if (regRequest.status !== REG_STATUS.PENDING) {
            return res.status(400).json({
                success: false,
                message: `Request has already been ${regRequest.status}. Cannot approve again.`
            });
        }

        // Generate login credentials
        const loginEmail = generateLoginEmail(regRequest.full_name, regRequest.role);
        const plainPassword = generateSecurePassword();

        // Create Supabase Auth user with admin client (bypasses email confirmation)
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: loginEmail,
            password: plainPassword,
            email_confirm: true, // Auto-confirm email
            user_metadata: {
                full_name: regRequest.full_name,
                role: regRequest.role,
                phone: regRequest.mobile_number
            }
        });

        if (authError) {
            console.error("Supabase create user error:", authError);
            return res.status(500).json({
                success: false,
                message: "Failed to create user account.",
                error: authError.message
            });
        }

        const createdUser = authData.user;

        // Persist the approved user profile
        await UserModel.upsertProfile({
            id: createdUser.id,
            email: loginEmail,
            full_name: regRequest.full_name,
            role: regRequest.role,
            mobile_number: regRequest.mobile_number,
            nationality: regRequest.nationality,
            state: regRequest.state,
            taluka: regRequest.taluka,
            city: regRequest.city,
            full_address: regRequest.full_address,
            land_location: regRequest.land_location || null,       // Farmer only
            preferred_language: regRequest.preferred_language,
            photo_url: regRequest.photo_url,
            is_approved: true,
            registration_request_id: regRequest.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        // Initialize default call availability to true (ON)
        await CallModel.setUserAvailability(createdUser.id, true);

        // Update the registration request status to approved
        await UserModel.updateRegistrationStatus(requestId, REG_STATUS.APPROVED, {
            approved_login_email: loginEmail,
            approved_user_id: createdUser.id
        });

        // Send approval email with credentials
        const loginUrl = process.env.CLIENT_LOGIN_URL || `${process.env.CLIENT_URL || "http://localhost:3000"}/login`;
        const emailContent = buildApprovalEmail({
            fullName: regRequest.full_name,
            role: regRequest.role,
            loginId: loginEmail,
            password: plainPassword,
            loginUrl
        });

        const emailResult = await sendEmail({
            to: regRequest.email || regRequest.mobile_number,
            subject: emailContent.subject,
            html: emailContent.html
        });

        return res.status(200).json({
            success: true,
            message: `Registration approved for ${regRequest.full_name}. Credentials sent via email.`,
            data: {
                request_id: requestId,
                user_id: createdUser.id,
                login_id: loginEmail,
                role: regRequest.role,
                full_name: regRequest.full_name,
                email_sent: emailResult.success
            }
        });
    } catch (error) {
        console.error("Admin Approve Error:", error);
        return res.status(500).json({ success: false, message: "Failed to approve registration.", error: error.message });
    }
};

// ================================================================
// Controller: Admin – Reject Registration
// ================================================================

/**
 * @route   POST /api/admin/requests/:requestId/reject
 * @desc    Reject a farmer or buyer registration request and notify via email
 * @access  Protected (Admin)
 */
const rejectRequest = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({ success: false, message: "Database service not configured." });
        }

        const { requestId } = req.params;

        const regRequest = await UserModel.findRegistrationRequestById(requestId);
        if (!regRequest) {
            return res.status(404).json({ success: false, message: "Registration request not found." });
        }
        if (regRequest.status !== REG_STATUS.PENDING) {
            return res.status(400).json({
                success: false,
                message: `Request has already been ${regRequest.status}. Cannot reject again.`
            });
        }

        // Update status to rejected
        await UserModel.updateRegistrationStatus(requestId, REG_STATUS.REJECTED);

        // Send rejection email
        const emailContent = buildRejectionEmail({
            fullName: regRequest.full_name,
            role: regRequest.role
        });

        const emailResult = await sendEmail({
            to: regRequest.email || regRequest.mobile_number,
            subject: emailContent.subject,
            html: emailContent.html
        });

        return res.status(200).json({
            success: true,
            message: `Registration rejected for ${regRequest.full_name}. Rejection email sent.`,
            data: {
                request_id: requestId,
                role: regRequest.role,
                full_name: regRequest.full_name,
                status: REG_STATUS.REJECTED,
                email_sent: emailResult.success
            }
        });
    } catch (error) {
        console.error("Admin Reject Error:", error);
        return res.status(500).json({ success: false, message: "Failed to reject registration.", error: error.message });
    }
};

// ================================================================
// Controller: Admin – View a Single Request Detail
// ================================================================

/**
 * @route   GET /api/admin/requests/:requestId
 * @desc    Get full details of a specific registration request
 * @access  Protected (Admin)
 */
const getRequestDetail = async (req, res) => {
    try {
        const { requestId } = req.params;
        const regRequest = await UserModel.findRegistrationRequestById(requestId);
        if (!regRequest) {
            return res.status(404).json({ success: false, message: "Registration request not found." });
        }
        return res.status(200).json({ success: true, data: regRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch request details.", error: error.message });
    }
};

// ================================================================
// Controller: Admin – List All Approved Users
// ================================================================

/**
 * @route   GET /api/admin/users
 * @desc    List all approved farmers or buyers
 * @access  Protected (Admin)
 * @query   role ("farmer" | "buyer"), page, limit
 */
const listApprovedUsers = async (req, res) => {
    try {
        const { role = ROLES.FARMER, page = 1, limit = 20 } = req.query;
        const result = await UserModel.findByRole(role, { page: parseInt(page), limit: parseInt(limit) });
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to list users.", error: error.message });
    }
};

// ================================================================
// Controller: Admin – List All Platform Crops & Call Logs
// ================================================================

/**
 * @route   GET /api/admin/crops
 * @desc    List all crop listings on the platform
 * @access  Protected (Admin)
 */
const listAllCrops = async (req, res) => {
    try {
        const crops = await CropModel.findAllAvailable();
        return res.status(200).json({ success: true, count: crops.length, data: crops });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to list crops.", error: error.message });
    }
};

/**
 * @route   GET /api/admin/call-logs
 * @desc    List platform call logs
 * @access  Protected (Admin)
 */
const listAllCallLogs = async (req, res) => {
    try {
        const calls = await CallModel.listUserCalls("");
        return res.status(200).json({ success: true, count: calls.length, data: calls });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to list call logs.", error: error.message });
    }
};

// ================================================================
// Utility: Generate Login Credentials
// ================================================================

const generateLoginEmail = (fullName, role) => {
    const namePart = fullName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .substring(0, 12);
    const timestamp = Date.now().toString().slice(-6);
    const domain = process.env.LOGIN_EMAIL_DOMAIN || "setumoolya.com";
    return `${namePart}${timestamp}@${domain}`;
};

const generateSecurePassword = () => {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const special = "!@#$%";
    let password = "";
    for (let i = 0; i < 8; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    password += special.charAt(Math.floor(Math.random() * special.length));
    password += Math.floor(Math.random() * 10).toString();
    return password.split("").sort(() => 0.5 - Math.random()).join("");
};

module.exports = {
    adminLogin,
    getDashboard,
    approveRequest,
    rejectRequest,
    getRequestDetail,
    listApprovedUsers,
    listAllCrops,
    listAllCallLogs
};
