const { supabase, supabaseAdmin, isConfigured } = require("../config/supabase");
const { UserModel, ROLES, KYC_STATUS } = require("../models/userModel");

/**
 * Register a new user
 * Roles: 'farmer', 'fpo', 'buyer', 'lab', 'logistics', 'admin'
 */
const register = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({
                success: false,
                message: "Database service not configured. Please supply SUPABASE_URL and SUPABASE_ANON_KEY in .env"
            });
        }

        const {
            email,
            password,
            full_name,
            role = ROLES.FARMER,
            phone,
            organization_name,
            location,
            bio_specialization,
            bank_details
        } = req.body;

        if (!email || !password || !full_name) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: email, password, and full_name are mandatory."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters in length."
            });
        }

        if (role && !UserModel.isValidRole(role)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role specified. Valid roles are: ${UserModel.getRoles().join(", ")}`
            });
        }

        // Register in Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name,
                    role,
                    phone: phone || null,
                    organization_name: organization_name || null,
                    bio_specialization: bio_specialization || null
                }
            }
        });

        if (authError) {
            return res.status(400).json({
                success: false,
                message: authError.message
            });
        }

        const user = authData.user;
        if (!user) {
            return res.status(500).json({
                success: false,
                message: "User creation failed in Supabase auth."
            });
        }

        // Create or ensure profile record in public.profiles table
        const profilePayload = {
            id: user.id,
            email: user.email,
            full_name,
            role,
            phone: phone || null,
            organization_name: organization_name || null,
            location: location || {},
            bio_specialization: bio_specialization || null,
            bank_details: bank_details || {},
            kyc_status: role === ROLES.ADMIN ? KYC_STATUS.VERIFIED : KYC_STATUS.PENDING,
            is_verified: role === ROLES.ADMIN
        };

        const profile = await UserModel.upsertProfile(profilePayload);

        return res.status(201).json({
            success: true,
            message: "User registered successfully.",
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    role: profile.role,
                    full_name: profile.full_name,
                    is_verified: profile.is_verified,
                    kyc_status: profile.kyc_status
                },
                session: authData.session,
                token: authData.session?.access_token || null
            }
        });
    } catch (error) {
        console.error("Register Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to register user.",
            error: error.message
        });
    }
};

/**
 * Sign In / Login with email and password
 */
const login = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({
                success: false,
                message: "Database service not configured. Please supply SUPABASE_URL and SUPABASE_ANON_KEY in .env"
            });
        }

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            return res.status(401).json({
                success: false,
                message: "Invalid login credentials.",
                error: error.message
            });
        }

        // Fetch user profile from database
        let profile = await UserModel.findById(data.user.id);
        if (!profile) {
            // Self-heal: create profile if trigger was not enabled
            profile = await UserModel.upsertProfile({
                id: data.user.id,
                email: data.user.email,
                full_name: data.user.user_metadata?.full_name || data.user.email.split("@")[0],
                role: data.user.user_metadata?.role || ROLES.FARMER,
                is_verified: false,
                kyc_status: KYC_STATUS.PENDING
            });
        }

        return res.status(200).json({
            success: true,
            message: "Authentication successful.",
            data: {
                token: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresIn: data.session.expires_in,
                user: {
                    id: data.user.id,
                    email: data.user.email,
                    role: profile.role,
                    full_name: profile.full_name,
                    phone: profile.phone,
                    organization_name: profile.organization_name,
                    is_verified: profile.is_verified,
                    kyc_status: profile.kyc_status
                },
                profile: profile
            }
        });
    } catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({
            success: false,
            message: "An error occurred during authentication.",
            error: error.message
        });
    }
};

/**
 * Get current authenticated user profile
 */
const getProfile = async (req, res) => {
    try {
        const profile = await UserModel.findById(req.user.id);

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: "User profile not found in database."
            });
        }

        return res.status(200).json({
            success: true,
            data: profile
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch profile.",
            error: error.message
        });
    }
};

/**
 * Update authenticated user profile
 */
const updateProfile = async (req, res) => {
    try {
        const {
            full_name,
            phone,
            organization_name,
            location,
            bio_specialization,
            bank_details,
            avatar_url
        } = req.body;

        const updates = {};
        if (full_name !== undefined) updates.full_name = full_name;
        if (phone !== undefined) updates.phone = phone;
        if (organization_name !== undefined) updates.organization_name = organization_name;
        if (location !== undefined) updates.location = location;
        if (bio_specialization !== undefined) updates.bio_specialization = bio_specialization;
        if (bank_details !== undefined) updates.bank_details = bank_details;
        if (avatar_url !== undefined) updates.avatar_url = avatar_url;

        const updated = await UserModel.updateProfile(req.user.id, updates);

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully.",
            data: updated
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to update profile.",
            error: error.message
        });
    }
};

/**
 * Refresh Auth Token
 */
const refreshToken = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({
                success: false,
                message: "Database service not configured."
            });
        }

        const { refresh_token } = req.body;

        if (!refresh_token) {
            return res.status(400).json({
                success: false,
                message: "refresh_token is required in request body."
            });
        }

        const { data, error } = await supabase.auth.refreshSession({ refresh_token });

        if (error) {
            return res.status(401).json({
                success: false,
                message: "Invalid refresh token.",
                error: error.message
            });
        }

        return res.status(200).json({
            success: true,
            message: "Token refreshed successfully.",
            data: {
                token: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresIn: data.session.expires_in
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to refresh token.",
            error: error.message
        });
    }
};

/**
 * Logout
 */
const logout = async (req, res) => {
    try {
        if (isConfigured) {
            await supabase.auth.signOut();
        }
        return res.status(200).json({
            success: true,
            message: "Logged out successfully."
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error during logout.",
            error: error.message
        });
    }
};

/**
 * Admin: List Users with filtering by role
 */
const listUsers = async (req, res) => {
    try {
        const { role = ROLES.FARMER, page = 1, limit = 20, is_verified } = req.query;
        const verifiedFilter = is_verified !== undefined ? is_verified === "true" : null;

        const results = await UserModel.findByRole(role, {
            page: parseInt(page),
            limit: parseInt(limit),
            isVerified: verifiedFilter
        });

        return res.status(200).json({
            success: true,
            data: results
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to list users.",
            error: error.message
        });
    }
};

/**
 * Admin: Approve/Reject User KYC
 */
const setKycStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const { status, is_verified } = req.body;

        if (![KYC_STATUS.PENDING, KYC_STATUS.VERIFIED, KYC_STATUS.REJECTED].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status. Allowed values: pending, verified, rejected."
            });
        }

        const updated = await UserModel.updateKyc(userId, status, Boolean(is_verified));

        return res.status(200).json({
            success: true,
            message: `User KYC status updated to ${status}.`,
            data: updated
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to update KYC status.",
            error: error.message
        });
    }
};

module.exports = {
    register,
    login,
    getProfile,
    updateProfile,
    refreshToken,
    logout,
    listUsers,
    setKycStatus
};
