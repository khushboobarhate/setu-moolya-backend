const text = (value) => typeof value === "string" ? value.trim() : "";
const normalizeEmail = (value) => text(value).toLowerCase();
// Accept one plain mailbox, never a display name, address list or SMTP comment.
const isEmail = (value) => typeof value === "string" && value.length <= 254
    && /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value)
    && value.split("@")[0].length <= 64 && !value.startsWith(".") && !value.includes("..") && !value.includes(".@");
const isUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validPassword = (value) => typeof value === "string" && value.length >= 12 && value.length <= 128
    && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^a-zA-Z0-9]/.test(value);
const passwordMessage = "Password must be 12–128 characters and contain uppercase, lowercase, a number, and a symbol.";

const pagination = (query, defaultLimit = 50) => {
    const page = query.page === undefined ? 1 : Number(query.page);
    const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
        || !Number.isSafeInteger(page * limit)) return null;
    return { page, limit };
};

module.exports = { text, normalizeEmail, isEmail, isUuid, validPassword, passwordMessage, pagination };

// Shared HTTP input policy. Never coerce arrays/objects, partial numbers or Infinity.
const FIELD_RULES = {
    full_name: [2, 100], state: [2, 100], city: [2, 100],
    full_address: [10, 500], land_location: [3, 500],
    nationality: [2, 80], taluka: [2, 100]
};
const LANGUAGES = ['en', 'hi', 'gu', 'mr'];
const CROP_UNITS = ['kg', 'gram', 'quintal', 'tonne'];
const validText = (value, min, max, multiline = false) => typeof value === 'string'
    && value.trim().length >= min && value.trim().length <= max
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
const validMobile = (value) => typeof value === 'string' && /^[0-9]{10}$/.test(value.trim());
const decimal = (value, { min = 0, max = 1000000000, places = 2 } = {}) => {
    if (!['string', 'number'].includes(typeof value)) return null;
    const raw = String(value).trim();
    if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(raw)) return null;
    const number = Number(raw);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
};
const availabilityValue = (body = {}) => {
    if (Object.hasOwn(body, 'is_call_available')) return typeof body.is_call_available === 'boolean' ? body.is_call_available : null;
    const value = body.status ?? body.availability;
    if (value === true || value === 'ON') return true;
    if (value === false || value === 'OFF') return false;
    return null;
};
module.exports = { ...module.exports, FIELD_RULES, LANGUAGES, CROP_UNITS, validText, validMobile, decimal, availabilityValue };
