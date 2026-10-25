const { UserModel } = require("../models/userModel");
const { randomInt } = require("crypto");
const { verifyMsg91WidgetAccessToken } = require("../services/msg91OtpService");
require("dotenv").config();

/**
 * OTP Configuration
 * The MSG91 browser widget handles sending and entering the OTP. The backend
 * validates the widget's access token before issuing its registration token.
 */
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || "10");
const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Generate a 6-digit numeric OTP
 */
const generateOtp = () => {
    return randomInt(100000, 1000000).toString();
};

/**
 * Return the configured SMS provider, rejecting unsupported values rather than silently
 * reporting a development-console send as successful.
 */
const getSmsProvider = () => {
    const smsProvider = process.env.SMS_PROVIDER;
    if (!["twilio", "msg91", "dev"].includes(smsProvider)) {
        throw new Error("Set SMS_PROVIDER to twilio, msg91, or dev.");
    }
    if (smsProvider === "dev" && !IS_DEV) {
        throw new Error("The dev SMS provider can only be used when NODE_ENV=development.");
    }
    return smsProvider;
};

const sendSmsOtp = async (phone, otp) => {
    const smsProvider = getSmsProvider();

    if (smsProvider === "msg91") {
        throw new Error("MSG91 OTPs must be sent using the configured browser widget.");
    }

    if (smsProvider === "twilio") {
        const twilio = require("twilio");
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
            body: `Your SetuMoolya OTP is: ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this with anyone.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        return { sent: true, provider: "twilio" };
    }

    console.log(`[DEV OTP] Phone: ${phone} | OTP: ${otp} | Expires in ${OTP_EXPIRY_MINUTES} min`);
    return { sent: true, provider: "dev-console" };
};

// ================================================================
// Controller: Send OTP
// ================================================================

/**
 * @route   POST /api/otp/send
 * @desc    Send using Twilio/dev; MSG91 uses its browser widget
 * @access  Public
 * @body    { phone: "+919876543210" }
 */
const sendOtp = async (req, res) => {
    try {
        const phone = typeof req.body.phone === "string"
            ? req.body.phone
            : "";
        const normalizedPhone = phone.replace(/\s/g, "");

        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: "Mobile number (phone) is required."
            });
        }

        // Basic phone validation – must be 10-15 digits, optionally prefixed with +
        const phoneRegex = /^\+?[0-9]{10,15}$/;
        if (!phoneRegex.test(normalizedPhone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format. Expected 10–15 digits, optionally prefixed with '+'."
            });
        }

        const smsProvider = getSmsProvider();
        if (!Number.isInteger(OTP_EXPIRY_MINUTES) || OTP_EXPIRY_MINUTES < 1) {
            throw new Error("OTP_EXPIRY_MINUTES must be a positive integer.");
        }

        if (smsProvider === "msg91") {
            return res.status(409).json({
                success: false,
                message: "Send OTP using the MSG91 browser widget, then submit its access token to POST /api/otp/verify."
            });
        }

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

        await UserModel.storeOtp({ phone, otp, expiresAt });
        const smsResult = await sendSmsOtp(phone, otp);

        const response = {
            success: true,
            message: `OTP sent successfully to ${phone}. It will expire in ${OTP_EXPIRY_MINUTES} minutes.`,
            provider: smsResult.provider
        };

        // In development mode, expose OTP in response for testing
        if (smsProvider === "dev" && IS_DEV) {
            response.otp = otp;
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
 * @desc    Verify OTP or widget token and return a registration token.
 * @access  Public
 * @body    { phone: "+919876543210", otp: "123456" } or { phone, access_token }
 */
const verifyOtp = async (req, res) => {
    try {
        const phone = typeof req.body.phone === "string"
            ? req.body.phone
            : "";
        const normalizedPhone = phone.replace(/\s/g, "");
        const otp = typeof req.body.otp === "string" ? req.body.otp.trim() : "";
        const accessToken = typeof req.body.access_token === "string"
            ? req.body.access_token.trim()
            : "";

        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: "Mobile number (phone) is required."
            });
        }

        if (!/^\+?[0-9]{10,15}$/.test(normalizedPhone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format. Expected 10–15 digits, optionally prefixed with '+'."
            });
        }

        const smsProvider = getSmsProvider();
        let result;
        if (smsProvider === "msg91") {
            if (!accessToken || accessToken.length > 8192) {
                return res.status(400).json({
                    success: false,
                    message: "A valid MSG91 widget access_token is required."
                });
            }
            result = await verifyMsg91WidgetAccessToken({
                accessToken,
                expectedPhone: normalizedPhone
            });
        } else {
            if (!/^[0-9]{6}$/.test(otp)) {
                return res.status(400).json({
                    success: false,
                    message: "A 6-digit OTP is required."
                });
            }
            result = await UserModel.verifyOtp(phone, otp);
        }

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
