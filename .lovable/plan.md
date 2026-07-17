## Goal

Re-enable OTP substitution so the SMS you receive contains a real 6-digit code you can type into the verify screen to sign in and land on `/dashboard`.

## Changes

### `src/lib/otp.functions.ts`
- Restore `buildMessage(otp)` to substitute the OTP into the FIRST `{#var#}` only, leaving the other four placeholders literal (DLT template rule):
  ```
  return SMS_TEMPLATE.replace("{#var#}", otp);
  ```
- No changes to URL building (manual query string with literal `+`, `message` twice, POST method) — that path is already delivering.
- OTP generation, DB storage (`otp_codes.code_hash`), and `verifyLoginOtp` remain unchanged, so the code you receive will match the one verified server-side.

### `src/routes/auth.tsx`
- No functional changes needed. The verify step already:
  1. Calls `verifyLoginOtp({ phone, code })`
  2. Uses the returned `tokenHash` with `supabase.auth.verifyOtp({ type: "magiclink" })`
  3. `navigate({ to: "/dashboard", replace: true })` on success

## Verification

After the change:
1. Enter phone → **Send OTP** → SMS arrives with `Dear 483920, payment for Invoice No. {#var#} …` (real 6-digit code in the greeting).
2. Enter that 6-digit code on the verify screen → **Verify & sign in**.
3. Toast "Signed in" → redirect to `/dashboard`.

Server console still logs `[sms:server] response` with `status: "Success"`; browser console logs `smsResponse` with credit info.

## Not changed
Anything in `_authenticated/dashboard.tsx`, auth middleware, `user_roles`, or profile flow. Purely re-enabling the OTP → template substitution.
