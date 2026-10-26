const express = require("express");
const router = express.Router();
const farmerController = require("../controllers/farmerController");
const { authenticate, authorize, requireApproved, requirePasswordChanged } = require("../middlewares/authMiddleware");
const { upload, uploadCrop } = require("../config/multer");
const { ROLES } = require("../models/userModel");

// Common guard for farmer protected routes
const accountAuth = [authenticate, authorize(ROLES.FARMER), requireApproved];
const farmerAuth = [...accountAuth, requirePasswordChanged];
const { forgotPassword, resetPassword, changePassword } = require("../controllers/accountController");
const { registrationLimit, loginLimit, recoveryLimit, passwordLimit } = require("../middlewares/rateLimits");

// ================================================================
// PUBLIC ROUTES
// ================================================================

/**
 * @route   POST /api/farmer/register
 * @desc    Submit a new farmer registration request (manual admin review; no OTP)
 * @access  Public
 */
router.post(
    "/register",
    registrationLimit,
    upload.single("photo"),
    farmerController.farmerRegister
);

/**
 * @route   POST /api/farmer/login
 * @desc    Existing approved farmer login using credentials from approval email
 * @access  Public
 */
router.post("/login", loginLimit, farmerController.farmerLogin);
router.post("/forgot-password", recoveryLimit, forgotPassword(ROLES.FARMER));
router.post("/reset-password", passwordLimit, resetPassword(ROLES.FARMER));
router.post("/change-password", accountAuth, passwordLimit, changePassword);

// ================================================================
// PROTECTED ROUTES (Authenticated + Approved Farmers only)
// ================================================================

/**
 * @route   GET /api/farmer/profile
 * @desc    Get authenticated farmer's own profile (including call availability)
 * @access  Protected (Farmer, Approved)
 */
router.get("/profile", accountAuth, farmerController.getFarmerProfile);

// ----------------------------------------------------------------
// CALL AVAILABILITY
// ----------------------------------------------------------------

/**
 * @route   GET /api/farmer/availability
 * @desc    Get farmer's current call availability status
 * @access  Protected (Farmer, Approved)
 */
router.get("/availability", farmerAuth, farmerController.getCallAvailability);

/**
 * @route   PATCH /api/farmer/availability
 * @desc    Update farmer's call availability ON or OFF
 * @access  Protected (Farmer, Approved)
 * @body    { is_call_available: true/false } or { status: "ON"/"OFF" }
 */
router.patch("/availability", farmerAuth, farmerController.setCallAvailability);
router.put("/availability", farmerAuth, farmerController.setCallAvailability);

// ----------------------------------------------------------------
// CROP LISTINGS MANAGEMENT
// ----------------------------------------------------------------

/**
 * @route   POST /api/farmer/crops
 * @desc    Upload a new crop listing with photos, quantity, organic/inorganic type, price, description
 * @access  Protected (Farmer, Approved)
 * @body    FormData: crop_name, crop_type, quantity, quantity_unit, price, description
 * @files   photos (multiple) or photo (single)
 */
router.post(
    "/crops",
    farmerAuth,
    uploadCrop.fields([
        { name: "photos", maxCount: 10 },
        { name: "photo", maxCount: 1 }
    ]),
    farmerController.uploadCrop
);

/**
 * @route   GET /api/farmer/crops
 * @desc    List all crops uploaded by authenticated farmer with interest & rating metrics
 * @access  Protected (Farmer, Approved)
 */
router.get("/crops", farmerAuth, farmerController.getMyCrops);

/**
 * @route   GET /api/farmer/crops/:cropId
 * @desc    Get single crop details with all interested buyers and ratings
 * @access  Protected (Farmer, Approved)
 */
router.get("/crops/:cropId", farmerAuth, farmerController.getCropDetail);

/**
 * @route   DELETE /api/farmer/crops/:cropId
 * @desc    Delete/remove crop listing
 * @access  Protected (Farmer, Approved)
 */
router.delete("/crops/:cropId", farmerAuth, farmerController.deleteCrop);

// ----------------------------------------------------------------
// BUYER INTERESTS & RATINGS VISIBILITY
// ----------------------------------------------------------------

/**
 * @route   GET /api/farmer/interests
 * @desc    View all buyers interested in this farmer's crops with interest ratings
 * @access  Protected (Farmer, Approved)
 * @query   cropId (optional)
 */
router.get("/interests", farmerAuth, farmerController.getFarmerInterests);

// ----------------------------------------------------------------
// FARMER-TO-BUYER CALLING
// ----------------------------------------------------------------

/**
 * @route   POST /api/farmer/calls/initiate
 * @desc    Farmer calls an interested buyer.
 *          Permitted only if the buyer has expressed interest AND buyer's availability is ON.
 * @access  Protected (Farmer, Approved)
 * @body    { buyer_id: UUID, crop_id?: UUID }
 */
router.post("/calls/initiate", farmerAuth, farmerController.callBuyer);
router.post("/calls", farmerAuth, farmerController.callBuyer);

module.exports = router;
