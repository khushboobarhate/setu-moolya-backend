const { isUuid, validText, availabilityValue } = require("../utils/validation");
const { UserModel, ROLES } = require("../models/userModel");
const { CropModel } = require("../models/cropModel");
const { InterestModel } = require("../models/interestModel");
const { CallModel } = require("../models/callModel");

const { register } = require("./registrationController");
const { login } = require("./accountController");

const buyerRegister = register(ROLES.BUYER);
const buyerLogin = login(ROLES.BUYER);

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
                must_change_password: req.user.must_change_password === true,
                is_call_available
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch buyer profile." });
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
        return res.status(500).json({ success: false, message: "Failed to get call availability." });
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
        const isAvailable = availabilityValue(req.body);
        if (isAvailable === null) return res.status(400).json({ success: false, message: 'Use is_call_available: true/false, or status: ON/OFF.' });

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
        return res.status(500).json({ success: false, message: "Failed to update call availability." });
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
        if (crop_type !== undefined && !['organic', 'inorganic', 'non-organic'].includes(crop_type) || search !== undefined && !validText(search, 0, 100)) return res.status(400).json({ success: false, message: 'Use a valid crop type and search text of at most 100 characters.' });
        const crops = await CropModel.findAllAvailable({ crop_type, search });

        const enriched = await Promise.all(
            crops.map(async (crop) => {
                const farmer = await UserModel.findById(crop.farmer_id);
                if (!farmer?.is_approved || farmer.role !== ROLES.FARMER) return null;

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
            message: `Found ${enriched.filter(Boolean).length} available crop listing(s).`,
            data: enriched.filter(Boolean)
        });
    } catch (error) {
        console.error("Buyer Browse Crops Error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch crop listings." });
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
        if (!isUuid(cropId)) return res.status(400).json({ success: false, message: 'A valid crop ID is required.' });
        const crop = await CropModel.findById(cropId);
        if (!crop || crop.status !== "available") {
            return res.status(404).json({ success: false, message: "Crop listing not found." });
        }

        const farmer = await UserModel.findById(crop.farmer_id);
        if (!farmer?.is_approved || farmer.role !== ROLES.FARMER) return res.status(404).json({ success: false, message: 'Crop listing not found.' });

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
        return res.status(500).json({ success: false, message: "Failed to fetch crop details." });
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
        if (!isUuid(cropId)) return res.status(400).json({ success: false, message: 'A valid crop ID is required.' });
        const { rating, notes } = req.body;

        if (rating === undefined || rating === null) {
            return res.status(400).json({
                success: false,
                message: "Interest rating (1 to 5) is required."
            });
        }

        const ratingNum = typeof rating === 'number' ? rating : typeof rating === 'string' && /^[1-5]$/.test(rating) ? Number(rating) : NaN;
        if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ success: false, message: 'Interest rating must be an integer between 1 and 5.' });
        if (notes !== undefined && !validText(notes, 0, 2000, true)) return res.status(400).json({ success: false, message: 'Notes must be text with at most 2000 characters.' });

        const crop = await CropModel.findById(cropId);
        if (!crop || crop.status !== "available") {
            return res.status(404).json({ success: false, message: "Crop listing not found." });
        }

        const owner = await UserModel.findById(crop.farmer_id);
        if (!owner?.is_approved || owner.role !== ROLES.FARMER) return res.status(404).json({ success: false, message: 'Crop listing not found.' });
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
        return res.status(500).json({ success: false, message: "Failed to record interest rating." });
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
        return res.status(500).json({ success: false, message: "Failed to fetch buyer interests." });
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
        const { farmer_id, crop_id } = req.body || {};
        if (farmer_id !== undefined && !isUuid(farmer_id) || crop_id !== undefined && !isUuid(crop_id)) return res.status(400).json({ success: false, message: 'Valid farmer and optional crop IDs are required.' });
        if (crop_id) {
            const linked = await CropModel.findById(crop_id);
            if (!linked || linked.status !== 'available' || farmer_id && linked.farmer_id !== farmer_id) return res.status(404).json({ success: false, message: 'Available crop and farmer do not match.' });
        }

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
        if (!farmer || farmer.role !== ROLES.FARMER || !farmer.is_approved) {
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
        return res.status(500).json({ success: false, message: "Failed to initiate call to farmer." });
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
