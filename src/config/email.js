const nodemailer = require("nodemailer");
require("dotenv").config();

/**
 * Email Transporter Configuration
 * Uses SMTP credentials from .env (supports Gmail, SMTP2Go, Mailgun, etc.)
 */
let transporter = null;

const isEmailConfigured = Boolean(
    process.env.EMAIL_HOST &&
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASS
);

if (isEmailConfigured) {
    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || "587"),
        secure: process.env.EMAIL_SECURE === "true", // true for 465, false for 587
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    // Verify connection
    transporter.verify((error) => {
        if (error) {
            console.error("❌ Email transporter error:", error.message);
        } else {
            console.log("✅ Email transporter ready.");
        }
    });
} else {
    console.warn("⚠️  Email not configured. Set EMAIL_HOST, EMAIL_USER, EMAIL_PASS in .env");
}

/**
 * Send an email
 * @param {object} options - { to, subject, html, text }
 */
const sendEmail = async ({ to, subject, html, text }) => {
    if (!isEmailConfigured || !transporter) {
        console.warn(`[Email Skipped] To: ${to} | Subject: ${subject}`);
        return { success: false, message: "Email service not configured." };
    }

    try {
        const info = await transporter.sendMail({
            from: `"${process.env.EMAIL_FROM_NAME || "SetuMoolya Platform"}" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text: text || "",
            html: html || ""
        });

        console.log(`✅ Email sent to ${to} | Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Failed to send email to ${to}:`, error.message);
        return { success: false, message: error.message };
    }
};

/**
 * Generate approval email HTML content
 */
const buildApprovalEmail = ({ fullName, role, loginId, password, loginUrl }) => {
    const roleLabel = role === "farmer" ? "Farmer" : "Buyer";
    return {
        subject: `🎉 Registration Approved – Welcome to SetuMoolya, ${fullName}!`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { background: #fff; border-radius: 8px; padding: 32px; max-width: 560px; margin: auto; }
    .header { background: #2d6a4f; color: #fff; border-radius: 8px 8px 0 0; padding: 20px 32px; }
    .header h1 { margin: 0; font-size: 22px; }
    .body { padding: 24px 0; color: #333; }
    .credentials { background: #e9f5ee; border-left: 4px solid #2d6a4f; padding: 16px 20px; border-radius: 4px; margin: 16px 0; }
    .credentials p { margin: 6px 0; font-size: 15px; }
    .btn { display: inline-block; background: #2d6a4f; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 20px; }
    .footer { margin-top: 32px; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SetuMoolya (सेतुमूल्य)</h1>
      <p style="margin:4px 0 0; font-size:14px;">AgriTech Value Chain Platform</p>
    </div>
    <div class="body">
      <p>Dear <strong>${fullName}</strong>,</p>
      <p>Congratulations! Your <strong>${roleLabel}</strong> registration on the SetuMoolya platform has been <strong style="color:#2d6a4f;">approved</strong> by our Admin.</p>
      <p>Here are your login credentials:</p>
      <div class="credentials">
        <p><strong>Login ID (Email):</strong> ${loginId}</p>
        <p><strong>Password:</strong> ${password}</p>
        <p><strong>Your Role:</strong> ${roleLabel}</p>
      </div>
      <p>You can now log in to the platform using the button below:</p>
      <a href="${loginUrl}" class="btn">Login to SetuMoolya</a>
      <p style="margin-top:20px; font-size:13px; color:#666;">
        Please keep your credentials safe. You can change your password after logging in.
      </p>
    </div>
    <div class="footer">
      <p>This is an automated email from the SetuMoolya Platform. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>
        `.trim()
    };
};

/**
 * Generate rejection email HTML content
 */
const buildRejectionEmail = ({ fullName, role }) => {
    const roleLabel = role === "farmer" ? "Farmer" : "Buyer";
    return {
        subject: `Registration Update – Action Required | SetuMoolya`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { background: #fff; border-radius: 8px; padding: 32px; max-width: 560px; margin: auto; }
    .header { background: #b5451b; color: #fff; border-radius: 8px 8px 0 0; padding: 20px 32px; }
    .header h1 { margin: 0; font-size: 22px; }
    .body { padding: 24px 0; color: #333; }
    .notice { background: #fff3f0; border-left: 4px solid #b5451b; padding: 16px 20px; border-radius: 4px; margin: 16px 0; }
    .footer { margin-top: 32px; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SetuMoolya (सेतुमूल्य)</h1>
      <p style="margin:4px 0 0; font-size:14px;">AgriTech Value Chain Platform</p>
    </div>
    <div class="body">
      <p>Dear <strong>${fullName}</strong>,</p>
      <p>Thank you for registering as a <strong>${roleLabel}</strong> on the SetuMoolya platform.</p>
      <div class="notice">
        <p>After reviewing your submitted details, we were unable to approve your registration at this time.</p>
        <p><strong>Reason:</strong> The details you provided appear to be incorrect or incomplete.</p>
      </div>
      <p>We kindly request you to:</p>
      <ul>
        <li>Review all submitted registration information.</li>
        <li>Correct any incorrect or missing details.</li>
        <li>Re-submit your registration request on the platform.</li>
      </ul>
      <p>If you believe this is a mistake or need assistance, please contact our support team.</p>
    </div>
    <div class="footer">
      <p>This is an automated email from the SetuMoolya Platform. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>
        `.trim()
    };
};

module.exports = {
    sendEmail,
    buildApprovalEmail,
    buildRejectionEmail,
    isEmailConfigured
};
