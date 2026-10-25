const { supabase, supabaseAdmin, isConfigured } = require("../config/supabase");
const { UserModel, ROLES } = require("../models/userModel");
const { CropModel } = require("../models/cropModel");
const { InterestModel } = require("../models/interestModel");
const { CallModel } = require("../models/callModel");
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

        const is_call_available = await CallModel.getUserAvailability(data.user.id);

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
                    city: profile.city,
                    is_call_available
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
 * @desc    Get authenticated buyer's profile including call availability
 * @access  Protected (Buyer)
 */
const getBuyerProfile = async (req, res) => {
    try {
        const profile = await UserModel.findById(req.user.id);
        if (!profile) {
            return res.status(404).json({ success: false, message: "Buyer profile not found." });
        }
        const is_call_available = await CallModel.getUserAvailability(req.user.id);
        return res.status(200).json({
            success: true,
            data: {
                ...profile,
                is_call_available
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch buyer profile.", error: error.message });
    }
};

// ================================================================
// Controller: Buyer Call Availability
// ================================================================

/**
 * @route   GET /api/buyer/availability
 * @desc    Get buyer's current call availability status
 * @access  Protected (Buyer)
 */
const getCallAvailability = async (req, res) => {
    try {
        const isAvailable = await CallModel.getUserAvailability(req.user.id);
        return res.status(200).json({
            success: true,
            data: {
                buyer_id: req.user.id,
                is_call_available: isAvailable,
                status: isAvailable ? "ON" : "OFF"
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to get call availability.", error: error.message });
    }
};

/**
 * @route   PATCH /api/buyer/availability
 * @desc    Toggle or update buyer's call availability status ON or OFF
 * @access  Protected (Buyer)
 * @body    { is_call_available: boolean } or { status: "ON"|"OFF" }
 */
const setCallAvailability = async (req, res) => {
    try {
        let isAvailable;
        if (typeof req.body.is_call_available !== "undefined") {
            isAvailable = String(req.body.is_call_available).toLowerCase() === "true" || req.body.is_call_available === true;
        } else if (typeof req.body.status !== "undefined") {
            isAvailable = String(req.body.status).toUpperCase() === "ON";
        } else if (typeof req.body.availability !== "undefined") {
            isAvailable = String(req.body.availability).toUpperCase() === "ON" || req.body.availability === true;
        } else {
            return res.status(400).json({
                success: false,
                message: "Please provide is_call_available (boolean) or status ('ON'/'OFF')."
            });
        }

        const updated = await CallModel.setUserAvailability(req.user.id, isAvailable);
        return res.status(200).json({
            success: true,
            message: `Buyer call availability turned ${updated ? "ON" : "OFF"} successfully.`,
            data: {
                buyer_id: req.user.id,
                is_call_available: updated,
                status: updated ? "ON" : "OFF"
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to update call availability.", error: error.message });
    }
};

// ================================================================
// Controller: Buyer Crop Browsing
// ================================================================

/**
 * @route   GET /api/buyer/crops
 * @desc    View all available crops uploaded by farmers with photos, quantity,
 *          crop type (organic/inorganic), price, description, farmer availability, and rating
 * @access  Protected (Buyer)
 * @query   crop_type ("organic"|"inorganic"), search
 */
const getAvailableCrops = async (req, res) => {
    try {
        const { crop_type, search } = req.query;
        const crops = await CropModel.findAllAvailable({ crop_type, search });

        const enriched = await Promise.all(
            crops.map(async (crop) => {
                let farmer = null;
                try {
                    farmer = await UserModel.findById(crop.farmer_id);
                } catch {
                    // Fallback
                }

                const farmer_call_available = await CallModel.getUserAvailability(crop.farmer_id);
                const ratingSummary = await InterestModel.getRatingSummary(crop.id);

                // Check if current buyer has already rated / expressed interest in this crop
                const interests = await InterestModel.findByCropId(crop.id);
                const myInterest = interests.find((i) => i.buyer_id === req.user.id);

                return {
                    id: crop.id,
                    crop_name: crop.crop_name,
                    crop_type: crop.crop_type,
                    quantity: crop.quantity,
                    quantity_unit: crop.quantity_unit,
                    price: crop.price,
                    description: crop.description,
                    photos: crop.photos || [],
                    status: crop.status,
                    created_at: crop.created_at,
                    farmer: {
                        id: crop.farmer_id,
                        full_name: farmer ? farmer.full_name : "Farmer",
                        city: farmer ? farmer.city : null,
                        state: farmer ? farmer.state : null,
                        is_call_available: farmer_call_available
                    },
                    average_rating: ratingSummary.average_rating,
                    total_ratings: ratingSummary.total_ratings,
                    my_interest: myInterest
                        ? {
                              rating: myInterest.rating,
                              notes: myInterest.notes,
                              created_at: myInterest.created_at
                          }
                        : null
                };
            })
        );

        return res.status(200).json({
            success: true,
            message: `Found ${enriched.length} available crop listing(s).`,
            data: enriched
        });
    } catch (error) {
        console.error("Buyer Browse Crops Error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch crop listings.", error: error.message });
    }
};

/**
 * @route   GET /api/buyer/crops/:cropId
 * @desc    View detailed crop information including photos, farmer info, and call availability
 * @access  Protected (Buyer)
 */
const getCropDetail = async (req, res) => {
    try {
        const { cropId } = req.params;
        const crop = await CropModel.findById(cropId);
        if (!crop) {
            return res.status(404).json({ success: false, message: "Crop listing not found." });
        }

        let farmer = null;
        try {
            farmer = await UserModel.findById(crop.farmer_id);
        } catch {
            // ignore
        }

        const farmer_call_available = await CallModel.getUserAvailability(crop.farmer_id);
        const ratingSummary = await InterestModel.getRatingSummary(crop.id);

        const interests = await InterestModel.findByCropId(crop.id);
        const myInterest = interests.find((i) => i.buyer_id === req.user.id);

        return res.status(200).json({
            success: true,
            data: {
                id: crop.id,
                crop_name: crop.crop_name,
                crop_type: crop.crop_type,
                quantity: crop.quantity,
                quantity_unit: crop.quantity_unit,
                price: crop.price,
                description: crop.description,
                photos: crop.photos || [],
                status: crop.status,
                created_at: crop.created_at,
                farmer: {
                    id: crop.farmer_id,
                    full_name: farmer ? farmer.full_name : "Farmer",
                    city: farmer ? farmer.city : null,
                    state: farmer ? farmer.state : null,
                    is_call_available: farmer_call_available
                },
                average_rating: ratingSummary.average_rating,
                total_ratings: ratingSummary.total_ratings,
                my_interest: myInterest
                    ? {
                          rating: myInterest.rating,
                          notes: myInterest.notes,
                          created_at: myInterest.created_at
                      }
                    : null
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch crop details.", error: error.message });
    }
};

// ================================================================
// Controller: Buyer Interest and Rating System
// ================================================================

/**
 * @route   POST /api/buyer/crops/:cropId/interest
 * @desc    Buyers express their interest in a farmer's crop through a rating system (1-5 stars)
 * @access  Protected (Buyer)
 * @body    { rating: 1-5, notes?: string }
 */
const expressInterest = async (req, res) => {
    try {
        const { cropId } = req.params;
        const { rating, notes } = req.body;

        if (rating === undefined || rating === null) {
            return res.status(400).json({
                success: false,
                message: "Interest rating (1 to 5) is required."
            });
        }

        const ratingNum = parseInt(rating, 10);
        if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({
                success: false,
                message: "Interest rating must be an integer between 1 and 5 stars."
            });
        }

        const crop = await CropModel.findById(cropId);
        if (!crop) {
            return res.status(404).json({ success: false, message: "Crop listing not found." });
        }

        const savedInterest = await InterestModel.upsertInterest({
            crop_id: cropId,
            buyer_id: req.user.id,
            rating: ratingNum,
            notes: notes || ""
        });

        const ratingSummary = await InterestModel.getRatingSummary(cropId);

        return res.status(200).json({
            success: true,
            message: `Your interest and rating (${ratingNum}/5) have been submitted to the farmer.`,
            data: {
                interest: savedInterest,
                crop_id: cropId,
                crop_name: crop.crop_name,
                average_rating: ratingSummary.average_rating,
                total_ratings: ratingSummary.total_ratings
            }
        });
    } catch (error) {
        console.error("Buyer Express Interest Error:", error);
        return res.status(500).json({ success: false, message: "Failed to record interest rating.", error: error.message });
    }
};

/**
 * @route   GET /api/buyer/interests
 * @desc    Get all crops that the current buyer has expressed interest in
 * @access  Protected (Buyer)
 */
const getMyInterests = async (req, res) => {
    try {
        const interests = await InterestModel.findByBuyerId(req.user.id);
        return res.status(200).json({
            success: true,
            message: `Found ${interests.length} expressed interest record(s).`,
            data: interests
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch buyer interests.", error: error.message });
    }
};

// ================================================================
// Controller: Buyer-to-Farmer Calling
// ================================================================

/**
 * @route   POST /api/buyer/calls/initiate
 * @desc    Buyer calls a farmer.
 *          Permitted ONLY when the respective farmer's call availability is ON.
 *          Blocked when the farmer's call availability is OFF.
 * @access  Protected (Buyer)
 * @body    { farmer_id: UUID, crop_id?: UUID }
 */
const callFarmer = async (req, res) => {
    try {
        const { farmer_id, crop_id } = req.body;

        let targetFarmerId = farmer_id;

        // If farmer_id not provided directly, resolve from crop_id
        if (!targetFarmerId && crop_id) {
            const crop = await CropModel.findById(crop_id);
            if (crop) {
                targetFarmerId = crop.farmer_id;
            }
        }

        if (!targetFarmerId) {
            return res.status(400).json({
                success: false,
                message: "farmer_id or valid crop_id is required to initiate a call."
            });
        }

        const farmer = await UserModel.findById(targetFarmerId);
        if (!farmer || farmer.role !== ROLES.FARMER) {
            return res.status(404).json({ success: false, message: "Farmer profile not found." });
        }

        // Check receiving farmer's call availability
        const isFarmerAvailable = await CallModel.getUserAvailability(targetFarmerId);
        if (!isFarmerAvailable) {
            await CallModel.logCall({
                caller_id: req.user.id,
                receiver_id: targetFarmerId,
                crop_id: crop_id || null,
                caller_role: ROLES.BUYER,
                receiver_role: ROLES.FARMER,
                status: "blocked_receiver_unavailable"
            });

            return res.status(403).json({
                success: false,
                call_permitted: false,
                message: "Farmer is currently not available to receive calls. Call availability is turned OFF.",
                data: {
                    receiver_id: targetFarmerId,
                    receiver_name: farmer.full_name,
                    is_call_available: false
                }
            });
        }

        // Farmer call availability is ON -> Permit call & reveal contact number
        const farmerPhone = farmer.mobile_number || farmer.phone;
        const callLog = await CallModel.logCall({
            caller_id: req.user.id,
            receiver_id: targetFarmerId,
            crop_id: crop_id || null,
            caller_role: ROLES.BUYER,
            receiver_role: ROLES.FARMER,
            status: "permitted",
            phone_revealed: farmerPhone
        });

        return res.status(200).json({
            success: true,
            call_permitted: true,
            message: "Farmer is available. Call initiated successfully.",
            data: {
                call_id: callLog.id,
                receiver_id: farmer.id,
                receiver_name: farmer.full_name,
                receiver_phone: farmerPhone,
                receiver_role: ROLES.FARMER,
                receiver_availability: "ON",
                crop_id: crop_id || null,
                call_status: "permitted"
            }
        });
    } catch (error) {
        console.error("Buyer Call Farmer Error:", error);
        return res.status(500).json({ success: false, message: "Failed to initiate call to farmer.", error: error.message });
    }
};

module.exports = {
    buyerRegister,
    buyerLogin,
    getBuyerProfile,
    getCallAvailability,
    setCallAvailability,
    getAvailableCrops,
    getCropDetail,
    expressInterest,
    getMyInterests,
    callFarmer
};
