## Problem

You clicked "Send OTP" but no `[auth]` logs appear in the browser console and no network request is made. The console snapshot also shows you're on `/` (the landing page), not `/auth`.

Two possible causes:
1. You're clicking the landing page's "Sign in" / "Get started" button (which just links to `/auth`) and never actually reaching the OTP form.
2. You are on `/auth` but the form's `onSubmit` isn't firing (e.g. HTML5 `required` validation blocking, or the handler binding is off).

## Diagnostic changes (temporary, one round)

Add loud, unmissable logs at every relevant point in `src/routes/auth.tsx` so the next click tells us exactly where the flow stops:

- Log once on component mount: `[auth] AuthPage mounted`.
- Add `onClick` on the Send OTP `<Button>` that logs `[auth] Send OTP button clicked` BEFORE the form submit runs — this fires even if `onSubmit` never does.
- Log inside `onSubmit` at the very first line, before `preventDefault`, so we know the form actually submitted.
- Wrap the `requestLoginOtp` call so we log the request URL/args and the raw response/error.

## What we'll learn

- If only "mounted" appears and no click log → you're not on `/auth`; you're clicking the landing CTA. Fix: navigate to `/auth` first.
- If "button clicked" logs but "onSubmit" does not → HTML validation is blocking (empty/invalid `<input required>`). Fix: fill the field or relax validation.
- If "onSubmit" logs but "Calling requestLoginOtp" does not → phone regex rejected the input (silent because the toast may be hidden). We'll see the normalized value in the log.
- If "Calling requestLoginOtp" logs but no network request → server-function transport issue; we investigate `src/start.ts` middleware next.

No business logic changes. After we identify the cause, we remove the extra logs.
