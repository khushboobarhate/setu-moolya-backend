const express = require("express");
const router = express.Router();
const otpController = require("../controllers/otpController");

/**
 * OTP Routes
 * Used by both Farmers and Buyers before submitting registration.
 */

/**
 * @route   POST /api/otp/send
 * @desc    Send via Twilio/dev; MSG91 sends OTP through its browser widget
 * @access  Public
 * @body    { phone: "+919876543210" }
 */
router.post("/send", otpController.sendOtp);

/**
 * @route   POST /api/otp/verify
 * @desc    Verify OTP or MSG91 widget access token for registration
 * @access  Public
 * @body    { phone: "+919876543210", otp: "123456" } or { phone, access_token }
 */
router.post("/verify", otpController.verifyOtp);

module.exports = router;
