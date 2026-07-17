## Problem

The SMS provider (`smsfortius.work`) does not send `Access-Control-Allow-Origin`, so the browser blocks the request:

```
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

The provider actually returns HTTP 200 (the SMS is likely sent), but the browser refuses to expose the response to JS. Postman worked because Postman ignores CORS. You cannot fix this from the client — the provider must add the header, which we don't control.

## Fix

Move the SMS `fetch` back to the **server function**. The server has no CORS restrictions and can call the provider directly. Keep the client-side logs and add matching server-side logs so you still see the full flow.

## Changes

### `src/lib/otp.functions.ts`
- `requestLoginOtp` performs the `fetch(smsUrl)` server-side again.
- Add `console.log("[sms:server] fetching…", { url: redactedUrl })`, `[sms:server] response { status, body }`, `[sms:server] failed { error }` — visible in server-function logs.
- Return `{ ok: true, smsStatus, otpMasked }` to the client (never return the full OTP or the API key). `otpMasked` is e.g. `******` — client just logs that a code was issued.

### `src/routes/auth.tsx`
- Remove the browser `fetch(smsUrl)` block.
- Keep the button-click / submit / `requestLoginOtp` request/response logs.
- Log the server's returned `smsStatus` so the console still shows the outcome of the API hit.

## Result

- No CORS error.
- SMS is actually delivered (as before your Postman test).
- Console still shows every step: button click → submit → server call → server-reported SMS status.
- API key stays server-side (no longer exposed to any visitor of the site).

## Alternative you can ask for later

If you truly want the browser to hit `smsfortius.work` directly, we'd need a same-origin proxy route (`/api/public/sms-proxy`) that forwards the request. That still runs the fetch on the server; it just makes it look client-initiated. Same effect as this plan, more moving parts — say the word if you want it.
