# Bug Log

## [v1.0.2] – 2026-07-19 (12:00)

### Fixed
- Bug: Auth flow (phone + OTP login) was blocking access; user requested it disabled for now.
  - Cause: `_authenticated` layout gated all dashboards behind a Supabase session, and the landing/dashboard router forced users through `/auth`.
  - Fix: Removed the `beforeLoad` session check on `/_authenticated` (kept the layout intact for future re-enable). Landing page now shows a 3-role picker that stores the choice in `sessionStorage` and jumps straight into the matching dashboard. `/dashboard` routes by the stored role or falls back to landing. `DashboardLayout` replaces "Sign out" with "Back to home" and always exposes all 3 roles in the switcher. Auth files (`/auth`, `otp.functions.ts`, `auth-middleware.ts`, `auth-attacher.ts`) are left in place so auth can be re-enabled later.
  - Files: src/routes/_authenticated/route.tsx, src/routes/index.tsx, src/routes/_authenticated/dashboard.tsx, src/components/DashboardLayout.tsx

## [v1.0.1] – 2026-07-17 (18:54)

### Fixed
- Bug: OTP not received but UI reported "OTP sent" successfully.
  - Cause: SMS provider returns HTTP 200 with `{"status":"false","description":"..."}` on failures (e.g. "You have insufficient credit!"). The server only checked `res.ok` and ignored the JSON body.
  - Fix: Parse the provider response body; if `status` is not `"Success"`, throw the provider's `description` so the real error surfaces in the UI. (Underlying cause of no delivery is that the Senseflow SMS account is out of credit — needs top-up on the vendor side.)
  - Files: src/lib/otp.functions.ts

## [v1.0.0] – 2026-07-17 (18:49)

### Baseline
- Project initialized. Bug log started from this point forward.