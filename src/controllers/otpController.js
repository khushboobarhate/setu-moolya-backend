const { UserModel } = require("../models/userModel");
require("dotenv").config();

/**
 * OTP Configuration
 * In production, integrate an SMS gateway (Twilio, MSG91, etc.)
 * For development, the OTP is logged to console and returned in the response.
 */
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || "10");
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Generate a 6-digit numeric OTP
 */
const generateOtp = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send OTP via SMS gateway
 * Replace the stub below with your actual SMS provider integration.
 */
const sendSmsOtp = async (phone, otp) => {
    const smsProvider = process.env.SMS_PROVIDER; // "twilio" | "msg91" | "dev"

    if (smsProvider === "twilio") {
        // ---- Twilio Integration ----
        const twilio = require("twilio");
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
            body: `Your SetuMoolya OTP is: ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this with anyone.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        return { sent: true, provider: "twilio" };
    }

    if (smsProvider === "msg91") {
        // ---- MSG91 Integration ----
        const axios = require("axios");
        await axios.get("https://api.msg91.com/api/sendotp.php", {
            params: {
                authkey: process.env.MSG91_AUTH_KEY,
                mobile: phone,
                message: `Your SetuMoolya OTP is ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`,
                sender: process.env.MSG91_SENDER_ID || "SEMOOLYA",
                otp
            }
        });
        return { sent: true, provider: "msg91" };
    }

    // Development / Fallback: Log OTP to console (never expose in production)
    console.log(`[DEV OTP] Phone: ${phone} | OTP: ${otp} | Expires in ${OTP_EXPIRY_MINUTES} min`);
    return { sent: true, provider: "dev-console" };
};

// ================================================================
// Controller: Send OTP
// ================================================================

/**
 * @route   POST /api/otp/send
 * @desc    Send a 6-digit OTP to the provided mobile number
 * @access  Public
 * @body    { phone: "+919876543210" }
 */
const sendOtp = async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Mobile number (phone) is required."
            });
        }

        // Basic phone validation – must be 10-15 digits, optionally prefixed with +
        const phoneRegex = /^\+?[0-9]{10,15}$/;
        if (!phoneRegex.test(phone.replace(/\s/g, ""))) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format. Expected 10–15 digits, optionally prefixed with '+'."
            });
        }

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

        // Persist OTP to database
        await UserModel.storeOtp({ phone, otp, expiresAt });

        // Send via SMS provider
        const smsResult = await sendSmsOtp(phone, otp);

        const response = {
            success: true,
            message: `OTP sent successfully to ${phone}. It will expire in ${OTP_EXPIRY_MINUTES} minutes.`,
            provider: smsResult.provider
        };

        // In development mode, expose OTP in response for testing
        if (IS_DEV) {
            response.otp = otp; // REMOVE in production!
            response._dev_notice = "OTP is only visible in development mode (NODE_ENV=development).";
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error("Send OTP Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP.",
            error: error.message
        });
    }
};

// ================================================================
// Controller: Verify OTP
// ================================================================

/**
 * @route   POST /api/otp/verify
 * @desc    Verify a mobile OTP. Returns a verified token for completing registration.
 * @access  Public
 * @body    { phone: "+919876543210", otp: "123456" }
 */
const verifyOtp = async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Both phone and otp are required."
            });
        }

        const result = await UserModel.verifyOtp(phone, otp);

        if (!result.valid) {
            return res.status(400).json({
                success: false,
                message: result.message
            });
        }

        // Issue a short-lived phone-verified token so the frontend can
        // proceed to full registration submission.
        const jwt = require("jsonwebtoken");
        const secret = process.env.JWT_SECRET || "setumoolya-otp-secret";
        const verifiedToken = jwt.sign(
            { phone, purpose: "otp_verified" },
            secret,
            { expiresIn: "30m" }
        );

        return res.status(200).json({
            success: true,
            message: "Mobile number verified successfully.",
            phone_verified_token: verifiedToken
        });
    } catch (error) {
        console.error("Verify OTP Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to verify OTP.",
            error: error.message
        });
    }
};

module.exports = { sendOtp, verifyOtp };
