const sharp = require("sharp");
// This code is part of the Source Academy project, licensed under the Apache License 2.0.
const { readFile, writeFile, unlink } = require("node:fs/promises");
const uploadedFiles = (req) =>
  req.file
    ? [req.file]
    : Array.isArray(req.files)
      ? req.files
      : Object.values(req.files || {}).flat();
const cleanupUploads = async (req) =>
  Promise.all(
    uploadedFiles(req)
      .filter((file) => file.path)
      .map((file) => unlink(file.path).catch(() => {})),
  );
const validateImages = async (req, res, next) => {
  try {
    for (const file of uploadedFiles(req)) {
      const source = await readFile(file.path);
      const image = sharp(source, {
        limitInputPixels: 32000000,
        failOn: "warning",
      });
      const metadata = await image.metadata();
      const expected =
        file.mimetype === "image/jpg"
          ? "jpeg"
          : file.mimetype.replace("image/", "");
      if (
        !["jpeg", "png", "webp"].includes(metadata.format) ||
        metadata.format !== expected ||
        (metadata.pages || 1) > 1
      )
        throw new Error("Invalid image");
      // Decode and re-encode: remove embedded metadata and appended payloads.
      const buffer = await image
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
      await writeFile(file.path, buffer);
      file.size = buffer.length;
      file.mimetype = "image/webp";
    }
    next();
  } catch {
    await cleanupUploads(req);
    res
      .status(400)
      .json({
        success: false,
        message:
          "Upload valid, non-animated JPEG, PNG, or WebP images up to 32 megapixels. Damaged files and disguised content are not accepted.",
      });
  }
};
module.exports = { uploadedFiles, cleanupUploads, validateImages };

const removeCropImages = async (crop) => {
  const path = require("node:path");
  const { CROP_UPLOAD_DIR } = require("../config/multer");
  for (const photo of crop.photos || []) {
    if (typeof photo !== "string" || !photo.startsWith("/uploads/crops/"))
      continue;
    const filename = photo.slice("/uploads/crops/".length);
    if (!/^crop-[a-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) continue;
    await unlink(path.join(CROP_UPLOAD_DIR, filename)).catch(() => {});
  }
};
module.exports.removeCropImages = removeCropImages;
