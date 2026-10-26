const { unlink } = require("node:fs/promises");
const { isConfigured } = require("../config/supabase");
const { UserModel, ROLES, REG_STATUS } = require("../models/userModel");
const { text, normalizeEmail, isEmail } = require("../utils/validation");

// The route controls the role; public input cannot grant approval or privileges.
const register = (role) => async (req, res) => {
    let saved = false;
    try {
        if (!isConfigured) return res.status(503).json({ success: false, message: "Database service not configured." });
        const body = req.body || {};
        const payload = {};
        for (const key of ["full_name", "mobile_number", "nationality", "state", "taluka", "city", "full_address", "land_location", "preferred_language"]) {
            if (body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > 2000)) {
                return res.status(400).json({ success: false, message: `${key} must be text with at most 2000 characters.` });
            }
            payload[key] = text(body[key]) || null;
        }
        payload.email = normalizeEmail(body.email);
        const required = ["full_name", "email", "mobile_number", "state", "city", "full_address"];
        if (role === ROLES.FARMER) required.push("land_location");
        const missing = required.filter((key) => !payload[key]);
        if (missing.length) return res.status(400).json({ success: false, message: `Missing required fields: ${missing.join(", ")}` });
        if (!isEmail(payload.email)) return res.status(400).json({ success: false, message: "A valid contact email is required for credentials and password recovery." });
        payload.mobile_number = payload.mobile_number.replace(/[\s()-]/g, "");
        if (!/^\+?[0-9]{10,15}$/.test(payload.mobile_number)) {
            return res.status(400).json({ success: false, message: "Mobile number must contain 10–15 digits, optionally prefixed with '+'." });
        }
        const age = body.age;
        if (age !== undefined && age !== "" && (typeof age !== "number" && typeof age !== "string" || !/^\d+$/.test(String(age)) || !Number.isInteger(Number(age)) || Number(age) < 18 || Number(age) > 120)) {
            return res.status(400).json({ success: false, message: "Age, when provided, must be an integer between 18 and 120." });
        }
        payload.age = age === undefined || age === "" ? null : Number(age);
        payload.preferred_language ||= "en";
        payload.land_location = role === ROLES.FARMER ? payload.land_location : null;
        payload.photo_url = req.file ? `/uploads/photos/${req.file.filename}` : null;
        payload.role = role;
        payload.status = REG_STATUS.PENDING;

        if (await UserModel.findByEmail(payload.email) || await UserModel.findActiveRegistrationByEmail(payload.email)) {
            return res.status(409).json({ success: false, message: "This email already has an account or an active registration request. Use Forgot password for an approved account." });
        }
        const request = await UserModel.createRegistrationRequest(payload);
        saved = true;
        return res.status(201).json({
            success: true,
            message: "Your registration has been submitted for admin review. Login credentials will be emailed after approval.",
            data: {
                request_id: request.id, role: request.role, full_name: request.full_name,
                email: request.email, photo_url: request.photo_url, status: request.status,
                preferred_language: request.preferred_language
            }
        });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ success: false, message: "This email already has an active registration request." });
        console.error("Registration failed:", error.message);
        return res.status(500).json({ success: false, message: "Failed to submit registration. Please try again." });
    } finally {
        if (!saved && req.file?.path) await unlink(req.file.path).catch((error) => console.error("Upload cleanup failed:", error.message));
    }
};

module.exports = { register };
