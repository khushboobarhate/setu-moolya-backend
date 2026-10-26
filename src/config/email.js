const nodemailer = require("nodemailer");
require("dotenv").config({ quiet: true });

const configuredValue = (value) => typeof value === "string" && value.trim() && !/your[_-]/i.test(value);
const isEmailConfigured = [process.env.EMAIL_HOST, process.env.EMAIL_USER, process.env.EMAIL_PASS].every(configuredValue);
const transporter = isEmailConfigured ? nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === "true",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
}) : null;

const sendEmail = async ({ to, subject, html, text }) => {
    if (!transporter) return { success: false, message: "Email service not configured." };
    try {
        const info = await transporter.sendMail({
            from: { name: process.env.EMAIL_FROM_NAME || "SetuMoolya Platform", address: process.env.EMAIL_USER },
            to: { address: to }, subject, html, text
        });
        // SMTP acceptance is the observable result; inbox delivery cannot be guaranteed.
        return { success: info.accepted?.length > 0 && !info.rejected?.length, messageId: info.messageId };
    } catch (error) {
        console.error("Email delivery failed:", error.message);
        return { success: false, message: "Email delivery failed." };
    }
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const email = (subject, text, actionUrl, actionLabel) => ({
    subject, text,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;white-space:pre-wrap">${escapeHtml(text)}</div>`
        + (actionUrl ? `<p><a href="${escapeHtml(actionUrl)}">${escapeHtml(actionLabel)}</a></p>` : "")
});

const buildApprovalEmail = ({ fullName, role, loginId, password, loginUrl, expiresAt }) => email(
    "SetuMoolya registration approved — your temporary credentials",
    `Dear ${fullName},\n\nAn admin has approved your ${role} registration.\n\nLogin ID: ${loginId}\nTemporary password: ${password}\nTemporary password expires: ${expiresAt}\nLogin: ${loginUrl}\n\nPlease set your own password before using the platform. Use Forgot password with your email to receive a reset link, or log in and change your password.\n\nSetuMoolya Platform`,
    loginUrl, "Log in to SetuMoolya"
);
const buildRejectionEmail = ({ fullName, role, reason }) => email(
    "SetuMoolya registration update",
    `Dear ${fullName},\n\nYour ${role} registration was not approved.\nReason: ${reason}\n\nPlease correct your details and submit a new registration.\n\nSetuMoolya Platform`
);
const buildPasswordResetEmail = ({ fullName, resetUrl }) => email(
    "Reset your SetuMoolya password",
    `Dear ${fullName},\n\nOpen this link to set a new password:\n${resetUrl}\n\nThis link can be used once and expires according to the account recovery settings. If you did not request this, ignore this email.\n\nSetuMoolya Platform`,
    resetUrl, "Set a new password"
);

module.exports = { sendEmail, buildApprovalEmail, buildRejectionEmail, buildPasswordResetEmail, isEmailConfigured };
