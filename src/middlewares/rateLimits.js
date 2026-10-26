const { rateLimit } = require("express-rate-limit");

const limiter = (limit, windowMs) => rateLimit({
    windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false,
    message: { success: false, message: "Too many attempts. Please try again later." }
});

module.exports = {
    registrationLimit: limiter(10, 60 * 60 * 1000),
    loginLimit: limiter(30, 15 * 60 * 1000),
    recoveryLimit: limiter(5, 15 * 60 * 1000),
    passwordLimit: limiter(10, 15 * 60 * 1000)
};
