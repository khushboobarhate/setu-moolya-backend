const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { authenticate, authorize } = require("../middlewares/authMiddleware");
const { loginLimit } = require("../middlewares/rateLimits");
const { ROLES } = require("../models/userModel");

// ================================================================
// PUBLIC ADMIN ROUTES
// ================================================================

/**
 * @route   POST /api/admin/login
 * @desc    Admin direct login with email and password
 * @access  Public
 * @body    { email: "admin@setumoolya.com", password: "..." }
 */
router.post("/login", loginLimit, adminController.adminLogin);

router.get("/requests", authenticate, authorize(ROLES.ADMIN), adminController.getDashboard);
router.patch("/requests/:requestId", authenticate, authorize(ROLES.ADMIN), adminController.updateRequestEmail);
router.post("/requests/:requestId/send-credentials", authenticate, authorize(ROLES.ADMIN), adminController.sendCredentials);

// ================================================================
// PROTECTED ADMIN ROUTES
// All routes below require: authenticate + authorize(ROLES.ADMIN)
// ================================================================

/**
 * @route   GET /api/admin/dashboard
 * @desc    Fetch all pending Farmer and Buyer registration requests
 * @access  Protected (Admin)
 * @query   role (optional: "farmer"|"buyer"), page, limit
 */
router.get(
    "/dashboard",
    authenticate,
    authorize(ROLES.ADMIN),
    adminController.getDashboard
);

/**
 * @route   GET /api/admin/requests/:requestId
 * @desc    Get full detail of a specific registration request
 * @access  Protected (Admin)
 */
router.get(
    "/requests/:requestId",
    authenticate,
    authorize(ROLES.ADMIN),
    adminController.getRequestDetail
);

/**
 * @route   POST /api/admin/requests/:requestId/approve
 * @desc    Approve a Farmer/Buyer registration request.
 *          Creates their login account and sends approval email with credentials.
 * @access  Protected (Admin)
 */
router.post(
    "/requests/:requestId/approve",
    authenticate,
    authorize(ROLES.ADMIN),
    adminController.approveRequest
);

/**
 * @route   POST /api/admin/requests/:requestId/reject
 * @desc    Reject a Farmer/Buyer registration request and send rejection email.
 * @access  Protected (Admin)
 */
router.post(
    "/requests/:requestId/reject",
    authenticate,
    authorize(ROLES.ADMIN),
    adminController.rejectRequest
);

/**
 * @route   GET /api/admin/users
 * @desc    List all approved Farmers or Buyers
 * @access  Protected (Admin)
 * @query   role ("farmer" | "buyer"), page, limit
 */
router.get(
    "/users",
    authenticate,
    authorize(ROLES.ADMIN),
    adminController.listApprovedUsers
);

/**
 * @route   GET /api/admin/crops
 * @desc    List all crops on the platform
 * @access  Protected (Admin)
 */
router.get(
    "/crops",
    authenticate,
    authorize(ROLES.ADMIN),
    adminController.listAllCrops
);

/**
 * @route   GET /api/admin/call-logs
 * @desc    List call history logs across the platform
 * @access  Protected (Admin)
 */
router.get(
    "/call-logs",
    authenticate,
    authorize(ROLES.ADMIN),
    adminController.listAllCallLogs
);

module.exports = router;
