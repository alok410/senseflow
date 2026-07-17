
-- =========================================
-- ENUMS
-- =========================================
CREATE TYPE public.app_role AS ENUM ('admin', 'secretary', 'consumer');
CREATE TYPE public.account_type AS ENUM ('prepaid', 'postpaid');
CREATE TYPE public.invoice_status AS ENUM ('pending', 'approved', 'paid', 'overdue');
CREATE TYPE public.payment_method AS ENUM ('online', 'manual', 'prepaid_recharge');
CREATE TYPE public.reading_source AS ENUM ('smart_meter', 'manual');

-- =========================================
-- LOCATIONS
-- =========================================
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- =========================================
-- PROFILES
-- =========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =========================================
-- USER_ROLES (security-critical: separate table)
-- =========================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- =========================================
-- has_role() security-definer function
-- =========================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.app_role
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'secretary' THEN 2
    WHEN 'consumer' THEN 3
  END
  LIMIT 1
$$;

-- =========================================
-- CONSUMER_DETAILS
-- =========================================
CREATE TABLE public.consumer_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  meter_id TEXT,
  serial_number TEXT,
  device_id TEXT,
  account_type public.account_type NOT NULL DEFAULT 'postpaid',
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  assigned_secretary_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  connection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumer_details TO authenticated;
GRANT ALL ON public.consumer_details TO service_role;
ALTER TABLE public.consumer_details ENABLE ROW LEVEL SECURITY;

-- =========================================
-- SECRETARY_LOCATIONS (many-to-many)
-- =========================================
CREATE TABLE public.secretary_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secretary_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (secretary_id, location_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.secretary_locations TO authenticated;
GRANT ALL ON public.secretary_locations TO service_role;
ALTER TABLE public.secretary_locations ENABLE ROW LEVEL SECURITY;

-- =========================================
-- WATER_RATES
-- =========================================
CREATE TABLE public.water_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_per_liter NUMERIC(10, 4) NOT NULL,
  free_tier_liters NUMERIC(12, 2) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.water_rates TO authenticated;
GRANT ALL ON public.water_rates TO service_role;
ALTER TABLE public.water_rates ENABLE ROW LEVEL SECURITY;

-- =========================================
-- METER_READINGS
-- =========================================
CREATE TABLE public.meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meter_id TEXT NOT NULL,
  reading NUMERIC(14, 2) NOT NULL,
  previous_reading NUMERIC(14, 2) NOT NULL DEFAULT 0,
  consumption NUMERIC(14, 2) NOT NULL DEFAULT 0,
  reading_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  source public.reading_source NOT NULL DEFAULT 'manual',
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_meter_readings_consumer ON public.meter_readings(consumer_id, reading_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meter_readings TO authenticated;
GRANT ALL ON public.meter_readings TO service_role;
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;

-- =========================================
-- INVOICES
-- =========================================
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meter_reading_id UUID REFERENCES public.meter_readings(id) ON DELETE SET NULL,
  bill_period_start DATE NOT NULL,
  bill_period_end DATE NOT NULL,
  consumption NUMERIC(14, 2) NOT NULL DEFAULT 0,
  free_consumption NUMERIC(14, 2) NOT NULL DEFAULT 0,
  chargeable_consumption NUMERIC(14, 2) NOT NULL DEFAULT 0,
  rate_applied NUMERIC(10, 4) NOT NULL DEFAULT 0,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  late_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_consumer ON public.invoices(consumer_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- =========================================
-- PAYMENTS
-- =========================================
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  method public.payment_method NOT NULL,
  transaction_id TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_consumer ON public.payments(consumer_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- =========================================
-- PREPAID_BALANCES
-- =========================================
CREATE TABLE public.prepaid_balances (
  consumer_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  last_recharge_amount NUMERIC(12, 2),
  last_recharge_date TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prepaid_balances TO authenticated;
GRANT ALL ON public.prepaid_balances TO service_role;
ALTER TABLE public.prepaid_balances ENABLE ROW LEVEL SECURITY;

-- =========================================
-- Helper: is secretary of a consumer's location
-- =========================================
CREATE OR REPLACE FUNCTION public.secretary_manages_consumer(_secretary_id UUID, _consumer_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.consumer_details cd
    JOIN public.secretary_locations sl ON sl.location_id = cd.location_id
    WHERE cd.user_id = _consumer_id AND sl.secretary_id = _secretary_id
  )
$$;

-- =========================================
-- RLS POLICIES
-- =========================================

-- locations
CREATE POLICY "locations_read_authenticated" ON public.locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "locations_admin_write" ON public.locations FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "locations_admin_update" ON public.locations FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "locations_admin_delete" ON public.locations FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- profiles
CREATE POLICY "profiles_self_read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_admin_read" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_secretary_read" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), id));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_admin_update" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_admin_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR auth.uid() = id);

-- user_roles
CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user_roles_admin_read" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "user_roles_admin_write" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "user_roles_admin_delete" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- consumer_details
CREATE POLICY "cd_self_read" ON public.consumer_details FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cd_admin_all" ON public.consumer_details FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cd_secretary_read" ON public.consumer_details FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), user_id));
CREATE POLICY "cd_secretary_update" ON public.consumer_details FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), user_id));

-- secretary_locations
CREATE POLICY "sl_admin_all" ON public.secretary_locations FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "sl_self_read" ON public.secretary_locations FOR SELECT TO authenticated USING (secretary_id = auth.uid());

-- water_rates
CREATE POLICY "rates_read_all" ON public.water_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "rates_admin_write" ON public.water_rates FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rates_admin_update" ON public.water_rates FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rates_admin_delete" ON public.water_rates FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- meter_readings
CREATE POLICY "mr_self_read" ON public.meter_readings FOR SELECT TO authenticated USING (consumer_id = auth.uid());
CREATE POLICY "mr_admin_all" ON public.meter_readings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "mr_secretary_read" ON public.meter_readings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), consumer_id));
CREATE POLICY "mr_secretary_insert" ON public.meter_readings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), consumer_id));

-- invoices
CREATE POLICY "inv_self_read" ON public.invoices FOR SELECT TO authenticated USING (consumer_id = auth.uid());
CREATE POLICY "inv_admin_all" ON public.invoices FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "inv_secretary_read" ON public.invoices FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), consumer_id));
CREATE POLICY "inv_secretary_update" ON public.invoices FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), consumer_id));

-- payments
CREATE POLICY "pay_self_read" ON public.payments FOR SELECT TO authenticated USING (consumer_id = auth.uid());
CREATE POLICY "pay_admin_all" ON public.payments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "pay_secretary_read" ON public.payments FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), consumer_id));
CREATE POLICY "pay_secretary_insert" ON public.payments FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), consumer_id));

-- prepaid_balances
CREATE POLICY "pb_self_read" ON public.prepaid_balances FOR SELECT TO authenticated USING (consumer_id = auth.uid());
CREATE POLICY "pb_admin_all" ON public.prepaid_balances FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "pb_secretary_read" ON public.prepaid_balances FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'secretary') AND public.secretary_manages_consumer(auth.uid(), consumer_id));

-- =========================================
-- TRIGGERS
-- =========================================

-- updated_at auto
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_cd_updated BEFORE UPDATE ON public.consumer_details FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_rates_updated BEFORE UPDATE ON public.water_rates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- handle_new_user: create profile + default 'consumer' role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NEW.email,
    NEW.phone
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'consumer')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- SEED
-- =========================================
INSERT INTO public.locations (code, name) VALUES
  ('LOC-01', 'Green Meadows Society'),
  ('LOC-02', 'Sunrise Apartments');

INSERT INTO public.water_rates (rate_per_liter, free_tier_liters, effective_from)
VALUES (0.05, 5000, CURRENT_DATE);
