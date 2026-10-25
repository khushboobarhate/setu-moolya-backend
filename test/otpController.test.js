const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { test } = require("node:test");
const { sendOtp, verifyOtp } = require("../src/controllers/otpController");

const withMsg91Environment = (testContext, callback) => {
    const envKeys = ["SMS_PROVIDER", "MSG91_AUTH_KEY", "JWT_SECRET"];
    const previousValues = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.SMS_PROVIDER = "msg91";
    process.env.MSG91_AUTH_KEY = "test-auth-key";
    process.env.JWT_SECRET = "test-jwt-secret";

    const previousFetch = global.fetch;
    testContext.after(() => {
        for (const key of envKeys) {
            if (previousValues[key] === undefined) delete process.env[key];
            else process.env[key] = previousValues[key];
        }
        global.fetch = previousFetch;
    });

    return callback();
};

const responseRecorder = () => ({
    statusCode: null,
    body: null,
    status(statusCode) {
        this.statusCode = statusCode;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    }
});

test("MSG91 send endpoint tells callers to use the browser widget", async (t) => {
    await withMsg91Environment(t, async () => {
        const response = responseRecorder();
        await sendOtp({ body: { phone: "+91 98765 43210" } }, response);

        assert.equal(response.statusCode, 409);
        assert.equal(response.body.success, false);
        assert.match(response.body.message, /MSG91 browser widget/);
    });
});

test("MSG91 verify endpoint validates the widget token before issuing a registration token", async (t) => {
    await withMsg91Environment(t, async () => {
        let request;
        global.fetch = async (url, options) => {
            request = { url: new URL(url), options };
            return {
                ok: true,
                status: 200,
                json: async () => ({ type: "success", message: "919876543210" })
            };
        };

        const response = responseRecorder();
        await verifyOtp({
            body: { phone: "+91 98765 43210", access_token: "widget-jwt" }
        }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.success, true);
        assert.equal(request.url.href, "https://api.msg91.com/api/v5/widget/verifyAccessToken");
        assert.deepEqual(JSON.parse(request.options.body), { "access-token": "widget-jwt" });
        assert.equal(
            jwt.verify(response.body.phone_verified_token, "test-jwt-secret").phone,
            "+91 98765 43210"
        );
    });
});

test("MSG91 does not issue a registration token when the widget token belongs to another phone", async (t) => {
    await withMsg91Environment(t, async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ type: "success", message: "918888888888" })
        });

        const response = responseRecorder();
        await verifyOtp({
            body: { phone: "+919876543210", access_token: "widget-jwt" }
        }, response);

        assert.equal(response.statusCode, 400);
        assert.equal(response.body.success, false);
        assert.equal("phone_verified_token" in response.body, false);
    });
});

test("MSG91 verification errors do not issue a registration token", async (t) => {
    await withMsg91Environment(t, async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ type: "error", message: "Invalid access token" })
        });

        const response = responseRecorder();
        await verifyOtp({
            body: { phone: "+919876543210", access_token: "invalid-widget-token" }
        }, response);

        assert.equal(response.statusCode, 400);
        assert.equal(response.body.success, false);
        assert.equal("phone_verified_token" in response.body, false);
    });
});
