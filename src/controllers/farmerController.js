const { UserModel, ROLES } = require("../models/userModel");
const { CropModel } = require("../models/cropModel");
const { InterestModel } = require("../models/interestModel");
const { CallModel } = require("../models/callModel");

const { register } = require("./registrationController");
const { login } = require("./accountController");

const farmerRegister = register(ROLES.FARMER);
const farmerLogin = login(ROLES.FARMER);

// ================================================================
// Controller: Farmer Profile
// ================================================================

/**
 * @route   GET /api/farmer/profile
 * @desc    Get authenticated farmer's profile including call availability
 * @access  Protected (Farmer)
 */
const getFarmerProfile = async (req, res) => {
    try {
        const profile = await UserModel.findById(req.user.id);
        if (!profile) {
            return res.status(404).json({ success: false, message: "Farmer profile not found." });
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
        return res.status(500).json({ success: false, message: "Failed to fetch farmer profile.", error: error.message });
    }
};

// ================================================================
// Controller: Farmer Call Availability
// ================================================================

/**
 * @route   GET /api/farmer/availability
 * @desc    Get farmer's current call availability status
 * @access  Protected (Farmer)
 */
const getCallAvailability = async (req, res) => {
    try {
        const isAvailable = await CallModel.getUserAvailability(req.user.id);
        return res.status(200).json({
            success: true,
            data: {
                farmer_id: req.user.id,
                is_call_available: isAvailable,
                status: isAvailable ? "ON" : "OFF"
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to get call availability.", error: error.message });
    }
};

/**
 * @route   PATCH /api/farmer/availability
 * @desc    Toggle or set farmer's call availability ON or OFF
 * @access  Protected (Farmer)
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
            message: `Farmer call availability turned ${updated ? "ON" : "OFF"} successfully.`,
            data: {
                farmer_id: req.user.id,
                is_call_available: updated,
                status: updated ? "ON" : "OFF"
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to update call availability.", error: error.message });
    }
};

// ================================================================
// Controller: Farmer Crop Upload & Management
// ================================================================

/**
 * @route   POST /api/farmer/crops
 * @desc    Upload a new crop listing with photos, quantity, crop type, required price, description
 * @access  Protected (Farmer)
 */
const uploadCrop = async (req, res) => {
    try {
        const {
            crop_name,
            name,
            title,
            crop_type,
            quantity,
            quantity_unit = "kg",
            price,
            required_price,
            description
        } = req.body;

        const cropNameFinal = (crop_name || name || title || "").trim();
        const priceFinal = price !== undefined ? price : required_price;

        if (!cropNameFinal) {
            return res.status(400).json({ success: false, message: "Crop name is required." });
        }
        if (!crop_type) {
            return res.status(400).json({ success: false, message: "Crop type (organic or inorganic) is required." });
        }
        const normType = crop_type.toLowerCase();
        if (!["organic", "inorganic", "non-organic"].includes(normType)) {
            return res.status(400).json({
                success: false,
                message: "Crop type must be either 'organic' or 'inorganic' (non-organic)."
            });
        }
        if (quantity === undefined || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
            return res.status(400).json({ success: false, message: "A valid positive crop quantity is required." });
        }
        if (priceFinal === undefined || isNaN(parseFloat(priceFinal)) || parseFloat(priceFinal) < 0) {
            return res.status(400).json({ success: false, message: "A valid required price is required." });
        }

        // Process uploaded photos
        const photoUrls = [];
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
            req.files.forEach((f) => photoUrls.push(`/uploads/crops/${f.filename}`));
        } else if (req.files && typeof req.files === "object") {
            const fileList = req.files.photos || req.files.photo || [];
            fileList.forEach((f) => photoUrls.push(`/uploads/crops/${f.filename}`));
        } else if (req.file) {
            photoUrls.push(`/uploads/crops/${req.file.filename}`);
        } else if (req.body.photos) {
            // Support passing pre-uploaded photo URL(s)
            if (Array.isArray(req.body.photos)) {
                photoUrls.push(...req.body.photos);
            } else if (typeof req.body.photos === "string") {
                try {
                    const parsed = JSON.parse(req.body.photos);
                    if (Array.isArray(parsed)) photoUrls.push(...parsed);
                    else photoUrls.push(req.body.photos);
                } catch {
                    photoUrls.push(req.body.photos);
                }
            }
        }

        const crop = await CropModel.createCrop({
            farmer_id: req.user.id,
            crop_name: cropNameFinal,
            crop_type: normType,
            quantity: parseFloat(quantity),
            quantity_unit: quantity_unit || "kg",
            price: parseFloat(priceFinal),
            description: (description || "").trim(),
            photos: photoUrls
        });

        return res.status(201).json({
            success: true,
            message: "Crop listing uploaded successfully.",
            data: crop
        });
    } catch (error) {
        console.error("Upload Crop Error:", error);
        return res.status(500).json({ success: false, message: "Failed to upload crop.", error: error.message });
    }
};

/**
 * @route   GET /api/farmer/crops
 * @desc    Get all crops uploaded by the logged-in farmer, with interested buyers and rating summary
 * @access  Protected (Farmer)
 */
const getMyCrops = async (req, res) => {
    try {
        const crops = await CropModel.findByFarmerId(req.user.id);

        // Enrich each crop with interested buyers and average rating
        const enriched = await Promise.all(
            crops.map(async (c) => {
                const interests = await InterestModel.findByCropId(c.id);
                const ratingSummary = await InterestModel.getRatingSummary(c.id);
                return {
                    ...c,
                    interested_buyers_count: interests.length,
                    average_rating: ratingSummary.average_rating,
                    total_ratings: ratingSummary.total_ratings,
                    interested_buyers: interests
                };
            })
        );

        return res.status(200).json({
            success: true,
            message: `Fetched ${enriched.length} crop listing(s).`,
            data: enriched
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch farmer crops.", error: error.message });
    }
};

/**
 * @route   GET /api/farmer/crops/:cropId
 * @desc    Get a single crop detail with its interested buyers and ratings
 * @access  Protected (Farmer)
 */
const getCropDetail = async (req, res) => {
    try {
        const { cropId } = req.params;
        const crop = await CropModel.findById(cropId);
        if (!crop || crop.farmer_id !== req.user.id) {
            return res.status(404).json({ success: false, message: "Crop not found or unauthorized access." });
        }

        const interests = await InterestModel.findByCropId(cropId);
        const ratingSummary = await InterestModel.getRatingSummary(cropId);

        return res.status(200).json({
            success: true,
            data: {
                ...crop,
                interested_buyers_count: interests.length,
                average_rating: ratingSummary.average_rating,
                total_ratings: ratingSummary.total_ratings,
                interested_buyers: interests
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch crop detail.", error: error.message });
    }
};

/**
 * @route   DELETE /api/farmer/crops/:cropId
 * @desc    Delete a crop listing
 * @access  Protected (Farmer)
 */
const deleteCrop = async (req, res) => {
    try {
        const { cropId } = req.params;
        const deleted = await CropModel.deleteCrop(cropId, req.user.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Crop listing not found or unauthorized." });
        }
        return res.status(200).json({ success: true, message: "Crop listing deleted successfully." });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to delete crop.", error: error.message });
    }
};

// ================================================================
// Controller: View Buyer Interests & Ratings
// ================================================================

/**
 * @route   GET /api/farmer/interests
 * @desc    View all buyers who have expressed interest in the farmer's crops with ratings
 * @access  Protected (Farmer)
 */
const getFarmerInterests = async (req, res) => {
    try {
        const { cropId } = req.query;
        const farmerCrops = await CropModel.findByFarmerId(req.user.id);
        const relevantCrops = cropId
            ? farmerCrops.filter((c) => c.id === cropId)
            : farmerCrops;

        const allInterests = [];
        for (const crop of relevantCrops) {
            const interests = await InterestModel.findByCropId(crop.id);
            for (const item of interests) {
                allInterests.push({
                    interest_id: item.id,
                    crop_id: crop.id,
                    crop_name: crop.crop_name,
                    crop_type: crop.crop_type,
                    rating: item.rating,
                    notes: item.notes,
                    created_at: item.created_at,
                    buyer: item.buyer
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: `Found ${allInterests.length} buyer interest record(s).`,
            data: allInterests
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch buyer interests.", error: error.message });
    }
};

// ================================================================
// Controller: Farmer-to-Buyer Calling
// ================================================================

/**
 * @route   POST /api/farmer/calls/initiate
 * @desc    Farmer calls a buyer who has expressed interest in their crops.
 *          Call is permitted ONLY if:
 *          1. The buyer has expressed interest in the farmer's crop(s).
 *          2. The buyer's call availability is ON.
 * @access  Protected (Farmer)
 * @body    { buyer_id: UUID, crop_id?: UUID }
 */
const callBuyer = async (req, res) => {
    try {
        const { buyer_id, crop_id } = req.body;
        if (!buyer_id) {
            return res.status(400).json({ success: false, message: "buyer_id is required." });
        }

        const buyer = await UserModel.findById(buyer_id);
        if (!buyer || buyer.role !== ROLES.BUYER) {
            return res.status(404).json({ success: false, message: "Buyer profile not found." });
        }

        // 1. Verify buyer has expressed interest in this farmer's crop
        let hasInterest = false;
        if (crop_id) {
            const crop = await CropModel.findById(crop_id);
            if (!crop || crop.farmer_id !== req.user.id) {
                return res.status(400).json({ success: false, message: "Specified crop does not belong to you." });
            }
            hasInterest = await InterestModel.hasExpressedInterest(crop_id, buyer_id);
        } else {
            hasInterest = await InterestModel.hasInterestInFarmerCrops(req.user.id, buyer_id);
        }

        if (!hasInterest) {
            await CallModel.logCall({
                caller_id: req.user.id,
                receiver_id: buyer_id,
                crop_id: crop_id || null,
                caller_role: ROLES.FARMER,
                receiver_role: ROLES.BUYER,
                status: "blocked_no_interest"
            });

            return res.status(403).json({
                success: false,
                call_permitted: false,
                message: "You can only call buyers who have expressed interest in your crops."
            });
        }

        // 2. Check receiving buyer's call availability status
        const isBuyerAvailable = await CallModel.getUserAvailability(buyer_id);
        if (!isBuyerAvailable) {
            await CallModel.logCall({
                caller_id: req.user.id,
                receiver_id: buyer_id,
                crop_id: crop_id || null,
                caller_role: ROLES.FARMER,
                receiver_role: ROLES.BUYER,
                status: "blocked_receiver_unavailable"
            });

            return res.status(403).json({
                success: false,
                call_permitted: false,
                message: "Buyer is currently not available to receive calls. Call availability is turned OFF.",
                data: {
                    receiver_id: buyer_id,
                    receiver_name: buyer.full_name,
                    is_call_available: false
                }
            });
        }

        // 3. Receiver availability is ON -> Permit call & reveal contact number
        const buyerPhone = buyer.mobile_number || buyer.phone;
        const callLog = await CallModel.logCall({
            caller_id: req.user.id,
            receiver_id: buyer_id,
            crop_id: crop_id || null,
            caller_role: ROLES.FARMER,
            receiver_role: ROLES.BUYER,
            status: "permitted",
            phone_revealed: buyerPhone
        });

        return res.status(200).json({
            success: true,
            call_permitted: true,
            message: "Buyer is available. Call initiated successfully.",
            data: {
                call_id: callLog.id,
                receiver_id: buyer.id,
                receiver_name: buyer.full_name,
                receiver_phone: buyerPhone,
                receiver_role: ROLES.BUYER,
                receiver_availability: "ON",
                crop_id: crop_id || null,
                call_status: "permitted"
            }
        });
    } catch (error) {
        console.error("Farmer Call Buyer Error:", error);
        return res.status(500).json({ success: false, message: "Failed to initiate call.", error: error.message });
    }
};

module.exports = {
    farmerRegister,
    farmerLogin,
    getFarmerProfile,
    getCallAvailability,
    setCallAvailability,
    uploadCrop,
    getMyCrops,
    getCropDetail,
    deleteCrop,
    getFarmerInterests,
    callBuyer
};
