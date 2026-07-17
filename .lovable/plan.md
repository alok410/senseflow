## Findings vs the Postman request

Comparing our server call to the Postman screenshot (200 OK, `{"status":"Success","code":"011","description":"Message submitted successfully","data":{"messageid":"14408","totnumber":1,"totalcredit":2}}`):

| Item | Postman | Our code | Match? |
|---|---|---|---|
| URL host + path | `https://smsfortius.work/V2/apikey.php` | same | yes |
| `apikey`, `senderid`, `templateid`, `number` | single each | single each via `set` | yes |
| `message` param | duplicated | duplicated via `append` | yes |
| Message body | literal template with `{#var#}` | literal template (OTP substitution disabled) | yes |
| **HTTP method** | **POST** | **GET** | **NO** |
| Response body surfaced to client | full JSON visible | not returned — only `smsStatus` + our template string returned | **NO** |

Two real problems:

1. We hit the URL with `GET`. Postman used `POST`. Even though the query string is identical, the provider may accept only POST for the `apikey.php` endpoint — that would explain "no SMS delivered / no credit deducted".
2. The provider's JSON response (containing `status`, `description`, `messageid`, `totalcredit`) is logged only server-side. The client-side console never sees it, so you can't tell whether it succeeded.

## Fix

### `src/lib/otp.functions.ts`
- Change `fetch(smsUrl, { method: "GET" })` → `fetch(smsUrl, { method: "POST" })`. Body stays empty; all params remain in the query string, exactly like Postman.
- After the fetch, try `JSON.parse(smsBody)`; keep the raw string as fallback.
- Return the provider's parsed response to the client:
  ```
  return { ok: true, smsStatus, smsResponse: parsedOrRaw, message };
  ```
  (Still no `apikey` and no OTP in the return value.)
- Keep existing `[sms:server]` logs.

### `src/routes/auth.tsx`
- Extend the existing `[auth] requestLoginOtp response` log to include `smsResponse` so the browser console shows the full `{status, code, description, data:{messageid, totnumber, totalcredit}}` payload.
- No UI changes.

## Verification

After the change, on clicking **Send OTP** the browser console should show:
```
[auth] requestLoginOtp response {
  phone: '+91…',
  durationMs: …,
  smsStatus: 200,
  smsResponse: { status: 'Success', code: '011', description: 'Message submitted successfully',
                 data: { messageid: '…', totnumber: 1, totalcredit: 2 } },
  message: 'Dear {#var#}, payment for Invoice No. …'
}
```
and the SMS should actually be delivered (matching your Postman run). Server logs (`[sms:server] response`) will show the same body for cross-check.

## Not changed

OTP generation/storage/verify flow, template text, secrets handling, auth UI. Only the outbound HTTP method and the shape of the value returned to the client change.
