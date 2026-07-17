ALTER TABLE public.otp_codes ADD COLUMN IF NOT EXISTS role public.app_role NOT NULL DEFAULT 'consumer';
ALTER TABLE public.otp_codes ALTER COLUMN role DROP DEFAULT;

-- Grant admin phone all three roles
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, r.role
FROM public.profiles p
CROSS JOIN (VALUES ('admin'::public.app_role), ('secretary'::public.app_role), ('consumer'::public.app_role)) AS r(role)
WHERE p.phone = '+918780488532'
ON CONFLICT (user_id, role) DO NOTHING;
