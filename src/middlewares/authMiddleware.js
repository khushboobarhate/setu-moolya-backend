const { supabase, supabaseAdmin, isConfigured } = require("../config/supabase");
const { UserModel } = require("../models/userModel");

/**
 * Authentication Middleware
 * Validates Supabase JWT from the Authorization header and attaches the user profile to req.user.
 */
const authenticate = async (req, res, next) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({
                success: false,
                message: "Authentication service unavailable. Please configure Supabase credentials in backend .env file."
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

        // Fetch detailed profile from public.profiles
        let profile = await UserModel.findById(authData.user.id);

        // Fallback in case profile record was delayed
        if (!profile) {
            profile = {
                id: authData.user.id,
                email: authData.user.email,
                role: authData.user.user_metadata?.role || "farmer",
                full_name: authData.user.user_metadata?.full_name || authData.user.email.split("@")[0],
                is_verified: false,
                kyc_status: "pending"
            };
        }

        // Attach user and role to request object
        req.user = {
            id: authData.user.id,
            email: authData.user.email,
            role: profile.role,
            is_verified: profile.is_verified,
            kyc_status: profile.kyc_status,
            profile: profile,
            token: token
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

/**
 * Role-Based Access Control (RBAC) Middleware Factory
 * Usage: authorize("admin"), authorize("farmer", "fpo"), or authorize(["buyer", "admin"])
 */
const authorize = (...roles) => {
    const flatRoles = roles.flat();

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required prior to authorization check."
            });
        }

        const userRole = req.user.role;

        if (!flatRoles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Role '${userRole}' is not permitted to perform this action.`,
                allowedRoles: flatRoles
            });
        }

        next();
    };
};

/**
 * Verification Guard Middleware
 * Ensures the actor has completed KYC and is verified by an Admin/FPO
 */
const requireVerified = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: "Authentication required."
        });
    }

    if (!req.user.is_verified) {
        return res.status(403).json({
            success: false,
            message: "Account verification required. Your KYC verification is currently pending or rejected.",
            kyc_status: req.user.kyc_status
        });
    }

    next();
};

/**
 * Optional Authentication Middleware
 * If token is present, populates req.user. If not, proceeds without error.
 */
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ") || !isConfigured) {
        return next();
    }

    try {
        const token = authHeader.split(" ")[1];
        const { data: authData } = await supabase.auth.getUser(token);
        if (authData?.user) {
            const profile = await UserModel.findById(authData.user.id);
            req.user = {
                id: authData.user.id,
                email: authData.user.email,
                role: profile?.role || authData.user.user_metadata?.role || "farmer",
                is_verified: profile?.is_verified || false,
                profile: profile
            };
        }
    } catch {
        // Silently proceed as guest
    }

    next();
};

module.exports = {
    authenticate,
    authorize,
    requireVerified,
    optionalAuth
};
