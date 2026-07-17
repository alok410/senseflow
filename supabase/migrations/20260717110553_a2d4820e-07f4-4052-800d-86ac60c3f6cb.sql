-- OTP codes table for custom SMS OTP flow (server-only; no client access)
CREATE TABLE public.otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX otp_codes_phone_idx ON public.otp_codes(phone);
CREATE INDEX otp_codes_expires_idx ON public.otp_codes(expires_at);

-- service_role only (server functions with admin client)
GRANT ALL ON public.otp_codes TO service_role;

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
-- No policies: authenticated/anon have no access; service_role bypasses RLS.

-- Seed users: admin + consumer + placeholder secretary.
-- Inserting into auth.users directly triggers handle_new_user() which creates profiles + user_roles.
DO $$
DECLARE
  admin_id uuid;
  consumer_id uuid;
  secretary_id uuid;
  seed_location_id uuid;
BEGIN
  -- Admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE phone = '+918780488532') THEN
    admin_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, phone,
      encrypted_password, email_confirmed_at, phone_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'admin+918780488532@sensorflow.local', '918780488532',
      '', now(), now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{"full_name":"Admin"}'::jsonb,
      now(), now(), '', '', '', ''
    );
    UPDATE public.profiles SET phone = '+918780488532', full_name = 'Admin' WHERE id = admin_id;
    UPDATE public.user_roles SET role = 'admin' WHERE user_id = admin_id;
  END IF;

  -- Consumer
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE phone = '+917984202894') THEN
    consumer_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, phone,
      encrypted_password, email_confirmed_at, phone_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      consumer_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'consumer+917984202894@sensorflow.local', '917984202894',
      '', now(), now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{"full_name":"Consumer"}'::jsonb,
      now(), now(), '', '', '', ''
    );
    UPDATE public.profiles SET phone = '+917984202894', full_name = 'Consumer' WHERE id = consumer_id;

    SELECT id INTO seed_location_id FROM public.locations ORDER BY created_at LIMIT 1;
    INSERT INTO public.consumer_details (user_id, location_id, account_type)
    VALUES (consumer_id, seed_location_id, 'postpaid')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- Placeholder secretary
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE phone = '+910000000000') THEN
    secretary_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, phone,
      encrypted_password, email_confirmed_at, phone_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      secretary_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'secretary+910000000000@sensorflow.local', '910000000000',
      '', now(), now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{"full_name":"Demo Secretary"}'::jsonb,
      now(), now(), '', '', '', ''
    );
    UPDATE public.profiles SET phone = '+910000000000', full_name = 'Demo Secretary' WHERE id = secretary_id;
    UPDATE public.user_roles SET role = 'secretary' WHERE user_id = secretary_id;
  END IF;
END $$;