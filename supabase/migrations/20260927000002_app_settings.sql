-- =========================================
-- APP_SETTINGS — admin-controlled key/value store
-- Used for runtime configuration (e.g., Razorpay keys)
-- =========================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write settings
CREATE POLICY "settings_admin_all" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default Razorpay setting keys (empty values — admin must fill in)
INSERT INTO public.app_settings (key, value, description, is_secret) VALUES
  ('razorpay_key_id',     '', 'Razorpay Key ID (starts with rzp_test_ or rzp_live_)', false),
  ('razorpay_key_secret', '', 'Razorpay Key Secret — keep this confidential', true),
  ('razorpay_enabled',    'false', 'Enable Razorpay online payments', false)
ON CONFLICT (key) DO NOTHING;
