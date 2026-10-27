const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const config = require("../src/config/supabase");

// Mock external Supabase/SMTP boundaries; exercise the real HTTP routes,
// validation, role guards, controllers, credential generation and email builders.
let profiles, requests, users, sessions, recoveryTokens, emails, emailOk, failFinalize, authFailure, delayedTrigger;
const adminId = randomUUID();
const sessionFor = (user) => {
    const token = `fixture.${Buffer.from(JSON.stringify({ app_metadata: user.app_metadata || {} })).toString("base64url")}.${randomUUID()}`;
    sessions.set(token, user.id);
    return { access_token: token, refresh_token: randomUUID(), expires_in: 3600 };
};
const auth = {
    async signInWithPassword({ email, password }) {
        const user = [...users.values()].find((u) => u.email === email && u.password === password);
        return user ? { data: { user: structuredClone(user), session: sessionFor(user) }, error: null } : { data: null, error: new Error("Invalid credentials") };
    },
    async getUser(token) {
        const user = users.get(sessions.get(token));
        return { data: { user: user ? structuredClone(user) : null }, error: user ? null : new Error("Invalid token") };
    },
    async verifyOtp({ token_hash, type }) {
        assert.equal(type, "recovery");
        const id = recoveryTokens.get(token_hash);
        recoveryTokens.delete(token_hash);
        const user = users.get(id);
        return { data: { user: user ? structuredClone(user) : null }, error: user ? null : new Error("Invalid recovery token") };
    }
};
const adminAuth = {
    async signOut(token, scope) {
        assert.equal(scope, "local");
        sessions.delete(token);
        return { error: null };
    },
    async createUser(payload) {
        if (authFailure) return { error: new Error("Auth unavailable") };
        if ([...users.values()].some((u) => u.email === payload.email)) return { error: new Error("Email exists") };
        const user = { id: randomUUID(), ...structuredClone(payload) };
        users.set(user.id, user);
        profiles.set(user.id, {
            id: user.id, email: user.email, role: delayedTrigger ? "farmer" : user.app_metadata.role, is_approved: false,
            registration_request_id: delayedTrigger ? null : user.app_metadata.registration_request_id
        });
        return { data: { user }, error: null };
    },
    async getUserById(id) { return { data: { user: structuredClone(users.get(id)) }, error: null }; },
    async updateUserById(id, updates) {
        Object.assign(users.get(id), structuredClone(updates));
        return { data: { user: users.get(id) }, error: null };
    },
    async deleteUser(id) { users.delete(id); profiles.delete(id); return { error: null }; },
    async generateLink({ type, email }) {
        assert.equal(type, "recovery");
        const user = [...users.values()].find((u) => u.email === email);
        const token = randomBytes(24).toString("hex");
        recoveryTokens.set(token, user.id);
        return { data: { properties: { hashed_token: token } }, error: null };
    }
};
Object.assign(config, { isConfigured: true, supabase: { auth }, supabaseAdmin: { auth: { admin: adminAuth } }, createAuthClient: () => ({ auth }) });
const { UserModel } = require("../src/models/userModel");
const { CallModel } = require("../src/models/callModel");
const emailService = require("../src/config/email");
const limits = require("../src/middlewares/rateLimits");
const app = require("../index");
let server, base;

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { mock.restoreAll(); await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => {
    mock.restoreAll();
    profiles = new Map(); requests = new Map(); users = new Map(); sessions = new Map(); recoveryTokens = new Map(); emails = [];
    emailOk = true; failFinalize = false; authFailure = false; delayedTrigger = false;
    emailService.isEmailConfigured = true;
    const admin = { id: adminId, email: "admin@example.com", password: "Admin-password1!", app_metadata: {} };
    users.set(adminId, admin);
    profiles.set(adminId, { id: adminId, email: admin.email, role: "admin", is_approved: true });
    sessions.set("admin-token", adminId);
    for (const limiter of Object.values(limits)) limiter.resetKey("127.0.0.1");
    mock.method(CallModel, "getUserAvailability", async () => true);
    mock.method(emailService, "sendEmail", async (email) => { emails.push(email); return { success: emailOk }; });
    mock.method(UserModel, "findById", async (id) => profiles.get(id) || null);
    mock.method(UserModel, "findByEmail", async (email) => [...profiles.values()].find((p) => p.email === email) || null);
    mock.method(UserModel, "findActiveRegistrationByEmail", async (email) => [...requests.values()].find((r) => r.email === email && r.status !== "rejected") || null);
    mock.method(UserModel, "createRegistrationRequest", async (payload) => {
        if ([...requests.values()].some((r) => r.email === payload.email && r.status !== "rejected")) throw Object.assign(new Error("Duplicate"), { code: "23505" });
        const request = { id: randomUUID(), ...payload, credentials_email_status: "pending", review_token: null };
        requests.set(request.id, request);
        return request;
    });
    mock.method(UserModel, "findRegistrationRequestById", async (id) => structuredClone(requests.get(id)) || null);
    mock.method(UserModel, "linkPendingProfile", async (id, request) => { const profile = profiles.get(id); assert.equal(profile.is_approved, false); assert.equal(profile.registration_request_id, null); Object.assign(profile, { role: request.role, registration_request_id: request.id }); return profile; });
    mock.method(UserModel, "findByRegistrationRequestId", async (id) => [...profiles.values()].find((p) => p.registration_request_id === id) || null);
    mock.method(UserModel, "claimRegistrationRequest", async (id, token) => {
        const request = requests.get(id);
        if (request.review_token) return null;
        request.review_token = token;
        return structuredClone(request);
    });
    mock.method(UserModel, "releaseRegistrationRequest", async (id, token) => {
        if (requests.get(id)?.review_token === token) requests.get(id).review_token = null;
    });
    mock.method(UserModel, "updateReviewedRequest", async (id, token, updates) => {
        assert.equal(requests.get(id).review_token, token);
        Object.assign(requests.get(id), updates);
        return requests.get(id);
    });
    mock.method(UserModel, "completeApproval", async (id, userId, token, reviewer) => {
        if (failFinalize) throw new Error("Database unavailable");
        const request = requests.get(id);
        assert.equal(request.review_token, token);
        Object.assign(profiles.get(userId), request, { id: userId, is_approved: true, registration_request_id: id });
        Object.assign(request, { status: "approved", approved_user_id: userId, approved_login_email: request.email, reviewed_by: reviewer });
        return userId;
    });
    mock.method(UserModel, "listRegistrationRequests", async ({ role, status, page, limit }) => {
        const list = [...requests.values()].filter((r) => (!role || r.role === role) && (!status || r.status === status));
        return { requests: list.slice((page - 1) * limit, page * limit), total: list.length, page, totalPages: Math.ceil(list.length / limit) };
    });
});
const api = async (url, body, token, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(base + url, { method, headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
};
const form = (role, extra = {}) => ({ full_name: "Test Applicant", email: `${role}@example.com`, mobile_number: "9876543210", state: "Maharashtra", city: "Pune", full_address: "12 Market Road", ...(role === "farmer" ? { land_location: "Village Plot 4" } : {}), ...extra });
const submit = async (role = "farmer", extra) => {
    const response = await api(`/api/${role}/register`, form(role, extra));
    assert.equal(response.status, 201);
    return response.body.data.request_id;
};
const approve = (id) => api(`/api/admin/requests/${id}/approve`, {}, "admin-token");
const emailedPassword = () => emails.at(-1).text.match(/Temporary password: (\S+)/)[1];
const resetToken = () => new URL(emails.at(-1).text.match(/http[^\s]+/)[0]).hash.match(/token_hash=([^&]+)/)[1];

for (const role of ["farmer", "buyer"]) {
    test(`${role}: registration reaches admin, approval emails credentials, recovery replaces temporary password`, async () => {
        const id = await submit(role, { email: `  ${role.toUpperCase()}@EXAMPLE.COM  `, role: "admin", status: "approved", is_approved: true, age: "35", nationality: "Indian", taluka: "Haveli", preferred_language: "mr" });
        assert.equal(users.size, 1);
        const dashboard = await api(`/api/admin/dashboard?role=${role}`, undefined, "admin-token");
        const request = dashboard.body.data.pending_requests[0];
        assert.equal(request.id, id); assert.equal(request.email, `${role}@example.com`); assert.equal(request.role, role);
        assert.equal(request.status, "pending"); assert.equal(request.age, 35); assert.equal(request.mobile_number, "9876543210");
        assert.equal(request.review_token, undefined);
        const approved = await approve(id);
        assert.equal(approved.status, 200); assert.equal(approved.body.data.email_sent, true);
        assert.equal(approved.body.data.login_id, `${role}@example.com`); assert.equal(emails[0].to, `${role}@example.com`);
        const temporary = emailedPassword();
        assert.ok(temporary.length >= 32); assert.equal(JSON.stringify(approved.body).includes(temporary), false);
        const logged = await api(`/api/${role}/login`, { login_id: `${role}@example.com`, password: temporary });
        assert.equal(logged.status, 200); assert.equal(logged.body.data.must_change_password, true);
        const access = logged.body.data.token;
        assert.equal((await api(`/api/${role}/profile`, undefined, access)).status, 200);
        const blocked = await api(`/api/${role}/availability`, undefined, access);
        assert.equal(blocked.status, 403); assert.equal(blocked.body.code, "PASSWORD_CHANGE_REQUIRED");
        assert.equal((await approve(id)).status, 409);
        assert.equal((await api(`/api/${role}/forgot-password`, { email: `${role}@example.com` })).status, 200);
        const token = resetToken();
        const password = "New-strong-password1!";
        assert.equal((await api(`/api/${role}/reset-password`, { token_hash: token, password })).status, 200);
        assert.equal((await api(`/api/${role}/reset-password`, { token_hash: token, password })).status, 400);
        assert.equal((await api(`/api/${role}/login`, { login_id: `${role}@example.com`, password: temporary })).status, 401);
        const final = await api(`/api/${role}/login`, { email: `${role}@example.com`, password });
        assert.equal(final.status, 200); assert.equal(final.body.data.must_change_password, false);
        assert.equal((await api(`/api/${role}/availability`, undefined, final.body.data.token)).status, 200);
        assert.equal((await api(`/api/admin/requests/${id}/send-credentials`, {}, "admin-token")).status, 409);
    });
}

test("concurrent normalized duplicate registrations produce one pending request", async () => {
    const responses = await Promise.all([api("/api/buyer/register", form("buyer")), api("/api/buyer/register", form("buyer", { email: " BUYER@EXAMPLE.COM " }))]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(requests.size, 1);
});
test("required contact email and farmer land location, and strict input types are validated", async () => {
    for (const values of [{ email: "" }, { email: "not-email" }, { email: "a,b@example.com" }, { email: "evil@example.com,other@example.com" }, { age: "35years" }, { age: 17 }, { full_name: [] }, { mobile_number: "invalid" }, { land_location: "" }]) {
        assert.equal((await api("/api/farmer/register", form("farmer", values))).status, 400);
    }
    assert.equal(requests.size, 0);
});
test("simultaneous approvals create one account and send one credential email", async () => {
    const id = await submit();
    const responses = await Promise.all([approve(id), approve(id)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(users.size, 2); assert.equal(emails.length, 1);
});
test("failed credential delivery is visible, retry rotates password and releases the review lease", async () => {
    const id = await submit(); emailOk = false;
    const response = await approve(id);
    assert.equal(response.body.data.email_sent, false); assert.equal(response.body.data.can_resend_credentials, true);
    assert.equal(requests.get(id).credentials_email_status, "failed");
    assert.match(response.body.message, /failed/);
    const old = emailedPassword(); emailOk = true;
    const retry = await api(`/api/admin/requests/${id}/send-credentials`, {}, "admin-token");
    assert.equal(retry.body.data.email_sent, true); assert.notEqual(emailedPassword(), old);
    assert.equal(requests.get(id).review_token, null); assert.equal(users.size, 2);
});
test("missing SMTP or unavailable auth cannot approve a request", async () => {
    const id = await submit(); emailService.isEmailConfigured = false;
    assert.equal((await approve(id)).status, 503); assert.equal(users.size, 1);
    emailService.isEmailConfigured = true; authFailure = true;
    assert.equal((await approve(id)).status, 500);
    assert.equal(requests.get(id).status, "pending"); assert.equal(users.size, 1); assert.equal(requests.get(id).review_token, null);
});
test("interrupted approval preserves an unapproved linked account and retry recovers it", async () => {
    const id = await submit(); failFinalize = true;
    assert.equal((await approve(id)).status, 500); assert.equal(requests.get(id).status, "pending");
    assert.equal([...profiles.values()].filter((p) => !p.is_approved).length, 1);
    assert.equal(emails.length, 0); failFinalize = false;
    assert.equal((await approve(id)).status, 200); assert.equal(users.size, 2);
});
test("admin rejects with a reason and applicant can resubmit corrected details", async () => {
    const id = await submit();
    assert.equal((await api(`/api/admin/requests/${id}/reject`, {}, "admin-token")).status, 400);
    const rejected = await api(`/api/admin/requests/${id}/reject`, { reason: "Please correct the land address." }, "admin-token");
    assert.equal(rejected.status, 200); assert.equal(rejected.body.data.status, "rejected");
    assert.match(emails[0].text, /correct the land address/); assert.equal(users.size, 1);
    assert.notEqual(await submit(), id);
    const history = await api("/api/admin/requests?status=all", undefined, "admin-token");
    assert.equal(history.body.data.requests.length, 2);
});
test("missing email on a legacy pending request can be corrected before approval", async () => {
    const id = await submit(); requests.get(id).email = null;
    assert.equal((await approve(id)).status, 400);
    const updated = await api(`/api/admin/requests/${id}`, { email: "corrected@example.com" }, "admin-token", "PATCH");
    assert.equal(updated.status, 200);
    assert.equal((await approve(id)).body.data.login_id, "corrected@example.com");
});
test("unknown, pending and wrong-role accounts get the same forgot-password response", async () => {
    const unknown = await api("/api/farmer/forgot-password", { email: "unknown@example.com" });
    await submit();
    const pending = await api("/api/farmer/forgot-password", { email: "farmer@example.com" });
    assert.deepEqual(pending, unknown);
    await approve([...requests.keys()][0]); const count = emails.length;
    const wrongRole = await api("/api/buyer/forgot-password", { email: "farmer@example.com" });
    assert.deepEqual(wrongRole, unknown); assert.equal(emails.length, count);
});
test("expired/invalid reset links and weak passwords cannot change an account", async () => {
    const id = await submit(); await approve(id); const old = emailedPassword();
    assert.equal((await api("/api/farmer/reset-password", { token_hash: "0".repeat(48), password: "New-password123!" })).status, 400);
    await api("/api/farmer/forgot-password", { email: "farmer@example.com" }); const token = resetToken();
    assert.equal((await api("/api/farmer/reset-password", { token_hash: token, password: "weak" })).status, 400);
    assert.equal(recoveryTokens.has(token), true);
    assert.equal((await api("/api/buyer/reset-password", { token_hash: token, password: "New-password123!" })).status, 403);
    assert.equal([...users.values()].find((u) => u.email === "farmer@example.com").password, old);
});
test("temporary password expiry and change-password flow are enforced", async () => {
    const id = await submit(); await approve(id); const temporary = emailedPassword();
    const logged = await api("/api/farmer/login", { email: "farmer@example.com", password: temporary });
    const token = logged.body.data.token;
    const newPassword = "Changed-password123!";
    assert.equal((await api("/api/farmer/change-password", { current_password: "incorrect", password: newPassword }, token)).status, 400);
    assert.equal((await api("/api/farmer/change-password", { current_password: temporary, password: newPassword }, token)).status, 200);
    assert.equal((await api("/api/farmer/login", { email: "farmer@example.com", password: newPassword })).body.data.must_change_password, false);
    const user = [...users.values()].find((u) => u.email === "farmer@example.com");
    user.app_metadata = { must_change_password: true, temporary_password_expires_at: new Date(0).toISOString() };
    const expired = await api("/api/farmer/login", { email: user.email, password: newPassword });
    assert.equal(expired.status, 403); assert.equal(expired.body.code, "TEMPORARY_PASSWORD_EXPIRED");
});
test("admin routes reject applicants, missing profiles, unapproved admins and invalid query/IDs", async () => {
    assert.equal((await api("/api/admin/dashboard")).status, 401);
    const fake = { id: randomUUID(), email: "fake@example.com", user_metadata: { role: "admin" } };
    users.set(fake.id, fake); sessions.set("fake-token", fake.id);
    assert.equal((await api("/api/admin/dashboard", undefined, "fake-token")).status, 403);
    profiles.set(fake.id, { id: fake.id, role: "buyer", is_approved: true });
    assert.equal((await api("/api/admin/dashboard", undefined, "fake-token")).status, 403);
    profiles.get(fake.id).role = "admin"; profiles.get(fake.id).is_approved = false;
    assert.equal((await api("/api/admin/dashboard", undefined, "fake-token")).status, 403);
    for (const path of ["/api/admin/requests?limit=-1", "/api/admin/requests?status=unknown", "/api/admin/requests?role=admin", "/api/admin/requests/not-a-uuid"]) {
        assert.equal((await api(path, undefined, "admin-token")).status, 400);
    }
    assert.equal((await api(`/api/admin/requests/${randomUUID()}`, undefined, "admin-token")).status, 404);
});
test("recovery requests are rate limited, obsolete OTP routes and local data files are unavailable", async () => {
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await api("/api/buyer/forgot-password", { email: "unknown@example.com" })).status, 200);
    assert.equal((await api("/api/buyer/forgot-password", { email: "unknown@example.com" })).status, 429);
    assert.equal((await api("/api/otp/send", { phone: "9876543210" })).status, 404);
    assert.equal((await api("/uploads/data/availability.json")).status, 404);
});

test("multipart registration preserves an optional photo for admin review and cleans failed uploads", async () => {
    const fs = require("node:fs/promises");
    const { UPLOAD_DIR } = require("../src/config/multer");
    const multipart = (values) => {
        const data = new FormData();
        for (const [key, value] of Object.entries(values)) data.set(key, value);
        data.set("photo", new Blob([require("node:fs").readFileSync(require("node:path").join(__dirname, "../test-support/pixel.jpg"))], { type: "image/jpeg" }), "untrusted-name.html");
        return data;
    };
    const response = await fetch(base + "/api/farmer/register", { method: "POST", body: multipart(form("farmer")) });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.match(body.data.photo_url, /^\/uploads\/photos\/.+\.webp$/);
    const detail = await api(`/api/admin/requests/${body.data.request_id}`, undefined, "admin-token");
    assert.equal(detail.body.data.photo_url, body.data.photo_url);
    assert.equal((await fetch(base + body.data.photo_url)).status, 200);
    const before = await fs.readdir(UPLOAD_DIR);
    const invalid = await fetch(base + "/api/farmer/register", { method: "POST", body: multipart(form("farmer", { email: "" })) });
    assert.equal(invalid.status, 400);
    // The response can be flushed before the async finally cleanup completes.
    for (let attempt = 0; attempt < 10; attempt++) {
        if ((await fs.readdir(UPLOAD_DIR)).length === before.length) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(await fs.readdir(UPLOAD_DIR), before);
});

test("demo setup creates registered, approved farmer and buyer accounts without sending email", async () => {
    const { createDemoUsers } = require("../scripts/create-demo-users");
    const accounts = await createDemoUsers({ adminEmail: "admin@example.com" });
    assert.deepEqual(accounts.map((account) => account.email), ["farmer@example.com", "buyer@example.com"]);
    assert.equal(users.size, 3); assert.equal(requests.size, 2); assert.equal(emails.length, 0);
    for (const account of accounts) {
        assert.equal(account.login_verified, true);
        const request = requests.get(account.request_id);
        assert.equal(request.status, "approved"); assert.match(request.full_name, /sample account/);
        const response = await api(`/api/${account.role}/login`, { email: account.email, password: account.password });
        assert.equal(response.status, 200); assert.equal(response.body.data.must_change_password, true);
    }
});
test("rerunning demo setup replaces demo passwords without duplicate accounts or registrations", async () => {
    const { createDemoUsers } = require("../scripts/create-demo-users");
    const first = await createDemoUsers({ adminEmail: "admin@example.com" });
    const second = await createDemoUsers({ adminEmail: "admin@example.com" });
    assert.equal(users.size, 3); assert.equal(requests.size, 2); assert.equal(emails.length, 0);
    assert.equal(first[0].user_id, second[0].user_id); assert.notEqual(first[0].password, second[0].password);
});
test("demo setup refuses to overwrite existing non-demo users", async () => {
    const { createDemoUsers } = require("../scripts/create-demo-users");
    const id = randomUUID();
    users.set(id, { id, email: "farmer@example.com", app_metadata: {} });
    profiles.set(id, { id, email: "farmer@example.com", role: "farmer", is_approved: true });
    await assert.rejects(createDemoUsers({ adminEmail: "admin@example.com" }), /non-demo account/);
    assert.equal(requests.size, 0); assert.equal(users.size, 2);
});
test("demo setup requires an approved administrator", async () => {
    const { createDemoUsers } = require("../scripts/create-demo-users");
    profiles.get(adminId).is_approved = false;
    await assert.rejects(createDemoUsers({ adminEmail: "admin@example.com" }), /approved admin/);
    assert.equal(requests.size, 0); assert.equal(users.size, 1);
});
test("demo setup can recover an interrupted approval without sending email", async () => {
    const { createDemoUsers } = require("../scripts/create-demo-users");
    failFinalize = true;
    await assert.rejects(createDemoUsers({ adminEmail: "admin@example.com" }), /Database unavailable/);
    failFinalize = false;
    const accounts = await createDemoUsers({ adminEmail: "admin@example.com" });
    assert.equal(accounts.length, 2); assert.equal(users.size, 3); assert.equal(emails.length, 0);
});

test('registration requires exactly ten mobile digits and meaningful bounded addresses', async () => {
    for (const mobile_number of ['123456789', '12345678901', '+919876543210', '98765 43210', '987654321x']) {
        assert.equal((await api('/api/farmer/register', form('farmer', { mobile_number }))).status, 400);
    }
    for (const changes of [{full_address:'x'}, {state:' '}, {city:'A'}, {full_name:'A'}, {preferred_language:'invalid'}]) {
        limits.registrationLimit.resetKey('127.0.0.1');
        assert.equal((await api('/api/buyer/register', form('buyer', changes))).status, 400);
    }
    assert.equal(requests.size, 0);
});
test('disguised image contents are rejected and cannot remain in public uploads', async () => {
    const { readdir } = require('node:fs/promises');
    const { UPLOAD_DIR } = require('../src/config/multer');
    const before = await readdir(UPLOAD_DIR);
    const data = new FormData(); Object.entries(form('farmer')).forEach(([key, value]) => data.set(key, value));
    data.set('photo', new Blob(['<script>alert(1)</script>'], {type:'image/jpeg'}), 'attack.jpg');
    const response = await fetch(base + '/api/farmer/register', {method:'POST',body:data});
    assert.equal(response.status,400); assert.deepEqual(await readdir(UPLOAD_DIR), before); assert.equal(requests.size,0);
});
test('admin profile is backend-authorized and forged role metadata cannot elevate applicants', async () => {
    const profile = await api('/api/admin/profile', undefined, 'admin-token');
    assert.equal(profile.status,200); assert.equal(profile.body.data.role,'admin'); assert.equal(profile.body.data.is_approved,true);
    const id = await submit('buyer', {role:'admin',is_approved:true}); await approve(id);
    const logged = await api('/api/buyer/login',{email:'buyer@example.com', password:emailedPassword()});
    const token = logged.body.data.token;
    assert.equal((await api('/api/admin/profile',undefined,token)).status,403);
    assert.equal((await api('/api/admin/requests',undefined,token)).status,403);
    assert.equal((await api('/api/farmer/profile',undefined,token)).status,403);
    assert.equal((await api('/api/admin/login',{email:'buyer@example.com',password:emailedPassword()})).status,403);
});
test('password change invalidates previously issued API tokens, including the change session', async () => {
    const id = await submit(); await approve(id); const password = emailedPassword();
    const logged = await api('/api/farmer/login',{email:'farmer@example.com',password});
    const token = logged.body.data.token;
    assert.equal((await api('/api/farmer/change-password',{current_password:password,password:'Secure-new-password1!'},token)).status,200);
    assert.equal((await api('/api/farmer/profile',undefined,token)).status,401);
    const fresh = await api('/api/farmer/login',{email:'farmer@example.com',password:'Secure-new-password1!'});
    assert.equal((await api('/api/farmer/profile',undefined,fresh.body.data.token)).status,200);
});
test('JSON parser errors and array bodies return clean client errors with security headers', async () => {
    const malformed = await fetch(base+'/api/buyer/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"bad"'});
    assert.equal(malformed.status,400); assert.equal((await malformed.json()).success,false);
    assert.equal(malformed.headers.get('x-content-type-options'),'nosniff'); assert.equal(malformed.headers.get('x-powered-by'),null);
    assert.equal((await api('/api/buyer/register',[])).status,400);
});

test('approval recovers GoTrue profiles created before app metadata, for both farmer and buyer', async () => {
    delayedTrigger = true;
    for (const role of ['farmer', 'buyer']) {
        const id = await submit(role);
        const result = await approve(id);
        assert.equal(result.status, 200);
        const profile = profiles.get(result.body.data.user_id);
        assert.equal(profile.registration_request_id, id); assert.equal(profile.role, role); assert.equal(profile.is_approved, true);
    }
});
