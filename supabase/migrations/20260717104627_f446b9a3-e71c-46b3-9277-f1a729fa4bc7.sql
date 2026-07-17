
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.secretary_manages_consumer(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
