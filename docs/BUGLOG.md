# Bug Log

## [v1.0.4] – 2026-07-19 (12:40)

### Fixed
- Bug: Created location (and other rows) not appearing in admin tables — API returned empty arrays.
  - Cause: After auth was disabled in v1.0.2, the frontend queries Supabase as the `anon` role, but RLS policies on app tables only allowed `authenticated`. Server-side writes via `supabaseAdmin` succeed, but client-side reads returned `[]`.
  - Fix: Added `SELECT` grants and permissive `anon` read policies on locations, profiles, user_roles, consumer_details, meter_readings, invoices, payments, water_rates, prepaid_balances, secretary_locations so lists render while auth is off.
  - Files: supabase migration

## [v1.0.3] – 2026-07-19 (12:20)

### Fixed
- Bug: Admin actions (create location, create/update/delete users, seed demo, set water rate, mark invoice paid, fetch meter reading, add cash balance) all failed with "Unauthorized: No authorization header provided".
  - Cause: After removing the login flow in v1.0.2, every server function still had `.middleware([requireSupabaseAuth])` and called `context.userId` / `assertAdmin(context)`, which rejects any request without a Supabase bearer token.
  - Fix: Stripped `requireSupabaseAuth` middleware and admin/role checks from all `src/lib/*.functions.ts` handlers, and swapped `recorded_by` / `updated_by: context.userId` for `null` (columns are nullable). Auth middleware/attacher files are left in place so auth can be re-enabled by putting the middleware back later.
  - Files: src/lib/locations.functions.ts, src/lib/consumers.functions.ts, src/lib/secretaries.functions.ts, src/lib/admin.functions.ts, src/lib/meter.functions.ts, src/lib/prepaid.functions.ts, src/lib/rates.functions.ts, src/lib/invoices.functions.ts

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