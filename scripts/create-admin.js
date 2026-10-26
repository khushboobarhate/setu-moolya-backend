require("dotenv").config({ quiet: true });
const { isEmail, normalizeEmail } = require("../src/utils/validation");

const findAuthUser = async (client, email, profile) => {
    if (profile) {
        const { data, error } = await client.auth.admin.getUserById(profile.id);
        if (error) throw error;
        if (data?.user?.email?.toLowerCase() !== email) throw new Error("The existing profile and Auth account emails do not match.");
        return data.user;
    }
    // This also recovers an Auth account whose profile creation was interrupted.
    for (let page = 1; ; page++) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const user = data.users.find((item) => item.email?.toLowerCase() === email);
        if (user) return user;
        if (data.users.length < 1000) return null;
    }
};

const createAdmin = async ({ email, password, fullName, client, createAuthClient }) => {
    email = normalizeEmail(email);
    if (!isEmail(email)) throw new Error("Set ADMIN_EMAIL to a valid email address.");
    // Bootstrap credentials are explicitly supplied by the operator. Never use a
    // repository default password or the farmer/buyer password-change policy here.
    if (typeof password !== "string" || password.length < 6 || password.length > 128) {
        throw new Error("Set ADMIN_PASSWORD to the intended admin password (6–128 characters).");
    }
    const { data: profile, error: profileError } = await client.from("profiles")
        .select("*").eq("email", email).maybeSingle();
    if (profileError) throw new Error("Cannot read profiles. Apply the database schema/migration and check the service-role credentials.");
    const existing = await findAuthUser(client, email, profile);
    const full_name = fullName?.trim() || profile?.full_name || "SetuMoolya Admin";
    const attributes = {
        email, password, email_confirm: true,
        app_metadata: { ...existing?.app_metadata, role: "admin", must_change_password: false, temporary_password_expires_at: null },
        user_metadata: { ...existing?.user_metadata, full_name }
    };
    const { data, error } = existing
        ? await client.auth.admin.updateUserById(existing.id, attributes)
        : await client.auth.admin.createUser(attributes);
    if (error || !data?.user) throw error || new Error("Admin Auth account creation failed.");
    const { data: approved, error: approvalError } = await client.from("profiles")
        .upsert({ ...profile, id: data.user.id, email, full_name, role: "admin", is_approved: true }, { onConflict: "id" })
        .select("id,email,role,is_approved").single();
    if (approvalError) throw new Error("Auth account exists, but approving its admin profile failed. Fix the database configuration and rerun this command.");
    if (approved.role !== "admin" || !approved.is_approved) throw new Error("Admin profile verification failed.");
    const { data: login, error: loginError } = await createAuthClient().auth.signInWithPassword({ email, password });
    if (loginError || login?.user?.id !== approved.id || !login.session?.access_token) {
        throw new Error("Admin account was saved, but login verification failed. Check Supabase Auth settings and rerun this command.");
    }
    // Revoke only the session created by this check, preserving existing sessions.
    await client.auth.admin.signOut(login.session.access_token, "local");
    return { ...approved, created: !existing, login_verified: true };
};

const main = async () => {
    const { supabaseAdmin, isConfigured, createAuthClient } = require("../src/config/supabase");
    if (!isConfigured) throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in the ignored .env file before creating an admin.");
    const result = await createAdmin({
        email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
        fullName: process.env.ADMIN_NAME, client: supabaseAdmin, createAuthClient
    });
    console.log(`Admin ${result.created ? "created" : "updated"}: ${result.email}`);
    console.log(`Account ID: ${result.id}. Role: admin. Approved: true. Login verified: true.`);
};

if (require.main === module) main().catch((error) => {
    // Do not print provider payloads, passwords, tokens or service keys.
    console.error(`Admin setup failed: ${error.message}`);
    process.exitCode = 1;
});

module.exports = { createAdmin };
