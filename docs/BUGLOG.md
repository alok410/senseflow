# Bug Log

## [v1.0.1] – 2026-07-17 (18:54)

### Fixed
- Bug: OTP not received but UI reported "OTP sent" successfully.
  - Cause: SMS provider returns HTTP 200 with `{"status":"false","description":"..."}` on failures (e.g. "You have insufficient credit!"). The server only checked `res.ok` and ignored the JSON body.
  - Fix: Parse the provider response body; if `status` is not `"Success"`, throw the provider's `description` so the real error surfaces in the UI. (Underlying cause of no delivery is that the Senseflow SMS account is out of credit — needs top-up on the vendor side.)
  - Files: src/lib/otp.functions.ts

## [v1.0.0] – 2026-07-17 (18:49)

### Baseline
- Project initialized. Bug log started from this point forward.