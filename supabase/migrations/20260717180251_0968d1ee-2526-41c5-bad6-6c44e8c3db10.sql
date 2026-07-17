
ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS flow_rate numeric,
  ADD COLUMN IF NOT EXISTS rssi integer,
  ADD COLUMN IF NOT EXISTS last_active timestamptz,
  ADD COLUMN IF NOT EXISTS serial_number text;

CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_consumer_date_uidx
  ON public.meter_readings (consumer_id, reading_date);
