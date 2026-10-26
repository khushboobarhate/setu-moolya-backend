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
