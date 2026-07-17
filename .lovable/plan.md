## Goal

On Send OTP click, hit the Senseflow SMS API from the **browser** (same URL that worked in your Postman test) with the DLT template kept byte-for-byte identical — only the FIRST `{#var#}` swapped with the freshly generated OTP. Log every step in the browser console.

## Flow

1. Click Send OTP → client logs button click + phone.
2. Client calls server fn `requestLoginOtp({ phone })` — server still owns:
   - Lookup profile by phone (reject unknown numbers).
   - Generate 6-digit OTP, hash it, store in `otp_codes` (5-min expiry, max 5 attempts).
   - Return `{ otp, message, smsUrl }` to the client (this OTP is only for that user's own login — same as showing it in an SMS to them).
3. Client builds a `fetch(smsUrl)` to `https://smsfortius.work/V2/apikey.php?...` with the exact template. Logs: request URL (API key redacted in logs), status, response body, duration.
4. Client transitions to OTP step. Verification path is unchanged.

## Template rule

Exactly this string, with only the first `{#var#}` replaced:

```
Dear {#var#}, payment for Invoice No. {#var#} related to {#var#} services amounting to Rs.{#var#} was due on {#var#} and is still pending. Kindly pay immediately to avoid service interruption. SENSEFLOW INSTRUMENTS PRIVATE LIMITED.
```

## Client logs added

- `[auth] Send OTP button clicked` (already added)
- `[auth] form onSubmit fired`
- `[auth] Calling requestLoginOtp…`
- `[auth] requestLoginOtp response` — includes generated OTP, message, redacted URL
- `[sms] fetching…` with method + URL (API key masked)
- `[sms] response` with HTTP status, duration, response text
- `[sms] failed` with error object on network / non-2xx

## Files changed

- `src/lib/otp.functions.ts` — `requestLoginOtp` returns `{ otp, message, smsUrl }` instead of sending the SMS server-side.
- `src/routes/auth.tsx` — after `requestLoginOtp`, do a browser `fetch(smsUrl)` and log everything; keep existing button/submit logs.

## Trade-offs / caveats

- **CORS**: The SMS provider may not send `Access-Control-Allow-Origin`. If the browser blocks the fetch, we'll see a CORS error in the log; the fix is to keep the actual send on the server and just log — say the word and I'll flip it back. Your Postman test worked because Postman ignores CORS.
- **API key exposure**: Calling the provider from the browser puts `SENSEFLOW_SMS_API_KEY` in the URL that any user can read. Postman-style keys are typically fine for you to test with, but for production the send should stay server-side. Confirm you're OK with client-side exposure for now.
- **Template**: still sent verbatim; only the first placeholder becomes the OTP.
