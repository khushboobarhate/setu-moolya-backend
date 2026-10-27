require("dotenv").config({ quiet: true });
const { randomUUID, randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { supabaseAdmin, isConfigured, createAuthClient } = require("../src/config/supabase");
const { UserModel, ROLES, REG_STATUS } = require("../src/models/userModel");
const { linkPendingProfile } = require("../src/services/registrationAccount");
const { register } = require("../src/controllers/registrationController");

const demoDetails = (role) => ({
    full_name: role === ROLES.FARMER ? "Demo Farmer (sample account)" : "Demo Buyer (sample account)",
    email: `${role}@example.com`,
    // Clearly marked sample numbers, never used for real calls.
    mobile_number: role === ROLES.FARMER ? "0000000001" : "0000000002",
    state: "Demo State", city: "Demo City", full_address: "Demo address — sample data only",
    ...(role === ROLES.FARMER ? { land_location: "Demo plot — sample data only" } : {}),
    preferred_language: "en"
});

const submitDemoRegistration = async (role, details) => {
    let payload;
    const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { payload = body; return this; }
    };
    // Use the same registration validation and persistence as the public forms.
    await register(role)({ body: details }, response);
    if (response.statusCode !== 201) throw new Error(payload?.message || "Demo registration failed.");
    return UserModel.findRegistrationRequestById(payload.data.request_id);
};

const createDemoUsers = async ({ adminEmail = "admin-user@gmail.com" } = {}) => {
    if (!isConfigured) throw new Error("Configure Supabase and apply supabase_migration_v4.sql first.");
    const admin = await UserModel.findByEmail(adminEmail.trim().toLowerCase());
    if (admin?.role !== ROLES.ADMIN || !admin.is_approved) throw new Error("Create the approved admin first with npm run admin:create.");
    const credentials = [];
    for (const role of [ROLES.FARMER, ROLES.BUYER]) {
        const details = demoDetails(role);
        let profile = await UserModel.findByEmail(details.email);
        let request;
        if (profile) {
            const { data, error } = await supabaseAdmin.auth.admin.getUserById(profile.id);
            if (error) throw error;
            // Never replace a pre-existing non-demo account or change its role.
            if (!data?.user?.app_metadata?.demo_account || data.user.app_metadata.role !== role || profile.is_approved && profile.role !== role || !(profile.registration_request_id || data.user.app_metadata.registration_request_id)) {
                throw new Error(`${details.email} is already in use by a non-demo account.`);
            }
            request = await UserModel.findRegistrationRequestById(profile.registration_request_id || data.user.app_metadata.registration_request_id);
        } else {
            request = await UserModel.findActiveRegistrationByEmail(details.email);
            if (request && (request.role !== role || request.full_name !== details.full_name)) {
                throw new Error(`${details.email} already has a non-demo registration.`);
            }
            request ||= await submitDemoRegistration(role, details);
        }
        if (!request || ![REG_STATUS.PENDING, REG_STATUS.APPROVED].includes(request.status)) throw new Error("Demo registration is not available for approval.");
        const token = randomUUID();
        const locked = await UserModel.claimRegistrationRequest(request.id, token);
        if (!locked) throw new Error("Demo registration is being processed. Retry later.");
        const password = `Demo1!${randomBytes(18).toString("base64url")}`;
        const expiresAt = new Date(Date.now() + 48 * 3600000).toISOString();
        try {
            profile ||= await UserModel.findByRegistrationRequestId(request.id);
            const attributes = {
                email: details.email, password, email_confirm: true,
                app_metadata: { role, registration_request_id: request.id, demo_account: true, session_version: randomUUID(), must_change_password: true, temporary_password_expires_at: expiresAt },
                user_metadata: { full_name: details.full_name, phone: details.mobile_number }
            };
            const { data, error } = profile
                ? await supabaseAdmin.auth.admin.updateUserById(profile.id, attributes)
                : await supabaseAdmin.auth.admin.createUser(attributes);
            if (error || !data?.user) throw error || new Error("Demo Auth account creation failed.");
            if (locked.status === REG_STATUS.PENDING) {
                await linkPendingProfile(data.user.id, request);
                await UserModel.completeApproval(request.id, data.user.id, token, admin.id);
            }
            const { data: login, error: loginError } = await createAuthClient().auth.signInWithPassword({ email: details.email, password });
            const approved = await UserModel.findById(data.user.id);
            if (loginError || login?.user?.id !== data.user.id || approved?.role !== role || !approved.is_approved) {
                throw new Error("Demo account login/approval verification failed.");
            }
            await supabaseAdmin.auth.admin.signOut(login.session.access_token, "local");
            // Intentionally bypass email delivery for reserved demo addresses.
            credentials.push({ role, email: details.email, password, user_id: data.user.id,
                request_id: request.id, temporary_password_expires_at: expiresAt,
                must_change_password: true, login_verified: true });
        } finally {
            await UserModel.releaseRegistrationRequest(request.id, token);
        }
    }
    return credentials;
};

const main = async () => {
    const accounts = await createDemoUsers({ adminEmail: process.env.ADMIN_EMAIL || "admin-user@gmail.com" });
    const filename = path.resolve(__dirname, "../demo-credentials.local.json");
    await fs.writeFile(filename, JSON.stringify(accounts, null, 2) + "\n", { mode: 0o600 });
    await fs.chmod(filename, 0o600);
    console.log("Demo farmer and buyer registrations approved; both logins verified. No emails sent.");
    console.log(`Temporary credentials saved to ignored local file: ${filename}`);
};

if (require.main === module) main().catch((error) => {
    console.error(`Demo setup failed: ${error.message}`);
    process.exitCode = 1;
});

module.exports = { createDemoUsers };
