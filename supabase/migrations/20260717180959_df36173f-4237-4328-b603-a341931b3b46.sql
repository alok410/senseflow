
ALTER TABLE public.consumer_details ADD COLUMN IF NOT EXISTS block_id text;
CREATE INDEX IF NOT EXISTS idx_consumer_details_block_id ON public.consumer_details(block_id);

-- Ensure single-location per secretary. If existing data has multiples, keep the earliest.
DELETE FROM public.secretary_locations sl
USING public.secretary_locations sl2
WHERE sl.secretary_id = sl2.secretary_id
  AND sl.ctid > sl2.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_secretary_locations_secretary ON public.secretary_locations(secretary_id);
