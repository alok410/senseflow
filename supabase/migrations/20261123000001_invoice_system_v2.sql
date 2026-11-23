-- =========================================
-- INVOICE SYSTEM v2 — Full Enhancement
-- Adds: draft/published/cancelled statuses,
--       billing_month idempotency key,
--       anomaly flagging, audit log,
--       user_permissions, dummy_payments,
--       invoice_mode app settings
-- =========================================

-- ── 1. Extend invoice_status enum ──────────────────────────────
-- Add new values safely (Postgres 14+ supports IF NOT EXISTS on ALTER TYPE)
DO $$ BEGIN
  ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'draft';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'published';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'cancelled';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. New columns on invoices ─────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS billing_month     TEXT,                   -- YYYY-MM
  ADD COLUMN IF NOT EXISTS previous_reading  NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS current_reading   NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS units_consumed    NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS base_charge       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arrears           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flagged           BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason       TEXT,                   -- e.g. HIGH_USAGE, ZERO_USAGE, MISSING_READING
  ADD COLUMN IF NOT EXISTS published_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by        TEXT          NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS approved_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason     TEXT;

-- Backfill billing_month for existing rows that have bill_period_start
UPDATE public.invoices
SET billing_month = LEFT(bill_period_start::TEXT, 7)
WHERE billing_month IS NULL AND bill_period_start IS NOT NULL;

-- Unique constraint: one invoice per consumer per billing month
-- Use a partial unique index to handle NULLs gracefully
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_consumer_month
  ON public.invoices (consumer_id, billing_month)
  WHERE billing_month IS NOT NULL AND status != 'cancelled';

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_invoices_billing_month ON public.invoices (billing_month);
CREATE INDEX IF NOT EXISTS idx_invoices_status         ON public.invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_flagged        ON public.invoices (flagged) WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_invoices_due_date       ON public.invoices (due_date);

-- ── 3. invoice_audit_log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  action       TEXT        NOT NULL,  -- e.g. DRAFT_CREATED, APPROVED, CANCELLED, FIELD_EDITED, OVERDUE_FLAGGED
  performed_by UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  old_value    JSONB,
  new_value    JSONB,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_invoice ON public.invoice_audit_log (invoice_id, created_at DESC);
GRANT SELECT, INSERT ON public.invoice_audit_log TO authenticated;
GRANT ALL ON public.invoice_audit_log TO service_role;
ALTER TABLE public.invoice_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins and secretaries can read audit logs (via service role in server fns)
CREATE POLICY "audit_admin_read" ON public.invoice_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'secretary'));

CREATE POLICY "audit_service_all" ON public.invoice_audit_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 4. user_permissions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id              UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  can_approve_invoices BOOLEAN NOT NULL DEFAULT false,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Users can read their own permissions; admins can read/write all
CREATE POLICY "perm_self_read" ON public.user_permissions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "perm_admin_all" ON public.user_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── 5. dummy_payments ─────────────────────────────────────────
CREATE TYPE IF NOT EXISTS public.dummy_payment_status AS ENUM ('INITIATED', 'SUCCESS', 'FAILED');

CREATE TABLE IF NOT EXISTS public.dummy_payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  consumer_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL,
  status          public.dummy_payment_status NOT NULL DEFAULT 'INITIATED',
  transaction_ref TEXT        UNIQUE,
  method          TEXT        NOT NULL DEFAULT 'DUMMY',
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dummy_payments_invoice    ON public.dummy_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_dummy_payments_consumer   ON public.dummy_payments (consumer_id);

GRANT SELECT, INSERT, UPDATE ON public.dummy_payments TO authenticated;
GRANT ALL ON public.dummy_payments TO service_role;
ALTER TABLE public.dummy_payments ENABLE ROW LEVEL SECURITY;

-- Consumers can read their own; admins can read all
CREATE POLICY "dpay_self_read"  ON public.dummy_payments FOR SELECT TO authenticated USING (consumer_id = auth.uid());
CREATE POLICY "dpay_admin_all"  ON public.dummy_payments FOR ALL    TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Allow consumer to insert their own payment initiation
CREATE POLICY "dpay_self_insert" ON public.dummy_payments FOR INSERT TO authenticated
  WITH CHECK (consumer_id = auth.uid());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_dummy_payment_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_dummy_payment_updated
  BEFORE UPDATE ON public.dummy_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_dummy_payment_updated_at();

-- ── 6. Seed app_settings for invoice system ───────────────────
INSERT INTO public.app_settings (key, value, description, is_secret) VALUES
  ('invoice_mode',              'ADMIN_APPROVAL', 'Invoice generation mode: AUTO_PUBLISH or ADMIN_APPROVAL', false),
  ('auto_publish_delay_days',   '0',              'If > 0 and mode=ADMIN_APPROVAL, auto-publish after N days', false),
  ('invoice_late_fee',          '50',             'Late fee in rupees applied to overdue invoices', false),
  ('invoice_base_charge',       '0',              'Fixed base charge per invoice in rupees', false)
ON CONFLICT (key) DO NOTHING;

-- ── 7. Helper: check_invoice_approve_permission ───────────────
-- Returns true if user is admin OR (secretary AND has can_approve_invoices)
CREATE OR REPLACE FUNCTION public.can_approve_invoice(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR (
      public.has_role(_user_id, 'secretary')
      AND EXISTS (
        SELECT 1 FROM public.user_permissions
        WHERE user_id = _user_id AND can_approve_invoices = true
      )
    )
$$;
