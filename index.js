const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const { isConfigured } = require("./src/config/supabase");

// Route Modules
const adminRoutes = require("./src/routes/adminRoutes");
const farmerRoutes = require("./src/routes/farmerRoutes");
const buyerRoutes = require("./src/routes/buyerRoutes");
const otpRoutes = require("./src/routes/otpRoutes");

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

// Static file serving – passport photographs
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ================================================================
// Health & Info Routes
// ================================================================

app.get("/", (req, res) => {
    res.json({
        name: "SetuMoolya (सेतुमूल्य) API",
        tagline: "Every Root Deserves Its Worth – AgriTech Value Chain Platform",
        status: "online",
        version: "2.0.0",
        database: isConfigured ? "Supabase Connected" : "Supabase Pending Configuration in .env",
        modules: ["Admin", "Farmer", "Buyer"],
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
        version: "2.0.0",
        modules: {
            otp: {
                sendOtp: "POST /api/otp/send",
                verifyOtp: "POST /api/otp/verify"
            },
            admin: {
                login: "POST /api/admin/login",
                dashboard: "GET /api/admin/dashboard (Protected – Admin)",
                getRequest: "GET /api/admin/requests/:requestId (Protected – Admin)",
                approveRequest: "POST /api/admin/requests/:requestId/approve (Protected – Admin)",
                rejectRequest: "POST /api/admin/requests/:requestId/reject (Protected – Admin)",
                listUsers: "GET /api/admin/users (Protected – Admin)"
            },
            farmer: {
                register: "POST /api/farmer/register (multipart/form-data)",
                login: "POST /api/farmer/login",
                profile: "GET /api/farmer/profile (Protected – Farmer)"
            },
            buyer: {
                register: "POST /api/buyer/register (multipart/form-data)",
                login: "POST /api/buyer/login",
                profile: "GET /api/buyer/profile (Protected – Buyer)"
            }
        }
    });
});

// ================================================================
// Mount API Routes
// ================================================================

app.use("/api/otp", otpRoutes);
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
    if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
            success: false,
            message: "Uploaded file is too large. Maximum allowed size is 5 MB."
        });
    }
    if (err.message && err.message.includes("Only JPEG")) {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal server error occurred."
    });
});

// ================================================================
// Start Server
// ================================================================

app.listen(PORT, () => {
    console.log("=================================================");
    console.log(`🌿 SetuMoolya Backend Server Running on Port ${PORT}`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`📋 Modules: Admin | Farmer | Buyer`);
    console.log(`🔐 OTP Verification: Active`);
    console.log(`📸 Photo Uploads: /uploads/photos/`);
    if (!isConfigured) {
        console.log(`⚠️  ACTION NEEDED: Update .env with your Supabase credentials!`);
    } else {
        console.log(`✅ Supabase Database: Connected`);
    }
    console.log("=================================================");
});

module.exports = app;
