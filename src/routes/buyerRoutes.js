const express = require("express");
const router = express.Router();
const { validateImages } = require("../middlewares/images");
const buyerController = require("../controllers/buyerController");
const callRequestController = require("../controllers/callRequestController");
const { authenticate, authorize, requireApproved, requirePasswordChanged } = require("../middlewares/authMiddleware");
const { upload } = require("../config/multer");
const { ROLES } = require("../models/userModel");

// Common guard for buyer protected routes
const accountAuth = [authenticate, authorize(ROLES.BUYER), requireApproved];
const buyerAuth = [...accountAuth, requirePasswordChanged];
const { forgotPassword, resetPassword, changePassword } = require("../controllers/accountController");
const { registrationLimit, loginLimit, recoveryLimit, passwordLimit } = require("../middlewares/rateLimits");

// ================================================================
// PUBLIC ROUTES
// ================================================================

/**
 * @route   POST /api/buyer/register
 * @desc    Submit a new buyer registration request (manual admin review; no OTP)
 * @access  Public
 */
router.post(
    "/register",
    registrationLimit,
    upload.single("photo"),
    validateImages,
    buyerController.buyerRegister
);

/**
 * @route   POST /api/buyer/login
 * @desc    Existing approved buyer login using credentials from approval email
 * @access  Public
 */
router.post("/login", loginLimit, buyerController.buyerLogin);
router.post("/forgot-password", recoveryLimit, forgotPassword(ROLES.BUYER));
router.post("/reset-password", passwordLimit, resetPassword(ROLES.BUYER));
router.post("/change-password", accountAuth, passwordLimit, changePassword);

// ================================================================
// PROTECTED ROUTES (Authenticated + Approved Buyers only)
// ================================================================

/**
 * @route   GET /api/buyer/profile
 * @desc    Get authenticated buyer's own profile (including call availability)
 * @access  Protected (Buyer, Approved)
 */
router.get("/profile", accountAuth, buyerController.getBuyerProfile);
router.patch("/profile", accountAuth, buyerController.updateBuyerProfile);
router.put("/profile", accountAuth, buyerController.updateBuyerProfile);

// ----------------------------------------------------------------
// CALL AVAILABILITY
// ----------------------------------------------------------------

/**
 * @route   GET /api/buyer/availability
 * @desc    Get buyer's current call availability status
 * @access  Protected (Buyer, Approved)
 */
router.get("/availability", buyerAuth, buyerController.getCallAvailability);

/**
 * @route   PATCH /api/buyer/availability
 * @desc    Update buyer's call availability ON or OFF
 * @access  Protected (Buyer, Approved)
 * @body    { is_call_available: true/false } or { status: "ON"/"OFF" }
 */
router.patch("/availability", buyerAuth, buyerController.setCallAvailability);
router.put("/availability", buyerAuth, buyerController.setCallAvailability);

// ----------------------------------------------------------------
// CROP CATALOG & MARKETPLACE
// ----------------------------------------------------------------

/**
 * @route   GET /api/buyer/crops
 * @desc    View all available crops uploaded by farmers with photos, quantity,
 *          crop type (organic/inorganic), price, description, farmer availability, and ratings
 * @access  Protected (Buyer, Approved)
 * @query   type (organic / inorganic), search (crop name), sort
 */
router.get("/crops", buyerAuth, buyerController.getAvailableCrops);

/**
 * @route   GET /api/buyer/crops/:cropId
 * @desc    View single crop details including farmer info and call availability
 * @access  Protected (Buyer, Approved)
 */
router.get("/crops/:cropId", buyerAuth, buyerController.getCropDetail);

// ----------------------------------------------------------------
// INTEREST & RATINGS
// ----------------------------------------------------------------

/**
 * @route   POST /api/buyer/crops/:cropId/interest
 * @desc    Express interest in a crop through rating (1-5 stars) and optional notes
 * @access  Protected (Buyer, Approved)
 * @body    { rating: 1-5, notes?: string }
 */
router.post("/crops/:cropId/interest", buyerAuth, buyerController.expressInterest);
router.post("/crops/:cropId/rate", buyerAuth, buyerController.expressInterest);

/**
 * @route   GET /api/buyer/interests
 * @desc    Get all crops this buyer has expressed interest in
 * @access  Protected (Buyer, Approved)
 */
router.get("/interests", buyerAuth, buyerController.getMyInterests);

// ----------------------------------------------------------------
// BUYER-TO-FARMER CALLING & APPROVAL REQUESTS
// ----------------------------------------------------------------

/**
 * @route   POST /api/buyer/calls/request
 * @desc    Submit a call request to a farmer.
 *          Farmer phone is not revealed until approved by the farmer.
 * @access  Protected (Buyer, Approved)
 */
router.post("/calls/request", buyerAuth, callRequestController.buyerCreateCallRequest);

/**
 * @route   GET /api/buyer/calls/requests
 * @desc    Get buyer's submitted call requests and contact info if approved
 * @access  Protected (Buyer, Approved)
 */
router.get("/calls/requests", buyerAuth, callRequestController.buyerListCallRequests);

/**
 * @route   GET /api/buyer/calls/requests/:id
 * @desc    Get single call request detail
 * @access  Protected (Buyer, Approved)
 */
router.get("/calls/requests/:id", buyerAuth, callRequestController.buyerGetCallRequestDetail);

/**
 * @route   POST /api/buyer/calls/initiate
 * @desc    Buyer calls a farmer.
 *          Permitted ONLY when that farmer's call availability is ON.
 *          Blocked when farmer's call availability is OFF.
 * @access  Protected (Buyer, Approved)
 * @body    { farmer_id: UUID, crop_id?: UUID }
 */
router.post("/calls/initiate", buyerAuth, buyerController.callFarmer);
router.post("/calls", buyerAuth, buyerController.callFarmer);
router.post("/crops/:cropId/call", buyerAuth, buyerController.callFarmer);

module.exports = router;
