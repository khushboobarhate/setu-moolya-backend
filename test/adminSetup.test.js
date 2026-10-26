const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createAdmin } = require("../scripts/create-admin");

const fixture = ({ existing = false, missingProfile = false, failProfile = false, failLogin = false } = {}) => {
    const id = randomUUID();
    let user = existing ? { id, email: "admin@example.com", app_metadata: { provider: "email", role: "buyer" }, user_metadata: { full_name: "Existing Admin" } } : null;
    let profile = existing && !missingProfile ? { id, email: user.email, role: "buyer", is_approved: false, full_name: "Existing Admin", city: "Pune" } : null;
    const calls = [];
    const client = {
        from(table) {
            assert.equal(table, "profiles");
            return {
                select() { return this; }, eq() { return this; },
                async maybeSingle() { return { data: profile, error: null }; },
                upsert(payload) {
                    calls.push({ operation: "profile", payload });
                    profile = payload;
                    return this;
                },
                async single() { return { data: profile, error: failProfile ? new Error("Database unavailable") : null }; }
            };
        },
        auth: { admin: {
            async listUsers() { return { data: { users: user ? [user] : [] }, error: null }; },
            async getUserById(value) { assert.equal(value, id); return { data: { user }, error: null }; },
            async createUser(payload) { calls.push({ operation: "create", payload }); user = { id, ...payload }; return { data: { user }, error: null }; },
            async updateUserById(value, payload) { assert.equal(value, id); calls.push({ operation: "update", payload }); user = { ...user, ...payload }; return { data: { user }, error: null }; },
            async signOut(token, scope) { assert.equal(token, "verification-session"); assert.equal(scope, "local"); calls.push({ operation: "logout" }); return { error: null }; }
        } }
    };
    const createAuthClient = () => ({ auth: { async signInWithPassword(credentials) {
        calls.push({ operation: "login", credentials });
        assert.equal(credentials.password, user.password);
        return failLogin ? { error: new Error("Cannot sign in") } : { data: { user, session: { access_token: "verification-session" } }, error: null };
    } } });
    return { client, createAuthClient, calls, id };
};

test("admin setup creates an approved account with supplied credentials and verifies login", async () => {
    const setup = fixture();
    const result = await createAdmin({ ...setup, email: " ADMIN@EXAMPLE.COM ", password: "setup-test-pass" });
    assert.equal(result.created, true); assert.equal(result.email, "admin@example.com");
    assert.equal(result.role, "admin"); assert.equal(result.is_approved, true); assert.equal(result.login_verified, true);
    assert.equal(setup.calls[0].operation, "create"); assert.equal(setup.calls[0].payload.email_confirm, true);
    assert.equal(setup.calls[0].payload.app_metadata.must_change_password, false);
    assert.equal(result.password, undefined);
});
test("rerunning admin setup updates the existing account without losing profile details", async () => {
    const setup = fixture({ existing: true });
    const result = await createAdmin({ ...setup, email: "admin@example.com", password: "replacement-test-pass" });
    assert.equal(result.created, false); assert.equal(result.id, setup.id);
    assert.equal(setup.calls[0].operation, "update");
    const saved = setup.calls.find((item) => item.operation === "profile").payload;
    assert.equal(saved.city, "Pune"); assert.equal(saved.is_approved, true); assert.equal(saved.role, "admin");
    assert.equal(setup.calls[0].payload.app_metadata.provider, "email");
});
test("an existing Auth account without a profile is recovered instead of duplicated", async () => {
    const setup = fixture({ existing: true, missingProfile: true });
    const result = await createAdmin({ ...setup, email: "admin@example.com", password: "setup-test-pass" });
    assert.equal(result.id, setup.id); assert.equal(result.created, false);
    assert.equal(setup.calls[0].operation, "update");
});
test("missing password or invalid email cannot modify admin accounts", async () => {
    const setup = fixture();
    await assert.rejects(createAdmin({ ...setup, email: "admin@example.com" }), /ADMIN_PASSWORD/);
    await assert.rejects(createAdmin({ ...setup, email: "invalid", password: "setup-test-pass" }), /ADMIN_EMAIL/);
    assert.equal(setup.calls.length, 0);
});
test("failed profile approval or failed authentication cannot be reported as verified admin setup", async () => {
    for (const option of [{ failProfile: true }, { failLogin: true }]) {
        const setup = fixture(option);
        await assert.rejects(createAdmin({ ...setup, email: "admin@example.com", password: "setup-test-pass" }), /failed/);
    }
});
