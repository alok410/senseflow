
# Port MERN controllers to Lovable (full backend + frontend)

Bring every uploaded controller (auth, user, location, waterRate, secretary, consumer, meter) into the app as TanStack server functions + role-scoped UIs. Auth stays as the existing phone+OTP+role flow (replaces the email/password `auth.controller.js` — MongoDB behavior mapped to Supabase equivalents).

## Backend (server functions)

Create/extend these files. All admin-only fns re-check role via `has_role('admin')`; secretary fns re-check via `has_role('secretary')` + `secretary_manages_consumer`; RLS enforces the rest.

- `src/lib/locations.functions.ts` — `listLocations`, `createLocation` (unique `code`), `updateLocation`, `deleteLocation` (admin).
- `src/lib/rates.functions.ts` — `getLatestRate`, `setWaterRate` (admin; inserts new `water_rates` row w/ `effective_from`).
- `src/lib/secretaries.functions.ts` — `listSecretaries`, `createSecretary` (creates auth user, profile, `secretary` role, `secretary_locations` mappings), `updateSecretary` (name/phone/email/locations), `deleteSecretary` (deactivate profile + remove `secretary` role + clear location mappings).
- `src/lib/consumers.functions.ts` — `listConsumers` (admin: all; secretary: scoped via `secretary_locations`), `getConsumerById`, `createConsumer` (creates auth user + profile + `consumer` role + `consumer_details` w/ meter_id, serial_number, device_id, location_id), `updateConsumer`, `deactivateConsumer` (soft delete via `profiles.is_active=false`).
- `src/lib/meter.functions.ts` — `fetchAndStoreLatestReading({ consumerId })`: server-side call to `https://apps.samasth.io:8090/api/Senseflow/Flowmeter/latest?device=<device_id>` using stored `SENSEFLOW_API_TOKEN` secret; converts UTC→IST, dedupes on (consumer_id, reading_date), inserts into `meter_readings`. Also `listReadings({ consumerId })`.
- `src/lib/me.functions.ts` — `getMe` returns profile + roles + (if consumer) consumer_details, (if secretary) assigned locations.

## Schema tweaks (single migration)

- Add `SENSEFLOW_API_TOKEN` secret (via secrets tool if not present).
- Ensure `meter_readings` has a unique index on `(consumer_id, reading_date)` for dedupe.
- Add `rssi`, `flow_rate`, `last_active` columns to `meter_readings` if missing (currently `reading`, `consumption`, etc. exist — extend to match Senseflow payload).
- No changes to existing enums/RLS.

## Frontend

### Admin
- `admin/locations.tsx` — replace read-only table with full CRUD (add/edit/delete dialogs; code + name + active toggle).
- `admin/rates.tsx` — add "Set new rate" dialog (rate_per_liter, free_tier_liters, effective_from) that inserts a new row; history table stays.
- `admin/secretaries.tsx` — full list + Create/Edit/Delete dialogs incl. multi-location assignment (checkbox list of locations).
- `admin/users.tsx` (consumers section) — extend existing users page OR add `admin/consumers.tsx` with Create/Edit/Deactivate dialogs collecting: full name, phone, email, location, meter_id, serial_number, device_id. Nav gains "Consumers".
- `admin/invoices.tsx` stays as-is (no controller uploaded for it).

### Secretary
- `secretary/users.tsx` — list consumers filtered by their `secretary_locations`; "Fetch latest reading" button per consumer → calls `fetchAndStoreLatestReading`; view readings history in a drawer.
- Add `secretary/readings.tsx` — combined recent readings across assigned locations.

### Consumer
- `consumer/index.tsx` — show profile (name, phone, meter_id, location), latest reading, consumption chart, current rate, estimated bill (consumption × rate with free tier).
- Add "Refresh reading" button → `fetchAndStoreLatestReading` scoped to self.

## Mapping notes

- MongoDB `User(role=…)` → `profiles` + `user_roles` (already in place).
- `bcrypt` passwords → skipped (phone+OTP auth).
- `isActive` deactivation → `profiles.is_active=false` (already exists).
- `locationId` on user → `consumer_details.location_id` / `secretary_locations`.
- Meter external API token stays server-side; never shipped to browser.

## Out of scope (ask if needed)

- Billing/invoice generation logic (no controller provided).
- Payments controller.
- Bulk import.

## Deliverables order

1. Migration (unique index + optional columns).
2. Server-fn files.
3. Admin CRUD pages.
4. Secretary + consumer pages.
5. Nav updates in `DashboardLayout` nav arrays.
