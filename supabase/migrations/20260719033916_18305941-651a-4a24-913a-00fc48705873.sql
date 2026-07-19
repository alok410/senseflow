
-- Grant SELECT to anon on app tables (auth is disabled in the app for now)
GRANT SELECT ON public.locations, public.profiles, public.user_roles, public.consumer_details, public.meter_readings, public.invoices, public.payments, public.water_rates, public.prepaid_balances, public.secretary_locations TO anon;

-- Add anon read policies
CREATE POLICY "anon_read_locations" ON public.locations FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_profiles" ON public.profiles FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_user_roles" ON public.user_roles FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_consumer_details" ON public.consumer_details FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_meter_readings" ON public.meter_readings FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_invoices" ON public.invoices FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_payments" ON public.payments FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_water_rates" ON public.water_rates FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_prepaid_balances" ON public.prepaid_balances FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_secretary_locations" ON public.secretary_locations FOR SELECT TO anon USING (true);
