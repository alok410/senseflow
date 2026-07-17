## Goal

Replace Supabase's built-in phone/OTP with a **custom OTP flow** that sends the code through your Senseflow SMS API (`smsfortius.work/V2/apikey.php`). The DLT-approved template body is used verbatim — only the OTP replaces one of the `{#var#}` slots. Also seed the admin and consumer accounts you specified.

## OTP flow (mobile + custom SMS)

1. User enters mobile number on `/auth`.
2. Client calls server fn `requestLoginOtp({ phone })`:
   - Looks up a `profiles` row by that phone. If none exists → error "No account for this number. Ask your admin to add you." (per your rule that only admins create users).
   - Generates a random 6-digit OTP.
   - Stores `phone`, `code_hash` (sha256), `expires_at = now()+5m`, `attempts=0` in a new `otp_codes` table (server-only; no RLS access to clients).
   - Calls the SMS API with the OTP substituted into the template. Template is sent **exactly as given**, only the OTP fills the first `{#var#}`; the other placeholders are sent as literal `{#var#}` since your instruction is "don't change template". API key + sender id live in Cloud secrets (`SENSEFLOW_SMS_API_KEY`, `SENSEFLOW_SMS_SENDER_ID`, `SENSEFLOW_SMS_TEMPLATE_ID`).
3. Client shows OTP input, calls `verifyLoginOtp({ phone, code })`:
   - Verifies hash + expiry + attempts (max 5).
   - Uses `supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email: <the user's auth email> })` to mint a one-time token, and returns `{ token_hash, email }`.
   - Client calls `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` to establish the session.
   - Deletes the used OTP row.

Auth emails: every profile is backed by an `auth.users` row keyed by an email. If the admin provides a real email at creation time we use it; otherwise we synthesize `phone-<digits>@sensorflow.local` (never sent to). Phone is the login identifier; email is just Supabase's user handle.

## Users table (admin-managed)

Admin → Users gets a "Create user" dialog with **name, phone (E.164), email (optional), role (admin | secretary | consumer)**. Server fn `admin.createUser`:
- Requires `admin` role.
- Creates the `auth.users` row via `supabaseAdmin.auth.admin.createUser` (no password, `email_confirm: true`).
- Trigger `handle_new_user` writes the `profiles` row (name/phone/email) and default `consumer` role; server fn overwrites role if admin picked a different one.
- No self-signup — the `/auth` page only signs in existing users.

## Seed data

- Admin: `+918780488532` (name: "Admin", role: admin)
- Consumer: `+917984202894` (name: "Consumer", role: consumer, linked to seeded location)
- Placeholder secretary: `+910000000000` name "Demo Secretary" (you'll replace via admin panel later)

Seeding uses `supabaseAdmin.auth.admin.createUser` inside a one-time server fn `seed.bootstrap()` triggered from the admin bootstrap step (idempotent — skips existing phones).

## Secrets to add

- `SENSEFLOW_SMS_API_KEY` = `p1OOLF3PeKkWp2kl`
- `SENSEFLOW_SMS_SENDER_ID` = `SENSFW`
- `SENSEFLOW_SMS_TEMPLATE_ID` = `1707178403224319526`

(I'll open the secure secrets form for these — values pre-filled for confirmation; you can edit before saving.)

## Files added / changed

- Migration: `otp_codes` table (phone, code_hash, expires_at, attempts, created_at). No client GRANTs (server-fn only).
- `src/lib/otp.functions.ts`: `requestLoginOtp`, `verifyLoginOtp`.
- `src/lib/admin.functions.ts`: `createUser`, `updateUserRole`, `deactivateUser`.
- `src/lib/seed.functions.ts`: `bootstrap` (admin-gated, idempotent).
- `src/routes/auth.tsx`: swap `supabase.auth.signInWithOtp/verifyOtp` for the new server fns + `verifyOtp({ token_hash, type:'magiclink' })`.
- `src/routes/_authenticated/admin/users.tsx`: add "Create user" dialog wired to `admin.createUser`.
- Disable Supabase phone provider in `configure_auth` (email is enabled internally for magiclink token generation, but the UI never shows email).

## Notes / trade-offs

- Sending the template with the literal payment-reminder wording containing an OTP will look confusing to users. I'm following your explicit instruction to keep it exactly as-is; happy to swap to a proper OTP template later.
- The magiclink email is never delivered — we only extract the `token_hash` server-side. This avoids maintaining a custom JWT signer.
- All admin/service-role work stays inside server-fn handlers with dynamic `client.server` imports; no service key leaks client-side.
- Twilio is no longer needed.

## After you approve

I'll ask you to confirm the three SMS secrets in a secure form, then implement everything above and run a build check.
