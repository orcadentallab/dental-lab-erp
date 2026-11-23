CREATE POLICY "Representatives can record scanner rent"
ON public.adjustments
FOR INSERT TO authenticated
WITH CHECK (
    (SELECT public.get_my_role()) = 'representative'
    AND entity_type = 'doctor'
    AND type = 'charge'
    AND amount > 0
    AND amount < 'Infinity'::numeric
    AND (reason = 'Scanner Rent' OR reason LIKE 'Scanner Rent - %')
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND created_at = now()
    AND EXISTS (SELECT 1 FROM public.doctors WHERE doctors.id = adjustments.entity_id)
);
