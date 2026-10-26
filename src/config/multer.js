const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("node:crypto");
const extensions = { "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

// Ensure upload directories exist
const UPLOAD_ROOT = process.env.SETU_UPLOAD_ROOT || path.join(__dirname, "../../uploads");
const UPLOAD_DIR = path.join(UPLOAD_ROOT, "photos");
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const CROP_UPLOAD_DIR = path.join(UPLOAD_ROOT, "crops");
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
        cb(null, `photo-${randomUUID()}${extensions[file.mimetype]}`);
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
        cb(null, `crop-${randomUUID()}${extensions[file.mimetype]}`);
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
        files: 1,
        fields: 20,
        fieldSize: 16 * 1024,
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
