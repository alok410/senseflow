ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'published';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS billing_month text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS previous_reading numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS current_reading numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS units_consumed numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS base_charge numeric NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS other_charges numeric NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS arrears numeric NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS flag_reason text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cancel_reason text;
UPDATE public.invoices
SET billing_month = to_char(bill_period_start, 'YYYY-MM')
WHERE billing_month IS NULL;

CREATE TABLE public.invoice_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  action text NOT NULL,
  performed_by uuid,
  old_value jsonb,
  new_value jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.invoice_audit_log TO service_role;
ALTER TABLE public.invoice_audit_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.dummy_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  consumer_id uuid NOT NULL,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'INITIATED',
  transaction_ref text NOT NULL,
  method text NOT NULL DEFAULT 'DUMMY',
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.dummy_payments TO authenticated;
GRANT ALL ON public.dummy_payments TO service_role;
ALTER TABLE public.dummy_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY dummy_payments_self_read ON public.dummy_payments
  FOR SELECT TO authenticated USING (consumer_id = auth.uid());

CREATE TABLE public.user_permissions (
  user_id uuid PRIMARY KEY,
  can_approve_invoices boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_permissions_self_read ON public.user_permissions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX invoice_audit_log_invoice_id_created_at_idx
  ON public.invoice_audit_log (invoice_id, created_at DESC);
CREATE INDEX dummy_payments_consumer_id_created_at_idx
  ON public.dummy_payments (consumer_id, created_at DESC);