const express = require("express");
const router = express.Router();
const otpController = require("../controllers/otpController");

/**
 * OTP Routes
 * Used by both Farmers and Buyers before submitting registration.
 */

/**
 * @route   POST /api/otp/send
 * @desc    Send a 6-digit OTP to the provided mobile number
 * @access  Public
 * @body    { phone: "+919876543210" }
 */
router.post("/send", otpController.sendOtp);

/**
 * @route   POST /api/otp/verify
 * @desc    Verify the OTP and receive a phone_verified_token for registration
 * @access  Public
 * @body    { phone: "+919876543210", otp: "123456" }
 */
router.post("/verify", otpController.verifyOtp);

module.exports = router;
