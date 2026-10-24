const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { isConfigured } = require("./src/config/supabase");
const authRoutes = require("./src/routes/authRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// Enable Cross-Origin Resource Sharing
app.use(cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Root Health & Information Route
app.get("/", (req, res) => {
    res.json({
        name: "SetuMoolya (सेतुमूल्य) API",
        tagline: "Every Root Deserves Its Worth - AgriTech Value Chain Platform",
        status: "online",
        version: "1.0.0",
        database: isConfigured ? "Supabase Connected" : "Supabase Pending Configuration in .env",
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

// API Overview Route
app.get("/api/endpoints", (req, res) => {
    res.json({
        status: "active",
        endpoints: {
            auth: {
                register: "POST /api/auth/register",
                login: "POST /api/auth/login",
                refresh: "POST /api/auth/refresh",
                me: "GET /api/auth/me (Protected)",
                updateMe: "PUT /api/auth/me (Protected)",
                logout: "POST /api/auth/logout (Protected)",
                testRoles: [
                    "GET /api/auth/test/farmer-portal (Farmer/FPO)",
                    "GET /api/auth/test/buyer-escrow (Buyer + Verified)",
                    "GET /api/auth/test/lab-certification (Lab)"
                ],
                admin: [
                    "GET /api/auth/admin/users",
                    "PUT /api/auth/admin/users/:userId/kyc"
                ]
            }
        }
    });
});

// Mount Routes
app.use("/api/auth", authRoutes);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Endpoint ${req.method} ${req.originalUrl} not found on this server.`
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error("Unhandled Server Error:", err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal server error occurred."
    });
});

// Start Server
app.listen(PORT, () => {
    console.log("=================================================");
    console.log(`🌿 SetuMoolya Backend Server Running on Port ${PORT}`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`🛡️  Auth & Authorization: Active with Supabase`);
    if (!isConfigured) {
        console.log(`⚠️  ACTION NEEDED: Update .env with your Supabase credentials!`);
    } else {
        console.log(`✅ Supabase Database: Connected`);
    }
    console.log("=================================================");
});

module.exports = app;
