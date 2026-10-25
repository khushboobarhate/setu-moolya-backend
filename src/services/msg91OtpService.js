const MSG91_VERIFY_ACCESS_TOKEN_URL = "https://api.msg91.com/api/v5/widget/verifyAccessToken";

const verifyMsg91WidgetAccessToken = async ({
    accessToken,
    expectedPhone,
    fetchImpl = fetch
}) => {
    const authKey = process.env.MSG91_AUTH_KEY;
    if (!authKey) throw new Error("MSG91_AUTH_KEY is not configured.");

    const response = await fetchImpl(MSG91_VERIFY_ACCESS_TOKEN_URL, {
        method: "POST",
        headers: {
            authkey: authKey,
            "content-type": "application/json"
        },
        body: JSON.stringify({ "access-token": accessToken })
    });

    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error(`MSG91 returned an invalid response (${response.status}).`);
    }

    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`MSG91 returned an invalid response (${response.status}).`);
    }
    if (!response.ok) {
        throw new Error(data.message || `MSG91 request failed (${response.status}).`);
    }
    if (data.type !== "success") {
        return { valid: false, message: "MSG91 did not verify the OTP widget token." };
    }

    const verifiedPhone = typeof data.message === "string"
        ? data.message.replace(/\D/g, "")
        : "";
    const requestedPhone = expectedPhone.replace(/\D/g, "");

    if (!verifiedPhone || verifiedPhone !== requestedPhone) {
        return { valid: false, message: "Verified phone number does not match the requested number." };
    }

    return { valid: true, message: "OTP verified successfully." };
};

module.exports = { verifyMsg91WidgetAccessToken };
