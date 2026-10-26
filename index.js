const express = require("express");
const cors = require("cors");
require("dotenv").config({ quiet: true });

const { isConfigured } = require("./src/config/supabase");
const { UPLOAD_DIR, CROP_UPLOAD_DIR } = require("./src/config/multer");

// Route Modules
const adminRoutes = require("./src/routes/adminRoutes");
const farmerRoutes = require("./src/routes/farmerRoutes");
const buyerRoutes = require("./src/routes/buyerRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// ================================================================
// Middleware
// ================================================================

// CORS
app.use(cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Static file serving – passport photographs & crop listings
app.use("/uploads/photos", express.static(UPLOAD_DIR));
app.use("/uploads/crops", express.static(CROP_UPLOAD_DIR));

// ================================================================
// Health & Info Routes
// ================================================================

app.get("/", (req, res) => {
    res.json({
        name: "SetuMoolya (सेतुमूल्य) API",
        tagline: "Every Root Deserves Its Worth – Agricultural E-Commerce Platform",
        status: "online",
        version: "4.0.0",
        database: isConfigured ? "Supabase Configured" : "Supabase Pending Configuration in .env",
        modules: ["Admin", "Farmer", "Buyer"],
        features: [
            "Manual Admin Review & Email Credentials (No SMS OTP)",
            "Temporary Passwords & Email Password Recovery",
            "Farmer Crop Upload & Management",
            "Buyer Crop Catalog & Filter (Organic / Inorganic)",
            "Buyer Interest & 1-5 Star Rating System",
            "Independent Farmer & Buyer Call Availability (ON/OFF)",
            "Availability-Gated Farmer-Buyer Direct Calling"
        ],
        docs: "/api/endpoints"
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        supabase_ready: isConfigured
    });
});

// ================================================================
// API Overview
// ================================================================

app.get("/api/endpoints", (req, res) => {
    res.json({
        status: "active",
        version: "4.0.0",
        modules: {
            admin: {
                login: "POST /api/admin/login",
                listRequests: "GET /api/admin/requests?status=pending&role=farmer (Protected – Admin)",
                sendCredentials: "POST /api/admin/requests/:requestId/send-credentials (Protected – Admin)",
                updateRequestEmail: "PATCH /api/admin/requests/:requestId (Protected – Admin)",
                dashboard: "GET /api/admin/dashboard (Protected – Admin)",
                getRequest: "GET /api/admin/requests/:requestId (Protected – Admin)",
                approveRequest: "POST /api/admin/requests/:requestId/approve (Protected – Admin)",
                rejectRequest: "POST /api/admin/requests/:requestId/reject (Protected – Admin)",
                listUsers: "GET /api/admin/users (Protected – Admin)",
                listCrops: "GET /api/admin/crops (Protected – Admin)",
                listCallLogs: "GET /api/admin/call-logs (Protected – Admin)"
            },
            farmer: {
                register: "POST /api/farmer/register (JSON or multipart/form-data; photo optional)",
                login: "POST /api/farmer/login",
                forgotPassword: "POST /api/farmer/forgot-password",
                resetPassword: "POST /api/farmer/reset-password",
                changePassword: "POST /api/farmer/change-password (Protected)",
                profile: "GET /api/farmer/profile (Protected – Farmer)",
                getAvailability: "GET /api/farmer/availability (Protected – Farmer)",
                setAvailability: "PATCH /api/farmer/availability (Protected – Farmer)",
                uploadCrop: "POST /api/farmer/crops (multipart/form-data – Protected – Farmer)",
                listMyCrops: "GET /api/farmer/crops (Protected – Farmer)",
                getCropDetail: "GET /api/farmer/crops/:cropId (Protected – Farmer)",
                deleteCrop: "DELETE /api/farmer/crops/:cropId (Protected – Farmer)",
                listInterests: "GET /api/farmer/interests (Protected – Farmer)",
                callBuyer: "POST /api/farmer/calls/initiate (Protected – Farmer)"
            },
            buyer: {
                register: "POST /api/buyer/register (JSON or multipart/form-data; photo optional)",
                login: "POST /api/buyer/login",
                forgotPassword: "POST /api/buyer/forgot-password",
                resetPassword: "POST /api/buyer/reset-password",
                changePassword: "POST /api/buyer/change-password (Protected)",
                profile: "GET /api/buyer/profile (Protected – Buyer)",
                getAvailability: "GET /api/buyer/availability (Protected – Buyer)",
                setAvailability: "PATCH /api/buyer/availability (Protected – Buyer)",
                browseCrops: "GET /api/buyer/crops (Protected – Buyer)",
                getCropDetail: "GET /api/buyer/crops/:cropId (Protected – Buyer)",
                rateInterest: "POST /api/buyer/crops/:cropId/interest (Protected – Buyer)",
                listMyInterests: "GET /api/buyer/interests (Protected – Buyer)",
                callFarmer: "POST /api/buyer/calls/initiate (Protected – Buyer)"
            }
        }
    });
});

// ================================================================
// Mount API Routes
// ================================================================

app.use("/api/admin", adminRoutes);
app.use("/api/farmer", farmerRoutes);
app.use("/api/buyer", buyerRoutes);

// ================================================================
// 404 Handler
// ================================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Endpoint ${req.method} ${req.originalUrl} not found on this server.`
    });
});

// ================================================================
// Global Error Handler
// ================================================================

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error("Unhandled Server Error:", err.stack);

    // Handle Multer errors (file upload errors)
    if (err.name === "MulterError") {
        return res.status(400).json({ success: false, message: err.message });
    }
    if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
            success: false,
            message: "Uploaded file is too large. Maximum allowed size exceeded."
        });
    }
    if (err.message && (err.message.includes("Only JPEG") || err.message.includes("images are allowed"))) {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    res.status(err.status || 500).json({
        success: false,
        message: err.status && err.status < 500 ? err.message : "Internal server error occurred."
    });
});

// ================================================================
// Start Server
// ================================================================

if (process.env.NODE_ENV !== "test") {
    app.listen(PORT, () => {
        console.log("=================================================");
        console.log(`🌿 SetuMoolya Backend Server Running on Port ${PORT}`);
        console.log(`📡 URL: http://localhost:${PORT}`);
        console.log(`📋 Modules: Admin | Farmer | Buyer`);
        console.log(`🌾 Agri E-Commerce: Crops | Ratings | Calling Active`);
        console.log(`📸 Photo Uploads: /uploads/photos/ & /uploads/crops/`);
        if (!isConfigured) {
            console.log(`⚠️  ACTION NEEDED: Update .env with your Supabase credentials!`);
        } else {
            console.log(`✅ Supabase credentials configured`);
        }
        console.log("=================================================");
    });
}

module.exports = app;
