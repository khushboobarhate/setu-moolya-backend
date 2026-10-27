const { isUuid, validText, decimal, CROP_UNITS, availabilityValue } = require("../utils/validation");
const { uploadedFiles, cleanupUploads, removeCropImages } = require("../middlewares/images");
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
        return res.status(500).json({ success: false, message: "Failed to fetch farmer profile." });
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
        return res.status(500).json({ success: false, message: "Failed to get call availability." });
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
        const isAvailable = availabilityValue(req.body);
        if (isAvailable === null) return res.status(400).json({ success: false, message: 'Use is_call_available: true/false, or status: ON/OFF.' });

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
        return res.status(500).json({ success: false, message: "Failed to update call availability." });
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
    let saved = false;
    try {
        const body = req.body || {};
        const crop_name = body.crop_name ?? body.name ?? body.title;
        const price = decimal(body.price ?? body.required_price);
        const quantity = decimal(body.quantity, { min: 0.001, places: 3 });
        const type = typeof body.crop_type === 'string' ? body.crop_type.toLowerCase() : '';
        const crop_type = type === 'non-organic' ? 'inorganic' : type;
        const unit = body.quantity_unit ?? 'kg';
        if (!validText(crop_name, 2, 150)) return res.status(400).json({ success: false, message: 'Crop name must contain 2–150 characters.' });
        if (!['organic', 'inorganic'].includes(crop_type)) return res.status(400).json({ success: false, message: 'Choose organic or inorganic for the crop type.' });
        if (quantity === null) return res.status(400).json({ success: false, message: 'Quantity must be 0.001–1,000,000,000, with up to 3 decimal places.' });
        if (price === null) return res.status(400).json({ success: false, message: 'Price must be 0–1,000,000,000, with up to 2 decimal places.' });
        if (!CROP_UNITS.includes(unit)) return res.status(400).json({ success: false, message: 'Choose kg, gram, quintal, or tonne.' });
        if (body.description !== undefined && !validText(body.description, 0, 3000, true)) return res.status(400).json({ success: false, message: 'Description must be text with at most 3000 characters.' });
        if (body.photos !== undefined) return res.status(400).json({ success: false, message: 'Upload image files; external photo URLs are not accepted.' });
        const photos = uploadedFiles(req).map(file => `/uploads/crops/${file.filename}`);
        const crop = await CropModel.createCrop({ farmer_id: req.user.id, crop_name: crop_name.trim(), crop_type, quantity, quantity_unit: unit, price, description: (body.description || '').trim(), photos });
        saved = true;
        return res.status(201).json({ success: true, message: 'Crop listing uploaded successfully.', data: crop });
    } catch (error) {
        console.error('Crop upload failed:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to upload crop. Please try again.' });
    } finally { if (!saved) await cleanupUploads(req); }
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
        return res.status(500).json({ success: false, message: "Failed to fetch farmer crops." });
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
        if (!isUuid(cropId)) return res.status(400).json({ success: false, message: 'A valid crop ID is required.' });
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
        return res.status(500).json({ success: false, message: "Failed to fetch crop detail." });
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
        if (!isUuid(cropId)) return res.status(400).json({ success: false, message: 'A valid crop ID is required.' });
        const crop = await CropModel.findById(cropId);
        if (!crop || crop.farmer_id !== req.user.id) return res.status(404).json({ success: false, message: 'Crop listing not found or unauthorized.' });
        const deleted = await CropModel.deleteCrop(cropId, req.user.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Crop listing not found or unauthorized." });
        }
        await removeCropImages(crop);
        return res.status(200).json({ success: true, message: "Crop listing deleted successfully." });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to delete crop." });
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
        if (cropId !== undefined && !isUuid(cropId)) return res.status(400).json({ success: false, message: 'A valid crop ID is required.' });
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
        return res.status(500).json({ success: false, message: "Failed to fetch buyer interests." });
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
        const { buyer_id, crop_id } = req.body || {};
        if (!isUuid(buyer_id) || crop_id !== undefined && !isUuid(crop_id)) return res.status(400).json({ success: false, message: 'Valid buyer and optional crop IDs are required.' });
        if (!buyer_id) {
            return res.status(400).json({ success: false, message: "buyer_id is required." });
        }

        const buyer = await UserModel.findById(buyer_id);
        if (!buyer || buyer.role !== ROLES.BUYER || !buyer.is_approved) {
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
        return res.status(500).json({ success: false, message: "Failed to initiate call." });
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
