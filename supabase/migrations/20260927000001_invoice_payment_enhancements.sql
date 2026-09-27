-- =========================================
-- INVOICE & PAYMENT MANAGEMENT ENHANCEMENTS
-- =========================================

-- Add Razorpay tracking fields to payments table
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_signature TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'completed';

-- Add invoice_number for human-readable reference
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;

-- Create a sequence-based invoice number generator
CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'INV-' || TO_CHAR(now(), 'YYYY') || '-' || LPAD(nextval('invoice_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_invoice_number
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.generate_invoice_number();

-- Grant on sequence
GRANT USAGE, SELECT ON SEQUENCE public.invoice_seq TO authenticated;
GRANT ALL ON SEQUENCE public.invoice_seq TO service_role;

-- Allow consumers to insert payments (for Razorpay self-service online payment)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payments' AND policyname = 'pay_consumer_insert'
  ) THEN
    CREATE POLICY "pay_consumer_insert" ON public.payments
      FOR INSERT TO authenticated
      WITH CHECK (consumer_id = auth.uid());
  END IF;
END $$;

-- Add index for Razorpay lookups
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order ON public.payments(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;

-- Allow secretary to generate invoices
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'invoices' AND policyname = 'inv_secretary_insert'
  ) THEN
    CREATE POLICY "inv_secretary_insert" ON public.invoices
      FOR INSERT TO authenticated
      WITH CHECK (public.has_role(auth.uid(), 'secretary'));
  END IF;
END $$;
