// Never let tests use real service credentials or alter uploads/data.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.NODE_ENV = "test";
for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "EMAIL_HOST", "EMAIL_USER", "EMAIL_PASS"]) process.env[key] = "";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "setumoolya-test-"));
process.env.SETU_DATA_DIR = directory;
process.env.SETU_UPLOAD_ROOT = path.join(directory, "uploads");
process.on("exit", () => fs.rmSync(directory, { recursive: true, force: true }));
