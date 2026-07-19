## Goal
Senseflow API calls should be made with the consumer's `device_id` (the `USFL_WMxxxx` value) as the `device` query parameter. Today the seed put those IDs into `meter_id`, and the fetcher fell back to `device_id` only if `meter_id` was empty. Also show which Senseflow IDs the app is actually using.

## Changes

1. **`src/lib/meter.functions.ts`** — use `device_id` only.
   - Select `device_id, serial_number` from `consumer_details`.
   - Send `?device=${device_id}` to Senseflow.
   - Error message: "This consumer has no Senseflow device_id (USFL_WMxxxx) configured."
   - Store the same `device_id` value in `meter_readings.meter_id` (that column is just a label on the reading row).

2. **Data backfill (migration)** — move existing USFL values into `device_id`.
   ```sql
   UPDATE public.consumer_details
   SET device_id = meter_id
   WHERE device_id IS NULL AND meter_id ILIKE 'USFL\_%';
   ```
   (Leave `meter_id` populated too so old UI columns keep rendering; nothing depends on it being empty.)

3. **`src/lib/consumers.functions.ts` — `seedDemoConsumers`**
   - Insert the `USFL_WMxxxx` value into `device_id` (currently goes into `meter_id`). Keep `serial_number` and `block_id` as-is.

4. **New server function `listSenseflowDevices`** in `src/lib/meter.functions.ts`
   - Returns `[{ consumerId, name, block, deviceId, serialNumber }]` for every consumer with a non-null `device_id`, ordered by block.

5. **Admin UI — new page `src/routes/_authenticated/admin/devices.tsx`**
   - Simple table: Block · Name · Senseflow device_id · Serial · "Fetch now" button (calls `fetchAndStoreLatestReading`).
   - Add nav entry "Senseflow Devices" for admin in `src/lib/nav.ts`.

6. **BUGLOG** — append `v1.0.6` entry describing the switch to `device_id` + backfill.

## Out of scope
- No auth changes.
- No change to how readings are stored/aggregated beyond the identifier field.
