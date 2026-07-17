## Senseflow API parameter — current state

The Senseflow integration already uses `device_id` as the query parameter, which matches what you confirmed is needed. No code changes required.

### How it works today (src/lib/meter.functions.ts)

- Endpoint: `https://apps.samasth.io:8090/api/Senseflow/Flowmeter/latest`
- Auth: `Authorization: Bearer ${SENSEFLOW_API_TOKEN}` (stored as a Lovable Cloud secret)
- Query: `?device=<consumer_details.device_id>` (falls back to `meter_id` only if `device_id` is empty)
- Called from the "Fetch latest reading" action on:
  - Admin → Consumers
  - Secretary → Dashboard / Consumers
  - Consumer dashboard refresh button

### Data written to `meter_readings`

Parsed from the API response: `meter_reading`, `flow_rate`, `rssi`, `reading_datetime` (converted to IST), `last_active`, `serial_number`. Previous reading is looked up to compute `consumption`. Duplicate `(consumer_id, reading_date)` rows are skipped.

### Nothing to change

If the integration is misbehaving in practice (wrong param name, different auth header, different response shape, or a consumer whose `device_id` isn't set), tell me what you're seeing — the console/network log from a failed fetch is enough — and I'll adjust. Otherwise no plan step is needed.
