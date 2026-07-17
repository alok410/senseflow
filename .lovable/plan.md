
## Goal

Rebuild SensorFlow inside this Lovable project (TanStack Start + shadcn/ui) with Lovable Cloud as the backend. Full 1:1 feature parity with the MERN original: three roles (admin, secretary, consumer), locations, meters, meter readings, water rates, invoices, payments, prepaid balances, analytics, and **live flowmeter data from the external Senseflow API**. Login via **mobile number + OTP**. Seed sample rows.

## Status so far

- Lovable Cloud enabled.
- Full database schema shipped: `app_role` enum, `profiles`, `user_roles`, `locations`, `consumer_details`, `secretary_locations`, `water_rates`, `meter_readings`, `invoices`, `payments`, `prepaid_balances`. RLS + policies + grants on every table. `has_role()` security-definer function drives access. `handle_new_user()` trigger auto-creates a profile and a `consumer` role on signup. Seeded 2 locations and a default water rate.

## External APIs — migrated

MERN app calls the **Samasth Senseflow API** (`apps.samasth.io:8090`) directly from the browser with a hardcoded bearer token. Migration:
- Move token to a Cloud secret `SENSEFLOW_API_TOKEN` (I'll ask for it via the secure secret form).
- Two server functions in `src/lib/senseflow.functions.ts` proxy the calls:
  - `getLatestFlowmeterStatus({ deviceId })`
  - `getMeterReadingsFromSenseflow({ deviceId, consumerId, startDate, endDate })`
- Both guarded by `requireSupabaseAuth` + role check. No third-party host or token ever reaches the browser.

## Auth (phone / OTP)

- Supabase phone auth (SMS OTP). Requires an SMS provider — I'll ask you to connect **Twilio** and enable "Phone" in Cloud → Users → Auth Settings when we hit that step.
- `/auth` page: phone → OTP → verify → session established → route to `/dashboard`.
- Signup default role: `consumer` (via trigger). Admin/secretary users are created by admins from Admin → Users using a server function with the service role.
- I'll ask for your phone (E.164, e.g. `+15551234567`) after your first OTP sign-in and promote you to `admin` via a one-time seed server function.

## Frontend (TanStack Start)

Convert React Router pages to file-based routes under `src/routes/`. Keep shadcn UI + Tailwind. Replace `frontend/src/services/*.ts` axios calls with Supabase client calls (RLS) or server-function calls.

### Route tree

```text
src/routes/
  __root.tsx                     (update metadata to SensorFlow; auth state listener)
  index.tsx                      (landing → session-aware redirect to /dashboard)
  auth.tsx                       (phone + OTP)
  _authenticated/
    route.tsx                    (integration-managed gate)
    dashboard.tsx                (role-based redirect)
    admin/{index,users,secretaries,locations,rates,invoices,analytics}.tsx
    secretary/{index,users}.tsx
    consumer/index.tsx
```

### Shared UI
- Port `DashboardLayout`, `NavLink`, `StatsCard` from the source repo.
- Reuse shadcn `components/ui/*` already in the template.
- Replace `AuthContext` + `ProtectedRoute` with a Supabase session hook + `_authenticated` gate.

### Data fetching
- Loader `ensureQueryData` + component `useSuspenseQuery` (default read shape).
- Mutations via `useMutation` calling Supabase client (RLS) or server functions.
- Single `onAuthStateChange` listener in `__root.tsx`.

## Migration mapping

```text
backend/models/User.js              → auth.users + profiles + user_roles
backend/models/Location.js          → locations
backend/models/MeterReading.js      → meter_readings
backend/models/WaterRate.js         → water_rates
backend/controllers/*               → server fns / direct Supabase (RLS)
backend/middleware/auth+role        → requireSupabaseAuth + has_role() policies
backend/utils/generateToken.js      → not needed (Supabase issues JWTs)
frontend/src/services/senseflow.ts  → src/lib/senseflow.functions.ts (server-side, secret token)
frontend/src/services/*             → src/lib/*.ts + *.functions.ts
frontend/src/pages/*                → src/routes/_authenticated/*/*.tsx
frontend/src/contexts/AuthContext   → src/hooks/use-session.ts (Supabase-based)
frontend/src/components/ProtectedRoute → _authenticated/route.tsx
```

## Remaining build steps (in order)

1. Root metadata + auth state listener + sonner toaster.
2. `/auth` page (phone + OTP) and `/` landing.
3. `_authenticated/route.tsx` gate + `/dashboard` role router.
4. `DashboardLayout`, `NavLink`, `StatsCard`, session/role hook.
5. Admin pages: Dashboard, Users, Secretaries, Locations, Rates, Invoices, Analytics.
6. Secretary pages: Dashboard, Users.
7. Consumer page: Dashboard.
8. Ask you to connect Twilio (SMS) and paste `SENSEFLOW_API_TOKEN`; add Senseflow server functions.
9. Ask for your phone; promote to admin.
10. Verify build + smoke-test.

## Technical notes

- Twilio is required for SMS OTP. Alternatives are Vonage/MessageBird (same Supabase setting). If you'd rather skip SMS, we can fall back to email+password / Google.
- `supabaseAdmin` (service role) only inside server-fn handlers guarded by `has_role('admin')`, imported dynamically.
- Existing `src/routes/index.tsx` placeholder is replaced by the SensorFlow landing/redirect page.
- MERN backend folder is not copied file-for-file — its logic moved into Postgres (RLS + triggers) and TanStack server functions.
