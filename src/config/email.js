const nodemailer = require("nodemailer");
require("dotenv").config({ quiet: true });

const configuredValue = (value) =>
  typeof value === "string" && value.trim() && !/your[_-]/i.test(value);
const isTemporaryDeliveryFailure = (error) => {
  if (Number.isInteger(error?.responseCode))
    return error.responseCode >= 400 && error.responseCode < 500;
  if (
    ["ECONNECTION", "ECONNRESET", "ETIMEDOUT", "ESOCKET", "EPIPE"].includes(
      error?.code,
    )
  )
    return true;
  if (Array.isArray(error?.rejectedErrors) && error.rejectedErrors.length > 0) {
    return error.rejectedErrors.every(
      (rejected) =>
        Number.isInteger(rejected.responseCode) &&
        rejected.responseCode >= 400 &&
        rejected.responseCode < 500,
    );
  }
  const responseCode = String(error?.response || "").match(/\b(4\d\d)\b/);
  return Boolean(responseCode);
};
const isEmailConfigured = [
  process.env.EMAIL_HOST,
  process.env.EMAIL_USER,
  process.env.EMAIL_PASS,
].every(configuredValue);
const transporter = isEmailConfigured
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: process.env.EMAIL_SECURE === "true",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
  : null;

const sendEmail = async ({ to, subject, html, text }) => {
  if (!transporter)
    return { success: false, message: "Email service not configured." };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const info = await transporter.sendMail({
        from: {
          name: process.env.EMAIL_FROM_NAME || "SetuMoolya Platform",
          address: process.env.EMAIL_USER,
        },
        to: { address: to },
        subject,
        html,
        text,
      });
      // SMTP acceptance is the observable result; inbox delivery cannot be guaranteed.
      if (info.accepted?.length > 0 && !info.rejected?.length)
        return { success: true, messageId: info.messageId };
      // A permanent recipient rejection cannot be fixed by retrying the same address.
      return {
        success: false,
        message: "Email recipient was rejected by the mail service.",
      };
    } catch (error) {
      if (!isTemporaryDeliveryFailure(error) || attempt === 3) {
        console.error(
          "Email delivery failed after a temporary or permanent SMTP error.",
        );
        return { success: false, message: "Email delivery failed." };
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
};

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
const email = (subject, text, actionUrl, actionLabel) => ({
  subject,
  text,
  html:
    `<div style="font-family:Arial,sans-serif;max-width:600px;white-space:pre-wrap">${escapeHtml(text)}</div>` +
    (actionUrl
      ? `<p><a href="${escapeHtml(actionUrl)}">${escapeHtml(actionLabel)}</a></p>`
      : ""),
});

const buildApprovalEmail = ({
  fullName,
  role,
  loginId,
  password,
  loginUrl,
  expiresAt,
}) => {
  if (!["farmer", "buyer"].includes(role))
    throw new Error(
      "A farmer or buyer role is required for credential delivery.",
    );
  const roleLoginUrl = new URL(loginUrl);
  if (!["https:", "http:"].includes(roleLoginUrl.protocol))
    throw new Error("The sign-in URL must use HTTP or HTTPS.");
  roleLoginUrl.searchParams.set("role", role);
  return email(
    "SetuMoolya registration approved — your temporary credentials",
    `Dear ${fullName},\n\nAn admin has approved your ${role} registration.\n\nLogin ID: ${loginId}\nTemporary password: ${password}\nTemporary password expires: ${expiresAt}\nLogin: ${roleLoginUrl.href}\n\nPlease set your own password before using the platform. Use Forgot password with your email to receive a reset link, or log in and change your password.\n\nSetuMoolya Platform`,
    roleLoginUrl.href,
    "Log in to SetuMoolya",
  );
};
const buildRejectionEmail = ({ fullName, role, reason }) =>
  email(
    "SetuMoolya registration update",
    `Dear ${fullName},\n\nYour ${role} registration was not approved.\nReason: ${reason}\n\nPlease correct your details and submit a new registration.\n\nSetuMoolya Platform`,
  );
const buildPasswordResetEmail = ({ fullName, resetUrl }) =>
  email(
    "Reset your SetuMoolya password",
    `Dear ${fullName},\n\nOpen this link to set a new password:\n${resetUrl}\n\nThis link can be used once and expires according to the account recovery settings. If you did not request this, ignore this email.\n\nSetuMoolya Platform`,
    resetUrl,
    "Set a new password",
  );

const verifyEmailConnection = async () =>
  transporter ? transporter.verify() : false;

module.exports = {
  verifyEmailConnection,
  sendEmail,
  buildApprovalEmail,
  buildRejectionEmail,
  buildPasswordResetEmail,
  isEmailConfigured,
};
