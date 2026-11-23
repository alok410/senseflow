DROP POLICY IF EXISTS locations_read_authenticated ON public.locations;
CREATE POLICY locations_read_assigned_roles
ON public.locations
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'secretary'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.secretary_locations AS sl
      WHERE sl.location_id = locations.id
        AND sl.secretary_id = auth.uid()
    )
  )
  OR (
    public.has_role(auth.uid(), 'consumer'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.consumer_details AS cd
      WHERE cd.location_id = locations.id
        AND cd.user_id = auth.uid()
    )
  )
);