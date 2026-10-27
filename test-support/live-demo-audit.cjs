// Explicit opt-in. Only generated audit accounts and operator-created demo
// accounts are changed. No SMTP messages are sent; only owned audit recipients
// are captured, and the temporary accounts/records are removed in finally.
if (process.env.ALLOW_LIVE_DEMO_AUDIT !== "true")
  throw new Error(
    "Set ALLOW_LIVE_DEMO_AUDIT=true to run this controlled live audit.",
  );
process.env.NODE_ENV = "test"; // Suppress index.js listener, not Supabase access.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  supabaseAdmin,
  createAuthClient,
  isConfigured,
} = require("../src/config/supabase");
const email = require("../src/config/email");
const receivers = new Set(),
  messages = [],
  requestIds = [],
  accounts = [],
  files = [];
const originalSend = email.sendEmail;
let delivery = true,
  adminToken,
  auditAdmin,
  server,
  base;
email.sendEmail = async (message) => {
  assert.ok(receivers.has(message.to), "Refusing unexpected email recipient");
  messages.push(message);
  return { success: delivery };
};
const password = () => `Audit1!${randomBytes(18).toString("base64url")}`;
const call = async (route, { method, body, token } = {}) => {
  const response = await fetch(base + route, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(body !== undefined
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  return { status: response.status, json: await response.json() };
};
const login = async (role, email, password) => {
  const result = await call(`/api/${role}/login`, {
    body: { email, password },
  });
  assert.equal(result.status, 200, `${role} sign-in failed`);
  return result.json.data;
};
const memberClient = (token) =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
(async () => {
  try {
    assert.ok(isConfigured);
    const stamp = Date.now().toString(36) + randomBytes(3).toString("hex");
    // Use a disposable operator-owned test administrator. Never rotate the real admin password.
    const adminEmail = `audit-admin-${stamp}@example.com`,
      adminPassword = password();
    const createdAdmin = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      app_metadata: { role: "admin", audit_run: stamp },
    });
    assert.ifError(createdAdmin.error);
    auditAdmin = { id: createdAdmin.data.user.id, email: adminEmail };
    const promoted = await supabaseAdmin
      .from("profiles")
      .update({
        role: "admin",
        is_approved: true,
        full_name: "Disposable audit administrator",
      })
      .eq("id", auditAdmin.id)
      .select("id")
      .single();
    assert.ifError(promoted.error);
    server = require("../index").listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const admin = await login("admin", adminEmail, adminPassword);
    adminToken = admin.token;
    assert.equal(
      (await call("/api/admin/profile", { token: adminToken })).json.data.role,
      "admin",
    );
    for (const role of ["farmer", "buyer"]) {
      const address = `audit-${role}-${stamp}@example.com`;
      receivers.add(address);
      const details = {
        full_name: `Audit ${role} (sample account)`,
        email: address,
        mobile_number: role === "farmer" ? "0000000011" : "0000000012",
        state: "Maharashtra",
        city: "Pune",
        full_address: "Sample audit address, Pune",
        ...(role === "farmer"
          ? { land_location: "Sample audit farm, Pune" }
          : {}),
        preferred_language: "en",
        role: "admin",
        is_approved: true,
      };
      const submitted = await call(`/api/${role}/register`, { body: details });
      assert.equal(submitted.status, 201);
      const id = submitted.json.data.request_id;
      requestIds.push(id);
      const reviewed = await call(`/api/admin/requests/${id}`, {
        token: adminToken,
      });
      assert.equal(reviewed.json.data.status, "pending");
      assert.equal(reviewed.json.data.role, role);
      assert.equal(reviewed.json.data.full_address, details.full_address);
      delivery = role !== "farmer";
      let approved = await call(`/api/admin/requests/${id}/approve`, {
        token: adminToken,
        body: {},
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.json.data.email_sent, delivery);
      accounts.push({
        id: approved.json.data.user_id,
        email: address,
        request: id,
        role,
      });
      if (!delivery) {
        delivery = true;
        approved = await call(`/api/admin/requests/${id}/send-credentials`, {
          token: adminToken,
          body: {},
        });
        assert.equal(approved.status, 200);
        assert.equal(approved.json.data.email_sent, true);
      }
      const temporary = messages
        .at(-1)
        .text.match(/Temporary password: (\S+)/)[1];
      const session = await login(role, address, temporary);
      assert.equal(session.must_change_password, true);
      assert.equal(
        (await call(`/api/${role}/availability`, { token: session.token }))
          .status,
        403,
      );
      assert.equal(
        (await call("/api/admin/requests", { token: session.token })).status,
        403,
      );
      const chosen = password();
      assert.equal(
        (
          await call(`/api/${role}/change-password`, {
            token: session.token,
            body: { current_password: temporary, password: chosen },
          })
        ).status,
        200,
      );
      assert.equal(
        (await call(`/api/${role}/profile`, { token: session.token })).status,
        401,
      );
      Object.assign(accounts.at(-1), {
        password: chosen,
        token: (await login(role, address, chosen)).token,
      });
    }
    const farmer = accounts[0],
      buyer = accounts[1];
    for (const invalid of ["123456789", "12345678901", "+919876543210"])
      assert.equal(
        (
          await call("/api/buyer/register", {
            body: {
              full_name: "Sample Applicant",
              email: `invalid-${stamp}@example.com`,
              mobile_number: invalid,
              state: "Maharashtra",
              city: "Pune",
              full_address: "Sample audit address",
            },
          })
        ).status,
        400,
      );
    const photo = await fs.readFile(path.join(__dirname, "pixel.jpg"));
    const cropForm = new FormData();
    Object.entries({
      crop_name: `Audit wheat ${stamp}`,
      crop_type: "organic",
      quantity: "25.5",
      quantity_unit: "kg",
      price: "32.50",
      description: "Sample audit listing; removed after verification.",
    }).forEach(([key, value]) => cropForm.append(key, value));
    cropForm.append(
      "photos",
      new Blob([photo], { type: "image/jpeg" }),
      "pixel.jpg",
    );
    const created = await call("/api/farmer/crops", {
      token: farmer.token,
      body: cropForm,
    });
    assert.equal(created.status, 201);
    const crop = created.json.data;
    files.push(...crop.photos);
    const catalog = await call(
      `/api/buyer/crops?search=${encodeURIComponent(stamp)}&crop_type=organic`,
      { token: buyer.token },
    );
    assert.ok(catalog.json.data.some((item) => item.id === crop.id));
    assert.equal(Number(crop.price), 32.5);
    assert.equal(
      (
        await call(`/api/buyer/crops/${crop.id}/interest`, {
          token: buyer.token,
          body: { rating: 1.5 },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(`/api/buyer/crops/${crop.id}/interest`, {
          token: buyer.token,
          body: { rating: 5, notes: "Sample buyer interest." },
        })
      ).status,
      200,
    );
    await call("/api/buyer/availability", {
      method: "PATCH",
      token: buyer.token,
      body: { is_call_available: false },
    });
    const interests = await call("/api/farmer/interests", {
      token: farmer.token,
    });
    const interest = interests.json.data.find((row) => row.crop_id === crop.id);
    assert.ok(interest);
    assert.equal(interest.buyer.mobile_number, undefined);
    assert.equal(interest.buyer.email, undefined);
    const denied = await call("/api/farmer/calls/initiate", {
      token: farmer.token,
      body: { buyer_id: buyer.id, crop_id: crop.id },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.json.data?.receiver_phone, undefined);
    await call("/api/buyer/availability", {
      method: "PATCH",
      token: buyer.token,
      body: { is_call_available: true },
    });
    assert.equal(
      (
        await call("/api/farmer/calls/initiate", {
          token: farmer.token,
          body: { buyer_id: buyer.id, crop_id: crop.id },
        })
      ).json.data.receiver_phone,
      "0000000012",
    );
    await call("/api/farmer/availability", {
      method: "PATCH",
      token: farmer.token,
      body: { is_call_available: false },
    });
    assert.equal(
      (
        await call("/api/buyer/calls/initiate", {
          token: buyer.token,
          body: { farmer_id: farmer.id, crop_id: crop.id },
        })
      ).status,
      403,
    );
    await call("/api/farmer/availability", {
      method: "PATCH",
      token: farmer.token,
      body: { is_call_available: true },
    });
    assert.equal(
      (
        await call("/api/buyer/calls/initiate", {
          token: buyer.token,
          body: { farmer_id: farmer.id, crop_id: crop.id },
        })
      ).json.data.receiver_phone,
      "0000000011",
    );
    const rls = memberClient(buyer.token);
    const deniedUpdate = await rls
      .from("profiles")
      .update({ role: "admin", is_approved: true })
      .eq("id", buyer.id);
    assert.ok(deniedUpdate.error, "RLS allowed role update");
    const hidden = await rls
      .from("registration_requests")
      .select("id")
      .eq("id", buyer.request);
    assert.ifError(hidden.error);
    assert.equal(hidden.data.length, 0);
    const rpc = await rls.rpc("claim_registration_request", {
      p_request_id: buyer.request,
      p_review_token: require("node:crypto").randomUUID(),
    });
    assert.ok(rpc.error, "RLS allowed service-only RPC");
    const parts = buyer.token.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
    claims.app_metadata = { ...claims.app_metadata, role: "admin" };
    parts[1] = Buffer.from(JSON.stringify(claims)).toString("base64url");
    assert.equal(
      (await call("/api/admin/profile", { token: parts.join(".") })).status,
      401,
    );
    assert.equal(
      (
        await call("/api/buyer/forgot-password", {
          body: { email: buyer.email },
        })
      ).status,
      200,
    );
    const link = new URL(messages.at(-1).text.match(/http[^\s]+/)[0]);
    assert.ok(link.hash.includes("token_hash="));
    assert.equal(link.search, "");
    const reset = new URLSearchParams(link.hash.slice(1)).get("token_hash");
    assert.equal(
      (
        await call("/api/buyer/reset-password", {
          body: { token_hash: reset, password: "weak" },
        })
      ).status,
      400,
    );
    const recovered = password();
    assert.equal(
      (
        await call("/api/buyer/reset-password", {
          body: { token_hash: reset, password: recovered },
        })
      ).status,
      200,
    );
    assert.equal(
      (await call("/api/buyer/profile", { token: buyer.token })).status,
      401,
    );
    assert.equal(
      (await login("buyer", buyer.email, recovered)).must_change_password,
      false,
    );
    assert.equal(
      (
        await call("/api/buyer/reset-password", {
          body: { token_hash: reset, password: password() },
        })
      ).status,
      400,
    );
    // Prepare the explicitly requested demo accounts for a usable browser demo.
    const credentialsFile = path.join(
      __dirname,
      "../demo-credentials.local.json",
    );
    const demos = JSON.parse(await fs.readFile(credentialsFile, "utf8"));
    for (const demo of demos) {
      const account = await supabaseAdmin.auth.admin.getUserById(demo.user_id);
      assert.ok(account.data.user.app_metadata.demo_account);
      assert.equal(account.data.user.email, demo.email);
      let session = await login(demo.role, demo.email, demo.password);
      if (session.must_change_password) {
        const chosen = password();
        assert.equal(
          (
            await call(`/api/${demo.role}/change-password`, {
              token: session.token,
              body: { current_password: demo.password, password: chosen },
            })
          ).status,
          200,
        );
        demo.password = chosen;
        demo.must_change_password = false;
        demo.temporary_password_expires_at = null;
        session = await login(demo.role, demo.email, chosen);
        await fs.writeFile(
          credentialsFile,
          JSON.stringify(demos, null, 2) + "\n",
          { mode: 0o600 },
        );
        await fs.chmod(credentialsFile, 0o600);
      }
      if (demo.role === "farmer")
        assert.equal(
          (await call(`/api/farmer/crops/${crop.id}`, { token: session.token }))
            .status,
          404,
        );
      await supabaseAdmin.auth.admin.signOut(session.token, "local");
    }
    await fs.writeFile(credentialsFile, JSON.stringify(demos, null, 2) + "\n", {
      mode: 0o600,
    });
    await fs.chmod(credentialsFile, 0o600);
    assert.equal(
      (
        await call(`/api/farmer/crops/${crop.id}`, {
          method: "DELETE",
          token: farmer.token,
        })
      ).status,
      200,
    );
    console.log(
      "LIVE PASS: admin, farmer and buyer authentication; real registration/approval handoff; SMTP-failure retry (captured mail); forced password change; crop photo/price/search; ratings; privacy and availability gates; ownership; RLS role/RPC protection; forged JWT rejection; one-time recovery and old-session invalidation.",
    );
    console.log(
      "Demo farmer and buyer logins verified. Current credentials remain in ignored demo-credentials.local.json. No real emails sent.",
    );
  } finally {
    email.sendEmail = originalSend;
    if (receivers.size) {
      const owned = await supabaseAdmin
        .from("profiles")
        .select("id,email")
        .in("email", [...receivers]);
      if (owned.error) throw owned.error;
      for (const profile of owned.data)
        if (!accounts.some((account) => account.id === profile.id)) {
          const current = await supabaseAdmin.auth.admin.getUserById(
            profile.id,
          );
          if (
            !requestIds.includes(
              current.data?.user?.app_metadata?.registration_request_id,
            )
          )
            throw new Error("Unexpected audit account link");
          accounts.push({ id: profile.id, email: profile.email });
        }
    }
    for (const account of accounts) {
      const current = await supabaseAdmin.auth.admin.getUserById(account.id);
      if (current.data?.user?.email !== account.email)
        throw new Error("Cleanup ownership check failed");
    }
    if (requestIds.length) {
      const { error } = await supabaseAdmin
        .from("registration_requests")
        .delete()
        .in("id", requestIds);
      if (error) throw error;
    }
    for (const account of accounts) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(account.id);
      if (error) throw error;
    }
    const { CROP_UPLOAD_DIR } = require("../src/config/multer");
    for (const image of files) {
      const name = image.slice("/uploads/crops/".length);
      if (/^crop-[a-z0-9_-]+\.webp$/i.test(name))
        await fs.unlink(path.join(CROP_UPLOAD_DIR, name)).catch(() => {});
    }
    if (adminToken) await supabaseAdmin.auth.admin.signOut(adminToken, "local");
    if (auditAdmin) {
      const current = await supabaseAdmin.auth.admin.getUserById(auditAdmin.id);
      assert.equal(current.data?.user?.email, auditAdmin.email);
      const removed = await supabaseAdmin.auth.admin.deleteUser(auditAdmin.id);
      assert.ifError(removed.error);
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    console.log("Owned audit accounts and records cleaned up.");
  }
})().catch((error) => {
  console.error("Live demo audit failed:", error.message);
  process.exitCode = 1;
});
