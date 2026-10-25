const express = require("express");
const router = express.Router();
const buyerController = require("../controllers/buyerController");
const { authenticate, authorize, requireApproved } = require("../middlewares/authMiddleware");
const { upload } = require("../config/multer");
const { ROLES } = require("../models/userModel");

// ================================================================
// PUBLIC ROUTES
// ================================================================

/**
 * @route   POST /api/buyer/register
 * @desc    Submit a new buyer registration request (after OTP verification)
 * @access  Public
 * @body    FormData – all fields + photo file
 *
 * Required fields:
 *   full_name, age, mobile_number, nationality, state, taluka, city,
 *   full_address, preferred_language, phone_verified_token
 * Required file:
 *   photo (passport-size photograph, max 5MB, JPEG/PNG/WEBP)
 */
router.post(
    "/register",
    upload.single("photo"),
    buyerController.buyerRegister
);

/**
 * @route   POST /api/buyer/login
 * @desc    Existing approved buyer login using credentials from approval email
 * @access  Public
 * @body    { login_id: "email@example.com", password: "..." }
 */
router.post("/login", buyerController.buyerLogin);

// ================================================================
// PROTECTED ROUTES (Authenticated + Approved Buyers only)
// ================================================================

/**
 * @route   GET /api/buyer/profile
 * @desc    Get authenticated buyer's own profile
 * @access  Protected (Buyer, Approved)
 */
router.get(
    "/profile",
    authenticate,
    authorize(ROLES.BUYER),
    requireApproved,
    buyerController.getBuyerProfile
);

module.exports = router;
