# Bug Log

## [v1.0.19] – 2026-08-22 (18:30)

### Fixed
- Bug: "Total usage" undercounted badly after a hardware meter reset.
  - Cause: `totalUsageL` (consumer) and `totalUsageKl` (admin main meter) read the live `/latest` `meter_reading`, which drops back to ~0 when a meter is reset/replaced. Verified on device USFL_WM0002: the meter reached 162.659 kL, reset to 0 on 2026-08-11, and `/latest` then reported only 7.843 kL, so lifetime showed 7,843 L instead of ~170,502 L.
  - Fix: Added `cumulativeMeterKl(history, latest)` which adds each pre-reset peak (the reading just before a reset in the fetched history) back to the current reading. Rewired consumer + admin dashboards to use it. (Limitation: only resets inside the fetched history window are recoverable.)
  - Files: src/lib/meter.functions.ts, src/routes/_authenticated/consumer/index.tsx

- Bug: Consumption totals silently dropped water when the daily feed was missing days.
  - Cause: Totals summed `consumptionKl` per day, but when the daily `/history` feed skips days the next day's `opening_reading` jumps above the previous `closing_reading`; that between-day usage was never counted (e.g. 0.676 kL lost across the 2026-07-26→29 gap on USFL_WM0002).
  - Fix: Added `dailyConsumptionSeries(days)` (sorts, is reset-safe, and folds positive inter-day gaps into the day after) and `sumDailyConsumption(days)`. All dashboard totals, trends, per-consumer usage and the leaderboard now derive from this one series, so trend sums always equal the reported total.
  - Files: src/lib/meter.functions.ts

- Note: The negative-consumption clamp in `consumptionKl` is CORRECT and must stay.
  - Earlier BUGLOG v1.0.12 said the clamp was removed "to match the reference dashboard." Real data disproves that: the 2026-08-11 reset day reports `consumption: -162.659`, and without the clamp the whole-range total collapses from 169,108 L to 6,449 L. The clamp (and the unit tests that enforce it) are the correct behaviour; v1.0.12's note was stale.

- Bug: Consumer "Estimated bill" applied a full month's free tier to any selected date range.
  - Cause: The range analysis card subtracted the whole monthly `free_tier_liters` regardless of range length, so the estimate swung with the date filter.
  - Fix: Pro-rate the free tier by the selected range length (`rangeDays / daysInMonth`) and relabel the card as a range estimate; also fixed the per-day row highlight to compare against a per-day threshold (`free_tier / 30`) instead of the monthly allowance.
  - Files: src/routes/_authenticated/consumer/index.tsx

### Hardened
- Admin leaderboard now looks each consumer's detail up BY device_id instead of by array index, so it can't desync from the analytics-device list.
- `computeRawReadingsConsumption` (the raw `/history/all` path) is documented as an optional higher-precision helper; the daily path is now reset-/gap-aware, so it isn't required, but the function and its tests are kept.

### Known / not changed
- The authoritative invoice amount calculation (free_consumption, chargeable_consumption, amount, total_amount) is not in the app code — it lives outside these files (DB function / reference system) and was not verifiable here.

## [v1.0.18] – 2026-07-19 (17:00)

### Fixed
- Bug: Auth, landing and role dashboards used a flat static gradient with no shared visual identity.
  - Cause: No animated background component; each shell relied on a plain `bg-gradient-to-br` wash.
  - Fix: Added a WebGL `GradientWave` component and mounted it (with a translucent overlay + glass surfaces) behind the auth page, landing role picker, and the shared dashboard shell so admin/secretary/consumer all inherit the theme. No backend, API, or data-fetch logic touched.
  - Files: src/components/ui/gradient-wave.tsx, src/routes/index.tsx, src/routes/auth.tsx, src/components/DashboardLayout.tsx

## [v1.0.17] – 2026-07-19 (16:45)

### Fixed
- Bug: Secretary dashboard totals/trend/top users didn't match the reference system (all showed empty or 0).
  - Cause: Dashboard read consumption from the local `meter_readings` table (empty), like the old consumer/admin path did before the live-API migration.
  - Fix: Added `getSecretaryDashboardStats` server function that resolves the secretary's assigned location, canonicalizes its consumers, and aggregates live Senseflow history per device (per-consumer totals, daily trend, total usage) for the selected date range and optional user filter. Rewired the secretary dashboard to consume it and drive Total usage, Avg per user, trend chart, Top 5, and per-row usage from the live data.
  - Files: src/lib/meter.functions.ts, src/routes/_authenticated/secretary/index.tsx

## [v1.0.16] – 2026-07-19 (16:35)

### Fixed
- Bug: Secretary dashboard had no bound identity while auth is disabled.
  - Cause: `useSession` fell back to the admin placeholder id for the `secretary` role, so secretary-scoped queries returned nothing.
  - Fix: Added `TEST_SECRETARY_ID` for Demo Secretary and returned that stub user when the active role is `secretary`.
  - Files: src/hooks/use-session.ts

## [v1.0.15] – 2026-07-19 (16:25)

### Fixed
- Bug: Refresh reading failed with `invalid input value for enum reading_source: "api"`.
  - Cause: `fetchAndStoreLatestReading` inserted `source: "api"`, but the `reading_source` enum only allows `smart_meter` and `manual`.
  - Fix: Insert `source: "smart_meter"` for API-sourced readings.
  - Files: src/lib/meter.functions.ts

## [v1.0.14] – 2026-07-19 (16:15)

### Fixed
- Bug: Consumer dashboard values for USFL_WM0013 didn't match the reference system.
  - Cause: The consumer dashboard read from the local `meter_readings` table (empty), instead of the live Senseflow API used by the reference dashboard.
  - Fix: Added `getConsumerDashboardStats` server function that fetches Senseflow history + latest for the consumer's `device_id` and returns today/month/total/range aggregates, trend and history (kL → L). Rewired the consumer dashboard to use it and render Closing/Opening/Consumption from the API.
  - Files: src/lib/meter.functions.ts, src/routes/_authenticated/consumer/index.tsx

## [v1.0.13] – 2026-07-19 (15:55)

### Fixed
- Bug: Consumer dashboard was empty because auth is disabled and no `user.id` was bound.
  - Cause: `useSession` returned `null` user when no Supabase session exists, so all `consumer_details`/`meter_readings` queries filtered by `user_id` returned nothing.
  - Fix: For testing, when the active role is `consumer`, bind `useSession` to DHARTI (Block 3, `USFL_WM0013`, user_id `846b96ef-8525-413f-a8ac-720b93569214`). Admin/secretary use a placeholder id (those pages don't rely on user.id).
  - Files: src/hooks/use-session.ts

## [v1.0.12] – 2026-07-19 (15:40)

### Fixed
- Bug: Admin dashboard totals and trend didn't match the reference system for the last 7 days.
  - Cause: `consumptionKl` clamped negative daily consumption to 0, but the reference dashboard uses raw `closing - opening` values (which can go negative on meter resets), so totals and the trend line diverged.
  - Fix: Removed the `Math.max(0, ...)` clamp so daily consumption is passed through as-is, matching the reference dashboard.
  - Files: src/lib/meter.functions.ts

## [v1.0.11] – 2026-07-19 (15:25)

### Fixed
- Bug: Admin dashboard values dropped back to 0 / “No consumption in range.”
  - Cause: The dashboard was reading the empty local `meter_readings` table for consumption, while the real readings are available from the live Senseflow API.
  - Fix: Reconnected the Admin dashboard to the live dashboard stats server function, widened the live main-meter deadline to match the slow endpoint, gave each sub-meter history request its own 12s timeout, removed the all-or-nothing sub-meter batch deadline so slow devices cannot discard valid device responses as zero, fetched the main month total in parallel, removed extra sub-meter latest calls, and clamped reset/negative consumption readings to zero in dashboard totals.
  - Files: src/routes/_authenticated/admin/index.tsx, src/lib/meter.functions.ts

## [v1.0.10] – 2026-07-19 (15:05)

### Fixed
- Bug: Demo "Test" consumer appeared twice in lists and clashed with GIRIRAJ TEJRA's device.
  - Cause: The demo seed list contained a "Test" entry sharing device `USFL_WM0010` already assigned to GIRIRAJ TEJRA.
  - Fix: Removed the "Test" seed row and deleted the existing Test profile, consumer_details, and role rows from the database.
  - Files: src/lib/consumers.functions.ts

## [v1.0.9] – 2026-07-19 (14:45)

### Fixed
- Bug: Admin dashboard filters and overview stayed stuck on placeholders/loading instead of showing consumer and secretary counts.
  - Cause: The dashboard depended on the live Senseflow server function for the whole render path, so when the external API was slow or unavailable the page never reached its fallback state.
  - Fix: Moved the blocking dashboard counts, filters, and local reading aggregation back to direct client database reads, while keeping the UI responsive even when live Senseflow data is unavailable.
  - Files: src/routes/_authenticated/admin/index.tsx

## [v1.0.8] – 2026-07-19 (14:20)

### Fixed
- Bug: Admin dashboard showed 0 for everything because it only aggregated the local `meter_readings` table, which is empty (readings come from the external Senseflow API, not local storage).
  - Cause: The dashboard queried Supabase-only stats and never called the Senseflow REST API, so Main Meter totals, monthly usage, flow rate, and daily trends were all blank.
  - Fix: Added `getAdminDashboardStats` server function that calls Senseflow `/latest` and `/history` endpoints for the Main Meter (USFL_FL7053) and every configured sub-meter in parallel, aggregating Today/This Month/Total Usage plus daily consumption trend, flow rate, and top-consumer leaderboard. Rewrote `admin/index.tsx` to render a "Main Meter Overview" card and a "Water Analytics Overview" section that mirror the reference app (26 consumers, 1 secretary, live flow rate, litres totals) instead of reading zeros from Postgres.
  - Files: src/lib/meter.functions.ts, src/routes/_authenticated/admin/index.tsx

## [v1.0.7] – 2026-07-19 (13:55)

### Fixed
- Bug: Consumers table showed a combined "Meter / Device" column and the seed was missing the MainMeter (block 00, USFL_FL7053) entry; "No Consumer 2" had no block.
  - Cause: Legacy UI still surfaced `meter_id` alongside `device_id`, and the demo seed list didn't include MainMeter.
  - Fix: Removed the Meter ID column and form field from Admin → Consumers (kept Device ID + Serial number as separate columns/inputs). Added MainMeter (USFL_FL7053) to the demo seed and updated "No Consumer 2" block to "Na" to match the reference data. Hit "Seed demo" to insert MainMeter.
  - Files: src/routes/_authenticated/admin/consumers.tsx, src/lib/consumers.functions.ts, supabase data update

## [v1.0.6] – 2026-07-19 (13:40)

### Fixed
- Bug: Senseflow API was called with the wrong identifier — the seed put the USFL_WMxxxx value in `meter_id`, and the fetcher only fell back to `device_id`, so the semantics were inverted.
  - Cause: The Senseflow endpoint expects the `device_id` (e.g. `USFL_WM0003`) as its `device` query parameter, but consumers were seeded with that value in `meter_id`.
  - Fix: Backfilled `consumer_details.device_id` from `meter_id` for existing rows, updated `seedDemoConsumers` to write the USFL id into `device_id` too, and changed `fetchAndStoreLatestReading` to use `device_id` only. Added `listSenseflowDevices` server function and a new Admin → "Senseflow Devices" page that lists every configured device_id with a "Fetch now" action.
  - Files: src/lib/meter.functions.ts, src/lib/consumers.functions.ts, src/lib/nav.ts, src/routes/_authenticated/admin/devices.tsx, supabase data backfill

## [v1.0.5] – 2026-07-19 (13:10)

### Fixed
- Bug: Consumer and user lists did not show after auth was disabled.
  - Cause: Several pages used embedded backend relationships such as `profiles(user_roles)` / `profiles(consumer_details)` even though those tables are connected through auth users, not direct public-table foreign keys, so the Data API returned relationship errors or empty views.
  - Fix: Reworked admin user, consumer, secretary, consumer analysis, and secretary consumer reads to load related rows separately and merge them in the UI; secretary pages also fall back to showing consumers while auth is temporarily off.
  - Files: src/routes/_authenticated/admin/users.tsx, src/routes/_authenticated/admin/consumers.tsx, src/routes/_authenticated/admin/secretaries.tsx, src/routes/_authenticated/admin/consumers.$id.tsx, src/routes/_authenticated/secretary/users.tsx, src/routes/_authenticated/secretary/index.tsx

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