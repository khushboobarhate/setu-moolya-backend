# SetuMoolya backend v4

Express backend with three roles: **admin**, **farmer**, **buyer**. Supabase provides PostgreSQL and authentication; SMTP sends account and password recovery emails. SMS OTP, Twilio and MSG91 are removed. There is no external document-verification integration: admins review the submitted details themselves.

## Registration and approval flow

1. Farmer or buyer submits their details and a working contact email. No password, phone-verification token, or document-verification service is needed. A photo is optional.
2. The backend saves a `pending` registration in `registration_requests`. No login account exists yet. The admin dashboard reads this same table, including all submitted details and photo URL.
3. Admin reviews the details and clicks **Approve & send credentials**. The backend creates a Supabase account using the applicant's real email as the login ID, generates a random temporary password, copies the registration details to the approved profile, records the reviewer, and emails the credentials.
4. Farmer/buyer sets their own password through **Forgot password**, or logs in with the temporary password and uses **Change password**. Marketplace routes require this change. Temporary passwords expire after 48 hours by default.
5. If the email fails, the request remains approved and reports `email_sent: false`, `credentials_email_status: "failed"`. Admin can click **Send credentials** to generate and send a replacement temporary password. Plaintext passwords are never stored or returned in API responses.
6. Rejection requires a reason. The applicant can correct their details and register again.

The email address is also the login ID so recovery goes to an actual mailbox. No synthetic `@setumoolya.com` addresses are created.

## Setup

Requires Node.js 22+, a Supabase project and an SMTP mailbox.

```sh
npm ci
cp .env.example .env
# Fill in Supabase and SMTP values in .env.
npm run dev
# Production: npm start
```

- **New database:** run the complete `supabase_schema.sql` in the Supabase SQL Editor. It includes the v4 migration.
- **Existing v2/v3 database:** run `supabase_migration_v4.sql`. For an older pre-v2 installation, first apply v2 and v3. Do not rerun old migrations after v4; they recreate the old policies and triggers.
- Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key must stay on the server. Public-key fallback is deliberately disabled.
- Set `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, and `EMAIL_PASS`. With Gmail use a mailbox App Password. Normal SMTP certificate validation is enabled.
- Set `CLIENT_URL`, `CLIENT_LOGIN_URL` and `CLIENT_RESET_PASSWORD_URL` to the frontend URLs. The latter defaults to `<CLIENT_URL>/reset-password`.
- Set `TEMP_PASSWORD_HOURS` between 1 and 168 (default 48).
- In Supabase Auth, disable public user signups; accounts are created through the backend admin API. Configure the email recovery token lifetime in the project's Auth settings.

After applying the database schema/migration, create the administrator using the server-only setup command. In the ignored `.env` file, set `ADMIN_EMAIL=admin-user@gmail.com` and `ADMIN_PASSWORD` to the requested password, then run:

```sh
npm run admin:create
```

The command creates or updates that Auth account, marks its profile as an approved admin, and verifies login using the supplied password. Rerunning it updates the same account, including its password. No credentials are hardcoded into the application or committed to Git. Remove `ADMIN_PASSWORD` from `.env` after setup. Admin login is `POST /api/admin/login` with `{ "email": "admin-user@gmail.com", "password": "<configured password>" }`.

Alternatively, create an account in Supabase Dashboard → Authentication → Users, then explicitly promote its profile in SQL:

```sql
UPDATE public.profiles
SET role = 'admin', is_approved = true
WHERE email = 'your-admin@example.com';
```

Signup `user_metadata.role` cannot grant admin access. Profile role/approval changes are restricted to the backend/database administrator.

For the requested demo farmer and buyer, run `npm run demo:create` **after applying v4 and creating the admin**. This registers and approves `farmer@example.com` and `buyer@example.com` with clearly marked sample details through the same registration controller and approval transaction, verifies both logins, and sends no emails. Random temporary passwords are saved to `demo-credentials.local.json`, an ignored local file readable only by its owner. Change each password after login; rerunning the command replaces only accounts previously created as demos. It refuses to overwrite non-demo accounts.

The Supabase API keys alone cannot apply SQL migrations. If the database still has an old Auth trigger, account creation can fail with `Database error creating new user`; run the migration in the SQL Editor before the setup commands.

`GET /health` reports whether Supabase credentials are configured; it does not perform a live database connection test.

## Registration requests

`POST /api/farmer/register` and `POST /api/buyer/register` accept JSON or `multipart/form-data` with optional `photo` (JPEG/PNG/WebP, at most 5 MB).

```json
{
  "full_name": "Ramesh Sharma",
  "email": "ramesh@example.com",
  "mobile_number": "+919876543210",
  "state": "Maharashtra",
  "city": "Pune",
  "full_address": "12 Market Road, Pune",
  "land_location": "Village Plot 4",
  "age": 35,
  "nationality": "Indian",
  "taluka": "Haveli",
  "preferred_language": "mr"
}
```

Required: `full_name`, `email`, `mobile_number`, `state`, `city`, `full_address`; farmers additionally require `land_location`. `age` (18–120), nationality, taluka, preferred language (default `en`) and photo are optional. Buyers do not need land details. Role and approval status come from the server. One active registration/account per email is allowed, across both roles.

Success is HTTP 201 with `data.request_id`, `role`, `full_name`, `email`, `status: "pending"`, `photo_url` and `preferred_language`. Duplicate active email returns 409. Rejected applications do not prevent resubmission.

## Admin panel integration

All protected calls require `Authorization: Bearer <token>`.

| Action | Endpoint | Body / behavior |
| --- | --- | --- |
| Login | `POST /api/admin/login` | `{ "email": "...", "password": "..." }`; token at `data.token` |
| Pending dashboard | `GET /api/admin/dashboard` | `data.pending_requests` and `data.requests`, plus `data.pagination` |
| All/filter requests | `GET /api/admin/requests?status=all&role=farmer&page=1&limit=50` | Status: `pending` (default), `approved`, `rejected`, `all`. Role optional: farmer/buyer. Limit 1–100. |
| Review details | `GET /api/admin/requests/:requestId` | Complete registration fields, review information and email status |
| Correct legacy email | `PATCH /api/admin/requests/:requestId` | `{ "email": "applicant@example.com" }`; pending requests only |
| Approve & send credentials | `POST /api/admin/requests/:requestId/approve` | Empty body. Creates account and sends random temporary credentials. |
| Retry credential email | `POST /api/admin/requests/:requestId/send-credentials` | Empty body. Replaces the previous temporary password. Refused after the user sets their own password. |
| Reject | `POST /api/admin/requests/:requestId/reject` | `{ "reason": "Please correct the address." }` |
| Approved users | `GET /api/admin/users?role=farmer` | Approved profiles only; supports page/limit |
| Crops | `GET /api/admin/crops` | Available crop listings |
| Call logs | `GET /api/admin/call-logs` | Platform call records |

Approval responds with `data.request_id`, `user_id`, `login_id`, `role`, `status`, `email_sent`, `credentials_email_status` and `can_resend_credentials`. The admin panel must inspect `email_sent`; an approved account does not mean SMTP accepted its email. SMTP acceptance does not guarantee inbox delivery.

Refresh the request after network failures before retrying. Concurrent review actions return 409. Profile and request approval are committed together in PostgreSQL. An interrupted account-creation step leaves an unapproved account linked to the request; retrying approval recovers it. A crashed process's review lease can be reclaimed after ten minutes. Credentials are generated only in memory and sent only to the registered contact email.

## Farmer/buyer login and passwords

Replace `:role` below with `farmer` or `buyer`.

| Action | Endpoint | Body |
| --- | --- | --- |
| Login | `POST /api/:role/login` | `{ "login_id": "applicant@example.com", "password": "..." }` (`email` alias supported) |
| Forgot password | `POST /api/:role/forgot-password` | `{ "email": "applicant@example.com" }` |
| Reset password | `POST /api/:role/reset-password` | `{ "token_hash": "<from reset link>", "password": "New-strong-password1!" }` |
| Change password | `POST /api/:role/change-password` | Bearer token + `{ "current_password": "...", "password": "New-strong-password1!" }` |
| Profile | `GET /api/:role/profile` | Bearer token; includes `must_change_password` |

Login returns `data.token`, `refreshToken`, `expiresIn`, `user` and `must_change_password`. If `must_change_password` is true, show the password form. Business routes return 403 with `code: "PASSWORD_CHANGE_REQUIRED"` until the password is changed. Expired temporary credentials return `TEMPORARY_PASSWORD_EXPIRED`; use Forgot password.

The reset email points to:

```text
https://your-frontend/reset-password#token_hash=<secret>&role=farmer
```

The frontend should read `new URLSearchParams(window.location.hash.slice(1))`, show a new-password form, then POST the token and password to the matching role's reset endpoint. Remove the fragment from the browser history after reading it and do not log it. Do not call reset on page load: submit the token once with the chosen password. The backend verifies a single-use Supabase **recovery** token before updating the password. No SMS is involved. After a successful reset/change, return to login with the new password.

Passwords must be 12–128 characters with uppercase, lowercase, a number and a symbol. Forgot password gives the same response for unknown, unapproved and wrong-role accounts. Public registration/login/recovery endpoints are rate limited by IP (in-memory store for one server process). A multi-instance deployment needs a shared limiter store; configure Express's trusted proxy setting for the actual deployment topology before forwarding client IPs.

## Existing marketplace APIs

Farmer crop uploads/list/detail/delete, buyer crop browsing/interests, role profiles, call availability and direct-contact call permissions retain their existing routes. `GET /api/endpoints` lists them. Calling reveals a permitted contact number; it does not place a paid provider call.

Only `/uploads/photos` and `/uploads/crops` are served publicly. Local JSON data under `uploads/data` is no longer exposed. The existing marketplace models retain their local JSON fallback; production deployments should apply the SQL migrations so these models use the database. Uploads need persistent local storage on the backend host.

## Migrating existing data and clients

The v4 migration preserves historical registrations and OTP tables. OTP endpoints, OTP configuration, token fields and the SMS provider code are removed. The project specification PDF and v2/v3 SQL files are historical; this README describes the current implementation.

Before migration, check for duplicate active contact emails and resolve them manually:

```sql
SELECT lower(btrim(email)) AS email, count(*), array_agg(id)
FROM public.registration_requests
WHERE status IN ('pending', 'approved') AND email IS NOT NULL
GROUP BY lower(btrim(email)) HAVING count(*) > 1;
```

The migration intentionally fails rather than discarding duplicate applications. Pending legacy registrations without contact email remain visible; an admin must add a real email using the correction endpoint before approval. Existing approved accounts with synthetic login emails are preserved; recovery for those accounts requires an administrator to migrate both the Supabase Auth email and the profile email to their real mailbox. This migration does not invent missing email addresses.

Frontend changes are required: remove OTP screens, collect email during registration, make photo optional, add approve/resend/reject actions and password forms, and handle `must_change_password`. This repository contains the backend only.

## Validation

```sh
npm test
npm audit
```

The automated suite covers onboarding through the HTTP routes with mocked external Supabase/SMTP boundaries, including both roles, email failure/retry, duplicate/concurrent actions, password recovery and authorization, plus existing marketplace behavior. Tests use temporary local stores and never service credentials.

For PostgreSQL validation, use a **new isolated test database**, never a production database. `test-support/supabase-fixture.sql` supplies a minimal Auth surface for local PostgreSQL. Run it, then `supabase_schema.sql`, optionally rerun `supabase_migration_v4.sql`, then `test-support/registration-security.sql`. The latter checks SQL approval, review leases, duplicate-email constraints, role escalation protection and RLS, and rolls back its test data. Real Supabase Auth and SMTP delivery still need deployment credentials for an end-to-end integration check.
