## Goal

Allow one phone number (one user account) to hold multiple roles (admin / secretary / consumer). At login the user picks which role to sign in as; after OTP verification they land on that role's dashboard. Admin can grant or revoke roles per user.

## Auth flow changes (`src/routes/auth.tsx` + `src/lib/otp.functions.ts`)

Login becomes a 3-field flow on one screen (still 2 steps):

1. Step "phone": Mobile number + **Role** dropdown (Admin / Secretary / Consumer) → Send OTP.
   - Client passes `{ phone, role }` to `requestLoginOtp`.
   - Server checks the user exists for that phone AND has that role in `user_roles`. If not → reject with a clear error ("No <role> account for this number") and do NOT send SMS or store an OTP. This prevents SMS spend on invalid combos.
   - If valid, generate OTP, store in `otp_codes` with the chosen role, send SMS.
2. Step "otp": Enter 6-digit code → `verifyLoginOtp({ phone, code, role })`.
   - Server verifies code + role match, mints magiclink `token_hash`, client redeems session.
   - After sign-in, store the chosen role in `sessionStorage` (`sf_active_role`) so the dashboard router honors it instead of defaulting to highest-priority role.

## Active-role handling

- `src/hooks/use-session.ts`: add `useActiveRole()` that reads `sf_active_role` from `sessionStorage` (falls back to highest-priority role from `useMyRole`). Clear on sign-out.
- `src/routes/_authenticated/dashboard.tsx`: redirect based on active role instead of highest.
- Add a small "Switch role" control in `DashboardLayout` header (visible only if the user has >1 role) that updates `sf_active_role` and navigates to the corresponding dashboard — no re-login needed once signed in.

## Admin: manage roles per user (`src/routes/_authenticated/admin/users.tsx`)

- Table row shows all roles as chips (not just the first): `{u.user_roles.map(r => <Badge>{r.role}</Badge>)}`.
- Add per-row "Manage roles" action → dialog with 3 checkboxes (admin/secretary/consumer). Save calls a new server fn `setUserRoles({ userId, roles[] })`.
- "Add user" dialog: replace single Role select with multi-select checkboxes (at least one required). `createUser` server fn accepts `roles: AppRole[]` and inserts all of them into `user_roles` (dedup on unique constraint).

## Server functions (`src/lib/admin.functions.ts`)

- Update `createUser` input schema: `roles: z.array(roleSchema).min(1)`. After creating auth user, delete default `consumer` row inserted by trigger and insert all requested roles.
- Add `setUserRoles` (admin-only, same middleware + `has_role` check): delete existing rows for `user_id`, insert the new set. Refuse to leave the caller himself without `admin` (prevent self-lockout).

## OTP server (`src/lib/otp.functions.ts`)

- `requestLoginOtp` input: `{ phone, role }`. Before generating OTP:
  - Look up `profiles.id` by phone. If not found → throw "No account for this number".
  - Check `user_roles` for `(user_id, role)`. If missing → throw "This number has no <role> access".
- Store `role` on the `otp_codes` row (add column below).
- `verifyLoginOtp` input: `{ phone, code, role }`. Enforce the stored row matches phone + role + not consumed + not expired.

## Database migration

- Add `role app_role NOT NULL` column to `otp_codes` (default `'consumer'` then drop default) so each OTP is bound to the requested role.
- No other schema change; `user_roles` already supports multiple rows per user (unique on `(user_id, role)`).

## Seeded data

- Grant `+918780488532` all three roles (admin + secretary + consumer) so you can test role-switching immediately.
- Leave `+917984202894` as consumer only.

## Out of scope

- No change to invoice/reading/rate logic.
- No change to SMS provider or OTP template.
- No change to the `_authenticated` gate.

## Technical notes

- `sessionStorage` (not `localStorage`) so closing the tab resets active role; safe for SSR because it's read in `useEffect`/handlers only.
- `setUserRoles` uses `supabaseAdmin` after verifying caller is admin via `context.supabase.rpc('has_role', ...)`.
- Migration order per project rules: alter table only (no new table, so no GRANT block needed beyond existing).
