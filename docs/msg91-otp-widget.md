# MSG91 OTP widget integration

The MSG91 widget sends and verifies the SMS in the browser. The backend must not
accept the browser's success callback as proof by itself: it validates the
widget's `access-token` with MSG91 before issuing the app's
`phone_verified_token`.

## Configure MSG91

1. Create and configure an OTP widget in the MSG91 dashboard, including its
   allowed countries and delivery channels.
2. Copy the widget ID and its widget-specific `tokenAuth` value into the
   frontend configuration. MSG91 documents this token for client-side widget
   use; restrict the widget to the expected website/domain in MSG91.
3. Obtain the MSG91 AuthKey for the widget's server-side integration. Set it
   only in the backend environment:

   ```env
   SMS_PROVIDER=msg91
   MSG91_AUTH_KEY=your_server_side_msg91_authkey
   ```

   Do not put this server AuthKey in browser code. `tokenAuth` and `MSG91_AUTH_KEY`
   are separate credentials with different purposes.

## Frontend flow

Use the widget's default verification UI (`exposeMethods: false`). Replace the
widget placeholders and `API_BASE_URL` with values for the frontend environment.
Keep `phoneE164` as the exact phone value that will be submitted during
registration.

```html
<script>
  const phoneE164 = "+919876543210";
  const configuration = {
    widgetId: "YOUR_MSG91_WIDGET_ID",
    tokenAuth: "YOUR_MSG91_WIDGET_TOKEN",
    identifier: phoneE164.replace(/^\+/, ""),
    exposeMethods: false,
    success: async (data) => {
      const accessToken = data && data["access-token"];
      if (typeof accessToken !== "string" || !accessToken) {
        console.error("MSG91 did not return an access token.");
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/otp/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: phoneE164,
            access_token: accessToken
          })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || "Phone verification failed.");
        }

        // Use this token with the farmer or buyer registration request.
        savePhoneVerifiedToken(result.phone_verified_token);
      } catch (error) {
        console.error("Could not complete phone verification:", error);
      }
    },
    failure: (error) => {
      console.error("MSG91 OTP verification failed:", error);
    }
  };
</script>
<script
  async
  src="https://verify.msg91.com/otp-provider.js"
  onload="initSendOTP(configuration)">
</script>
```

The widget's success callback data contains the `access-token` property. Send
that value to the backend as `access_token`; do not send the SMS OTP itself to
the backend when `SMS_PROVIDER=msg91`.

When using `SMS_PROVIDER=msg91`, do not call `POST /api/otp/send`; the browser
widget sends the OTP. `POST /api/otp/verify` accepts:

```json
{
  "phone": "+919876543210",
  "access_token": "JWT returned by the MSG91 widget"
}
```

The backend validates the access token at MSG91's
`POST https://api.msg91.com/api/v5/widget/verifyAccessToken`, checks the
verified mobile number matches `phone`, and only then returns
`phone_verified_token`. Keep the phone value identical in the widget and the
subsequent registration request.

For Twilio or local development, the existing server-side send flow remains:
call `/api/otp/send`, then submit `phone` and numeric `otp` to
`/api/otp/verify`.

Official references:

- [MSG91 OTP widget setup and Web SDK](https://msg91.com/help/MSG91/how-to-integrate-the-new-login-with-otp-widget)
- [MSG91 Verify Access Token API](https://docs.msg91.com/otp-widget/verify-access-token)
