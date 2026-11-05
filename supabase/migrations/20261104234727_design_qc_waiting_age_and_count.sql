BEGIN;
CREATE INDEX design_qc_latest_review ON public.design_qc_events(revision_id,created_at DESC,id DESC) WHERE action IN('approved','rejected','bypassed');
CREATE OR REPLACE FUNCTION public.get_design_qc_queue() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 WITH work AS(
 SELECT o.id,o.case_id,o.design_qc_revision_id,o.design_qc_required,r.submitted_at,
 coalesce(review.action,'pending') AS state,
 r.id IS NOT NULL AND ((o.design_qc_required AND coalesce(review.action,'pending')='pending') OR review.action='bypassed') AS awaiting_review
 FROM public.orders o LEFT JOIN public.design_revisions r ON r.id=o.design_qc_revision_id
 LEFT JOIN LATERAL(SELECT e.action FROM public.design_qc_events e WHERE e.revision_id=r.id AND e.action IN('approved','rejected','bypassed') ORDER BY e.created_at DESC,e.id DESC LIMIT 1) review ON true
 WHERE o.workflow_type='split' AND o.designer_id IS NOT NULL AND NOT coalesce(o.is_deleted,false) AND public.design_qc_can_read(o.id)
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'caseId',case_id,'revisionId',design_qc_revision_id,'required',design_qc_required,'state',state,'submittedAt',submitted_at,'awaitingReview',coalesce(awaiting_review,false)) ORDER BY coalesce(awaiting_review,false) DESC,submitted_at ASC NULLS LAST,id),'[]'::jsonb) FROM work
$$;
CREATE FUNCTION public.get_pending_design_qc_count() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT count(*) FROM jsonb_array_elements(public.get_design_qc_queue()) q WHERE (q->>'awaitingReview')::boolean IS TRUE
$$;
REVOKE ALL ON FUNCTION public.get_pending_design_qc_count() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pending_design_qc_count() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
