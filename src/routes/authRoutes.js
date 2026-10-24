const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticate, authorize, requireVerified } = require("../middlewares/authMiddleware");
const { ROLES } = require("../models/userModel");

// ==========================================
// PUBLIC ROUTES
// ==========================================

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user (farmer, fpo, buyer, lab, logistics, admin)
 * @access  Public
 */
router.post("/register", authController.register);

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & get Supabase session/token
 * @access  Public
 */
router.post("/login", authController.login);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh Supabase access token
 * @access  Public
 */
router.post("/refresh", authController.refreshToken);

// ==========================================
// PROTECTED USER ROUTES (All authenticated users)
// ==========================================

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user profile
 * @access  Protected
 */
router.get("/me", authenticate, authController.getProfile);

/**
 * @route   PUT /api/auth/me
 * @desc    Update current authenticated user profile
 * @access  Protected
 */
router.put("/me", authenticate, authController.updateProfile);

/**
 * @route   POST /api/auth/logout
 * @desc    Invalidate user session
 * @access  Protected
 */
router.post("/logout", authenticate, authController.logout);

// ==========================================
// ROLE-PROTECTED TEST & ACTION ENDPOINTS
// ==========================================

/**
 * @route   GET /api/auth/test/farmer-portal
 * @desc    Accessible only by Farmers and FPOs
 * @access  Protected (Farmer, FPO)
 */
router.get(
    "/test/farmer-portal",
    authenticate,
    authorize(ROLES.FARMER, ROLES.FPO),
    (req, res) => {
        res.json({
            success: true,
            message: `Welcome to the Farmer & FPO aggregation terminal, ${req.user.profile.full_name}!`,
            user: req.user
        });
    }
);

/**
 * @route   GET /api/auth/test/buyer-escrow
 * @desc    Accessible only by Verified B2B Herb/Extract Buyers
 * @access  Protected (Buyer + Verified)
 */
router.get(
    "/test/buyer-escrow",
    authenticate,
    authorize(ROLES.BUYER),
    requireVerified,
    (req, res) => {
        res.json({
            success: true,
            message: `Verified B2B Buyer Escrow Terminal accessed by ${req.user.profile.full_name} (${req.user.profile.organization_name || "Company"}).`,
            user: req.user
        });
    }
);

/**
 * @route   GET /api/auth/test/lab-certification
 * @desc    Accessible only by Certified Quality Testing Labs
 * @access  Protected (Lab)
 */
router.get(
    "/test/lab-certification",
    authenticate,
    authorize(ROLES.LAB),
    (req, res) => {
        res.json({
            success: true,
            message: `Lab quality testing workbench accessed by ${req.user.profile.full_name}.`,
            user: req.user
        });
    }
);

// ==========================================
// ADMIN USER MANAGEMENT ROUTES
// ==========================================

/**
 * @route   GET /api/auth/admin/users
 * @desc    List all platform users by role (admin only)
 * @access  Protected (Admin)
 */
router.get(
    "/admin/users",
    authenticate,
    authorize(ROLES.ADMIN),
    authController.listUsers
);

/**
 * @route   PUT /api/auth/admin/users/:userId/kyc
 * @desc    Approve/Reject User KYC status and verification (admin only)
 * @access  Protected (Admin)
 */
router.put(
    "/admin/users/:userId/kyc",
    authenticate,
    authorize(ROLES.ADMIN),
    authController.setKycStatus
);

module.exports = router;
