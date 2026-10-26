const { supabase, isConfigured } = require("../config/supabase");
const { UserModel, ROLES } = require("../models/userModel");

// ================================================================
// Middleware: Authenticate via Supabase JWT
// ================================================================

/**
 * Validates the Supabase JWT Bearer token from the Authorization header.
 * Attaches the authenticated user's profile to req.user.
 */
const authenticate = async (req, res, next) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({
                success: false,
                message: "Authentication service unavailable. Please configure Supabase credentials."
            });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. Missing or malformed Bearer token in Authorization header."
            });
        }

        const token = authHeader.split(" ")[1];

        // Verify token with Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authData.user) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token.",
                error: authError ? authError.message : "User not found"
            });
        }

        // Fetch the user profile from public.profiles
        const profile = await UserModel.findById(authData.user.id);
        if (!profile || !UserModel.isValidRole(profile.role)) {
            return res.status(403).json({ success: false, message: "An approved platform profile is required." });
        }

        req.user = {
            id: authData.user.id,
            email: authData.user.email,
            role: profile.role,
            is_approved: profile.is_approved,
            profile,
            must_change_password: authData.user.app_metadata?.must_change_password === true,
            token
        };

        next();
    } catch (error) {
        console.error("Auth Middleware Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error during authentication.",
            error: error.message
        });
    }
};

// ================================================================
// Middleware: Role-Based Access Control (RBAC)
// ================================================================

/**
 * Factory that creates a role guard middleware.
 * Usage: authorize("admin"), authorize("farmer", "buyer")
 */
const authorize = (...roles) => {
    const allowed = roles.flat();
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required before authorization check."
            });
        }

        if (!allowed.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Role '${req.user.role}' is not permitted for this action.`,
                allowedRoles: allowed
            });
        }

        if (req.user.role === ROLES.ADMIN && !req.user.is_approved) {
            return res.status(403).json({ success: false, message: "An approved administrator account is required." });
        }

        next();
    };
};

// ================================================================
// Middleware: Require Approved Account
// ================================================================

/**
 * Ensures the authenticated user has been approved by an Admin.
 * Farmers and Buyers must be approved before accessing protected resources.
 */
const requireApproved = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Authentication required." });
    }

    // Admins are always considered approved
    if (req.user.role === ROLES.ADMIN) return next();

    if (!req.user.is_approved) {
        return res.status(403).json({
            success: false,
            message: "Your account is pending Admin approval. Please wait for approval notification via email."
        });
    }

    next();
};

const requirePasswordChanged = (req, res, next) => {
    if (req.user?.must_change_password) return res.status(403).json({
        success: false, code: "PASSWORD_CHANGE_REQUIRED",
        message: "Set your own password using Forgot password or Change password before using the platform."
    });
    next();
};

module.exports = {
    authenticate,
    authorize,
    requireApproved,
    requirePasswordChanged
};
