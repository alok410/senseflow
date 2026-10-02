CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text,
  description text,
  is_secret boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_order_id text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_payment_id text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_signature text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'completed';