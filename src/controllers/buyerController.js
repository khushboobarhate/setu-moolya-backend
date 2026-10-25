const { supabase, supabaseAdmin, isConfigured } = require("../config/supabase");
const { UserModel, ROLES } = require("../models/userModel");
const { getRegistrationConfirmationMessage } = require("./farmerController");
require("dotenv").config();

/**
 * Validate the phone_verified_token issued after OTP verification
 */
const validatePhoneToken = (token, expectedPhone) => {
    try {
        const jwt = require("jsonwebtoken");
        const secret = process.env.JWT_SECRET || "setumoolya-otp-secret";
        const decoded = jwt.verify(token, secret);
        if (decoded.purpose !== "otp_verified") return { valid: false, message: "Invalid token purpose." };
        if (decoded.phone !== expectedPhone) return { valid: false, message: "Phone mismatch in token." };
        return { valid: true, decoded };
    } catch (err) {
        return { valid: false, message: err.message };
    }
};

// ================================================================
// Controller: Buyer Registration
// ================================================================

/**
 * @route   POST /api/buyer/register
 * @desc    Submit a new buyer registration request (after OTP verification)
 * @access  Public
 * @body    FormData: full_name, age, mobile_number, nationality, state, taluka,
 *          city, full_address, preferred_language, phone_verified_token
 * @files   photo (passport-size photograph)
 */
const buyerRegister = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({ success: false, message: "Database service not configured." });
        }

        const {
            full_name,
            age,
            mobile_number,
            nationality,
            state,
            taluka,
            city,
            full_address,
            preferred_language,
            phone_verified_token
        } = req.body;

        // -- Required field validation --
        const required = { full_name, age, mobile_number, nationality, state, taluka, city, full_address, preferred_language, phone_verified_token };
        const missing = Object.entries(required)
            .filter(([, v]) => !v || v.toString().trim() === "")
            .map(([k]) => k);

        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(", ")}`
            });
        }

        // -- Validate phone_verified_token --
        const tokenCheck = validatePhoneToken(phone_verified_token, mobile_number);
        if (!tokenCheck.valid) {
            return res.status(400).json({
                success: false,
                message: `Mobile number not verified. ${tokenCheck.message} Please complete OTP verification first.`
            });
        }

        // -- Photograph required --
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Passport-size photograph is required."
            });
        }

        const photoUrl = `/uploads/photos/${req.file.filename}`;

        // -- Persist registration request --
        const requestPayload = {
            role: ROLES.BUYER,
            full_name: full_name.trim(),
            age: parseInt(age),
            mobile_number: mobile_number.trim(),
            nationality: nationality.trim(),
            state: state.trim(),
            taluka: taluka.trim(),
            city: city.trim(),
            full_address: full_address.trim(),
            preferred_language: preferred_language.trim(),
            photo_url: photoUrl,
            status: "pending",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const registrationRequest = await UserModel.createRegistrationRequest(requestPayload);

        // -- Confirmation message in selected language --
        const confirmationMsg = getRegistrationConfirmationMessage(preferred_language);

        return res.status(201).json({
            success: true,
            message: confirmationMsg,
            data: {
                request_id: registrationRequest.id,
                role: ROLES.BUYER,
                full_name: registrationRequest.full_name,
                photo_url: photoUrl,
                status: registrationRequest.status,
                preferred_language: registrationRequest.preferred_language
            }
        });
    } catch (error) {
        console.error("Buyer Register Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to submit buyer registration.",
            error: error.message
        });
    }
};

// ================================================================
// Controller: Buyer Login
// ================================================================

/**
 * @route   POST /api/buyer/login
 * @desc    Existing approved buyer login using credentials from approval email
 * @access  Public
 * @body    { login_id: "email@example.com", password: "..." }
 */
const buyerLogin = async (req, res) => {
    try {
        if (!isConfigured) {
            return res.status(503).json({ success: false, message: "Database service not configured." });
        }

        const { login_id, password } = req.body;
        if (!login_id || !password) {
            return res.status(400).json({ success: false, message: "login_id (email) and password are required." });
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email: login_id, password });
        if (error) {
            return res.status(401).json({ success: false, message: "Invalid login credentials.", error: error.message });
        }

        const profile = await UserModel.findById(data.user.id);
        if (!profile || profile.role !== ROLES.BUYER) {
            return res.status(403).json({ success: false, message: "Access denied. This login is for Buyers only." });
        }

        if (!profile.is_approved) {
            return res.status(403).json({
                success: false,
                message: "Your account has not been approved yet. Please wait for Admin approval."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Buyer login successful.",
            data: {
                token: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresIn: data.session.expires_in,
                user: {
                    id: data.user.id,
                    login_id: data.user.email,
                    role: profile.role,
                    full_name: profile.full_name,
                    photo_url: profile.photo_url,
                    preferred_language: profile.preferred_language,
                    state: profile.state,
                    city: profile.city
                }
            }
        });
    } catch (error) {
        console.error("Buyer Login Error:", error);
        return res.status(500).json({ success: false, message: "An error occurred during login.", error: error.message });
    }
};

// ================================================================
// Controller: Buyer Profile
// ================================================================

/**
 * @route   GET /api/buyer/profile
 * @desc    Get authenticated buyer's profile
 * @access  Protected (Buyer)
 */
const getBuyerProfile = async (req, res) => {
    try {
        const profile = await UserModel.findById(req.user.id);
        if (!profile) {
            return res.status(404).json({ success: false, message: "Buyer profile not found." });
        }
        return res.status(200).json({ success: true, data: profile });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch buyer profile.", error: error.message });
    }
};

module.exports = {
    buyerRegister,
    buyerLogin,
    getBuyerProfile
};
