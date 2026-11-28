BEGIN;

CREATE OR REPLACE FUNCTION public.doctor_design_preview_allowed(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT public.get_my_role() = 'doctor' AND EXISTS (
        SELECT 1
        FROM public.design_revisions r
        JOIN public.orders o ON o.id = r.order_id AND o.design_qc_revision_id = r.id
        WHERE r.preview_path = p_path AND public.doctor_portal_can_access_order(o.id)
    )
$$;

CREATE OR REPLACE FUNCTION public.get_my_doctor_design_reviews()
RETURNS TABLE(order_id uuid, revision_id uuid, state text, note text, preview_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT o.id, r.id, coalesce(d.state, 'preview_only'), coalesce(d.note, ''), r.preview_path
    FROM public.orders o
    JOIN public.design_revisions r ON r.id = o.design_qc_revision_id AND r.order_id = o.id
    LEFT JOIN public.doctor_design_reviews d ON d.revision_id = r.id
    WHERE public.get_my_role() = 'doctor' AND public.doctor_portal_can_access_order(o.id)
      AND (r.preview_path IS NOT NULL OR d.revision_id IS NOT NULL)
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
