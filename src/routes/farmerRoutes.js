const express = require("express");
const router = express.Router();
const farmerController = require("../controllers/farmerController");
const { authenticate, authorize, requireApproved } = require("../middlewares/authMiddleware");
const { upload } = require("../config/multer");
const { ROLES } = require("../models/userModel");

// ================================================================
// PUBLIC ROUTES
// ================================================================

/**
 * @route   POST /api/farmer/register
 * @desc    Submit a new farmer registration request (after OTP verification)
 * @access  Public
 * @body    FormData – all fields + photo file
 *
 * Required fields:
 *   full_name, age, mobile_number, nationality, state, taluka, city,
 *   full_address, land_location, preferred_language, phone_verified_token
 * Required file:
 *   photo (passport-size photograph, max 5MB, JPEG/PNG/WEBP)
 */
router.post(
    "/register",
    upload.single("photo"),
    farmerController.farmerRegister
);

/**
 * @route   POST /api/farmer/login
 * @desc    Existing approved farmer login using credentials from approval email
 * @access  Public
 * @body    { login_id: "email@example.com", password: "..." }
 */
router.post("/login", farmerController.farmerLogin);

// ================================================================
// PROTECTED ROUTES (Authenticated + Approved Farmers only)
// ================================================================

/**
 * @route   GET /api/farmer/profile
 * @desc    Get authenticated farmer's own profile
 * @access  Protected (Farmer, Approved)
 */
router.get(
    "/profile",
    authenticate,
    authorize(ROLES.FARMER),
    requireApproved,
    farmerController.getFarmerProfile
);

module.exports = router;
