## Goal

Match the exact Postman request that returned `{"status":"Success",...}` — send the SMS template literally (no OTP substitution) and include the `message` param twice, exactly like the working URL.

## Changes

### `src/lib/otp.functions.ts`

1. **Stop substituting the OTP into the template.**
   - `buildMessage(otp)` currently does `SMS_TEMPLATE.replace("{#var#}", otp)`.
   - Change it to return `SMS_TEMPLATE` unchanged, so the body stays exactly:
     `Dear {#var#}, payment for Invoice No. {#var#} related to {#var#} services amounting to Rs.{#var#} was due on {#var#} and is still pending. Kindly pay immediately to avoid service interruption. SENSEFLOW INSTRUMENTS PRIVATE LIMITED.`

2. **Duplicate the `message` query param** (Postman URL has it twice, and that is what returned Success).
   - `URLSearchParams.set` only writes one; switch to `append` for `message` and call it twice with the same value. All other params (`apikey`, `senderid`, `templateid`, `number`) stay single via `set`.

3. **Keep OTP generation, storage, and verification untouched** — the DB still gets a fresh 6-digit code, `verifyLoginOtp` still works. Only the outbound SMS body changes for this test.

4. **Keep server-side logs** (`[sms:server] fetching…`, `response`, `failed`) so we can compare the response JSON against the expected `"status":"Success"` payload.

### `src/routes/auth.tsx`

No changes — it already logs `smsStatus` and `message` from the server response.

## Verification

After the change, the outbound URL logged server-side (with apikey redacted) should match the Postman URL structure:
`...&number=+91...&message=Dear {%23var%23}...LIMITED.&message=Dear {%23var%23}...LIMITED.`
and the response body should be `{"status":"Success","code":"011",...}`.

## Note

This is a temporary test setup — the user will still receive the literal template with `{#var#}` placeholders in the SMS, not their actual OTP. Revert `buildMessage` to substitute the OTP once the provider delivery is confirmed.
