const assert = require("node:assert/strict");
const { test } = require("node:test");
const { verifyMsg91WidgetAccessToken } = require("../src/services/msg91OtpService");

const withMsg91AuthKey = (testContext, callback) => {
    const previousAuthKey = process.env.MSG91_AUTH_KEY;
    process.env.MSG91_AUTH_KEY = "test-auth-key";
    testContext.after(() => {
        if (previousAuthKey === undefined) delete process.env.MSG91_AUTH_KEY;
        else process.env.MSG91_AUTH_KEY = previousAuthKey;
    });
    return callback();
};

const jsonResponse = (data, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
});

test("validates a widget access token with MSG91 and matches its phone identifier", async (t) => {
    await withMsg91AuthKey(t, async () => {
        let request;
        const result = await verifyMsg91WidgetAccessToken({
            accessToken: "widget-jwt",
            expectedPhone: "+919999999999",
            fetchImpl: async (url, options) => {
                request = { url, options };
                return jsonResponse({ type: "success", message: "919999999999" });
            }
        });

        assert.equal(request.url, "https://api.msg91.com/api/v5/widget/verifyAccessToken");
        assert.equal(request.options.method, "POST");
        assert.equal(request.options.headers.authkey, "test-auth-key");
        assert.equal(request.options.headers["content-type"], "application/json");
        assert.deepEqual(JSON.parse(request.options.body), { "access-token": "widget-jwt" });
        assert.deepEqual(result, { valid: true, message: "OTP verified successfully." });
    });
});

test("rejects a valid widget token whose verified phone does not match", async (t) => {
    await withMsg91AuthKey(t, async () => {
        const result = await verifyMsg91WidgetAccessToken({
            accessToken: "widget-jwt",
            expectedPhone: "+919999999999",
            fetchImpl: async () => jsonResponse({ type: "success", message: "918888888888" })
        });

        assert.deepEqual(result, {
            valid: false,
            message: "Verified phone number does not match the requested number."
        });
    });
});

test("rejects MSG91 failure payloads returned with HTTP 200", async (t) => {
    await withMsg91AuthKey(t, async () => {
        const result = await verifyMsg91WidgetAccessToken({
            accessToken: "invalid-widget-jwt",
            expectedPhone: "+919999999999",
            fetchImpl: async () => jsonResponse({ type: "error", message: "Invalid access token" })
        });

        assert.deepEqual(result, {
            valid: false,
            message: "MSG91 did not verify the OTP widget token."
        });
    });
});

test("reports MSG91 HTTP failures explicitly", async (t) => {
    await withMsg91AuthKey(t, async () => {
        await assert.rejects(
            verifyMsg91WidgetAccessToken({
                accessToken: "widget-jwt",
                expectedPhone: "+919999999999",
                fetchImpl: async () => jsonResponse({ message: "Invalid AuthKey" }, 401)
            }),
            /Invalid AuthKey/
        );
    });
});

test("requires an MSG91 server AuthKey", async (t) => {
    const previousAuthKey = process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_AUTH_KEY;
    t.after(() => {
        if (previousAuthKey === undefined) delete process.env.MSG91_AUTH_KEY;
        else process.env.MSG91_AUTH_KEY = previousAuthKey;
    });

    await assert.rejects(
        verifyMsg91WidgetAccessToken({
            accessToken: "widget-jwt",
            expectedPhone: "+919999999999"
        }),
        /MSG91_AUTH_KEY is not configured/
    );
});
