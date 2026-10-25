const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure upload directories exist
const UPLOAD_DIR = path.join(__dirname, "../../uploads/photos");
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const CROP_UPLOAD_DIR = path.join(__dirname, "../../uploads/crops");
if (!fs.existsSync(CROP_UPLOAD_DIR)) {
    fs.mkdirSync(CROP_UPLOAD_DIR, { recursive: true });
}

/**
 * Multer storage configuration for passport-size photographs
 * Files are stored locally and served as static assets.
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `photo-${uniqueSuffix}${ext}`);
    }
});

/**
 * Multer storage configuration for crop photographs
 */
const cropStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, CROP_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `crop-${uniqueSuffix}${ext}`);
    }
});

/**
 * Multer file filter – only allow image MIME types
 */
const fileFilter = (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only JPEG, PNG, and WEBP images are allowed for passport photographs."), false);
    }
};

const cropFileFilter = (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only JPEG, PNG, and WEBP images are allowed for crop photographs."), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB max
    }
});

const uploadCrop = multer({
    storage: cropStorage,
    fileFilter: cropFileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB max per crop photo
    }
});

module.exports = {
    upload,
    uploadCrop,
    UPLOAD_DIR,
    CROP_UPLOAD_DIR
};
