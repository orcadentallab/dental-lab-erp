BEGIN;

CREATE TABLE public.doctor_portal_try_in_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id),
    review_run_id uuid REFERENCES public.production_stage_runs(id),
    actor_id uuid NOT NULL REFERENCES public.users(id),
    action text NOT NULL CHECK (action IN ('approve', 'changes')),
    note text NOT NULL,
    response_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX doctor_portal_try_in_run_once
    ON public.doctor_portal_try_in_responses(review_run_id) WHERE review_run_id IS NOT NULL;
CREATE INDEX doctor_portal_try_in_order_response ON public.doctor_portal_try_in_responses(order_id, response_at);
ALTER TABLE public.doctor_portal_try_in_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_portal_try_in_responses FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_my_doctor_try_in_requests()
RETURNS TABLE(order_id uuid, order_version timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT o.id, o.updated_at
    FROM public.orders o
    WHERE public.get_my_role() = 'doctor'
      AND o.doctor_id IN (SELECT public.doctor_portal_scope())
      AND o.production_status = 'waiting_doctor' AND o.issue_state = 'none'
      AND NOT coalesce(o.is_deleted, false) AND NOT coalesce(o.is_archived, false)
      AND NOT EXISTS (
          SELECT 1 FROM public.production_doctor_waits w WHERE w.order_id = o.id AND w.ended_at IS NULL
      )
$$;

-- Staff keep their existing commands. A portal response authorizes exactly one
-- active trial round, with the authenticated doctor retained as the event actor.
DO $patch$
DECLARE
    definition text := pg_get_functiondef('public.mixed_try_in_doctor_action(uuid,text,text)'::regprocedure);
    anchor text := 'IF coalesce(public.get_my_role(),'''') NOT IN (''admin'',''coordinator'') THEN';
BEGIN
    IF strpos(definition, anchor) = 0 THEN RAISE EXCEPTION 'Mixed trial role guard anchor missing'; END IF;
    EXECUTE replace(definition, anchor, $body$
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','coordinator') AND NOT (
        public.get_my_role() = 'doctor' AND EXISTS (
            SELECT 1 FROM public.doctor_portal_try_in_responses d
            WHERE d.review_run_id = p_run AND d.actor_id = public.get_my_user_id()
              AND public.doctor_portal_can_access_order(d.order_id)
              AND d.response_at >= transaction_timestamp()
              AND ((d.action = 'approve' AND p_action = 'approve')
                   OR (d.action = 'changes' AND p_action = 'request_design_change'))
        )
    ) THEN$body$);

    definition := pg_get_functiondef('public.return_design_revision(uuid,uuid,text)'::regprocedure);
    anchor := 'IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN(''admin'',''coordinator'') THEN';
    IF strpos(definition, anchor) = 0 THEN RAISE EXCEPTION 'Designer return role guard anchor missing'; END IF;
    EXECUTE replace(definition, anchor, $body$
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','coordinator') AND NOT (
        public.get_my_role() = 'doctor' AND EXISTS (
            SELECT 1 FROM public.doctor_portal_try_in_responses d
            JOIN public.orders o ON o.id = d.order_id
            WHERE d.order_id = p_order_id AND d.review_run_id IS NOT NULL
              AND d.actor_id = public.get_my_user_id() AND d.action = 'changes'
              AND d.note = btrim(p_note) AND d.response_at >= transaction_timestamp()
              AND o.production_status = 'waiting_doctor'
              AND public.doctor_portal_can_access_order(o.id)
        )
    ) THEN$body$);

    definition := pg_get_functiondef('public.orders_role_field_guard()'::regprocedure);
    anchor := 'IF v_role = ''doctor'' THEN';
    IF strpos(definition, anchor) = 0 THEN RAISE EXCEPTION 'Doctor order role guard anchor missing'; END IF;
    EXECUTE replace(definition, anchor, $body$
    IF v_role = 'doctor' AND OLD.production_status = 'waiting_doctor'
       AND (to_jsonb(NEW) - ARRAY['production_status','status']) = (to_jsonb(OLD) - ARRAY['production_status','status'])
       AND public.doctor_portal_can_access_order(OLD.id)
       AND EXISTS (
           SELECT 1 FROM public.doctor_portal_try_in_responses d
           WHERE d.order_id = OLD.id AND d.review_run_id IS NULL AND d.actor_id = public.get_my_user_id()
             AND d.response_at >= transaction_timestamp()
             AND NEW.production_status = CASE WHEN d.action = 'approve' THEN 'finalization'
                 WHEN OLD.designer_id IS NOT NULL THEN 'designing' ELSE 'in_production' END
       ) THEN RETURN NEW; END IF;
    IF v_role = 'doctor' THEN$body$);
END;
$patch$;

CREATE FUNCTION public.respond_to_doctor_try_in(p_order uuid, p_order_version timestamptz, p_action text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    case_order public.orders%ROWTYPE;
    trial_run uuid;
    comment text := btrim(coalesce(p_note, ''));
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'doctor' OR NOT public.doctor_portal_can_access_order(p_order) THEN
        RAISE EXCEPTION 'Trial response access denied' USING ERRCODE = '42501';
    END IF;
    IF p_action IS NULL OR p_action NOT IN ('approve', 'changes') OR length(comment) > 1000
       OR (p_action = 'changes' AND comment = '') THEN
        RAISE EXCEPTION 'Write the requested trial changes' USING ERRCODE = '22023';
    END IF;

    -- Use the same lock order as the staff mixed-route command.
    SELECT r.id INTO trial_run FROM public.production_stage_runs r
    JOIN public.production_jobs j ON j.id = r.job_id
    JOIN public.production_stages s ON s.id = r.stage_id
    WHERE j.order_id = p_order AND j.route_id = 'ba100000-0000-4000-8000-000000000001'
      AND s.code = 'doctor_review' AND r.status = 'ready'
    ORDER BY r.queued_at DESC, r.id LIMIT 1 FOR UPDATE OF r;

    SELECT * INTO case_order FROM public.orders WHERE id = p_order FOR UPDATE;
    IF NOT FOUND OR NOT public.doctor_portal_can_access_order(p_order)
       OR case_order.updated_at IS DISTINCT FROM p_order_version
       OR NOT EXISTS (SELECT 1 FROM public.get_my_doctor_try_in_requests() r WHERE r.order_id = p_order)
       OR (case_order.route_override_id = 'ba100000-0000-4000-8000-000000000001' AND trial_run IS NULL) THEN
        RAISE EXCEPTION 'This trial is no longer awaiting your response' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.doctor_portal_try_in_responses(order_id, review_run_id, actor_id, action, note)
    VALUES (p_order, trial_run, public.get_my_user_id(), p_action, comment);

    IF trial_run IS NOT NULL THEN
        PERFORM public.mixed_try_in_doctor_action(trial_run,
            CASE WHEN p_action = 'approve' THEN 'approve' ELSE 'request_design_change' END, nullif(comment,''));
        RETURN;
    END IF;

    IF p_action = 'changes' AND case_order.designer_id IS NOT NULL AND case_order.design_qc_revision_id IS NOT NULL THEN
        INSERT INTO public.design_qc_events(order_id, revision_id, action, note, actor_id, actor_role)
        VALUES (p_order, case_order.design_qc_revision_id, 'returned', comment, public.get_my_user_id(), 'doctor');
    END IF;
    UPDATE public.orders SET production_status = CASE WHEN p_action = 'approve' THEN 'finalization'
        WHEN case_order.designer_id IS NOT NULL THEN 'designing' ELSE 'in_production' END WHERE id = p_order;
    INSERT INTO public.order_events(order_id, event_type, changed_by, actor_role, notes, severity)
    VALUES (p_order, CASE WHEN p_action = 'approve' THEN 'try_in_approved' ELSE 'try_in_adjustment_requested' END,
        public.get_my_user_id(), 'doctor', nullif(comment,''), 'info');
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_doctor_try_in_requests(),
    public.respond_to_doctor_try_in(uuid,timestamptz,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_doctor_try_in_requests(),
    public.respond_to_doctor_try_in(uuid,timestamptz,text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
