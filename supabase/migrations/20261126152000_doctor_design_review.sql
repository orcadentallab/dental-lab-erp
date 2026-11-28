BEGIN;

ALTER TABLE public.doctors ADD COLUMN requires_design_approval boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.guard_doctor_design_preference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF NEW.requires_design_approval IS DISTINCT FROM
       (CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.requires_design_approval END)
       AND public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_doctor_design_preference BEFORE INSERT OR UPDATE OF requires_design_approval ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.guard_doctor_design_preference();
CREATE TABLE public.doctor_design_reviews (
    revision_id uuid PRIMARY KEY REFERENCES public.design_revisions(id),
    order_id uuid NOT NULL REFERENCES public.orders(id),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'changes')),
    note text NOT NULL DEFAULT '',
    decided_by uuid REFERENCES public.users(id),
    decided_at timestamptz
);
ALTER TABLE public.doctor_design_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_design_reviews FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_doctor_design_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF NEW.design_qc_revision_id IS DISTINCT FROM OLD.design_qc_revision_id
       AND NEW.design_qc_revision_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = NEW.doctor_id AND d.requires_design_approval) THEN
        IF OLD.production_status NOT IN ('not_started', 'designing') THEN
            RAISE EXCEPTION 'Return the case to design before submitting a new revision' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.doctor_design_reviews(revision_id, order_id)
        VALUES (NEW.design_qc_revision_id, NEW.id) ON CONFLICT DO NOTHING;
        -- Keep the completed design and earnings while waiting for doctor input.
        NEW.production_status := 'designing';
    END IF;
    IF NEW.production_status IS DISTINCT FROM OLD.production_status
       AND NEW.production_status IN ('in_production', 'try_in_ready', 'waiting_doctor', 'finalization', 'final_ready', 'final_delivered')
       AND EXISTS (SELECT 1 FROM public.doctor_design_reviews r
                   WHERE r.revision_id = NEW.design_qc_revision_id AND r.state <> 'approved') THEN
        RAISE EXCEPTION 'Doctor design approval required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER aaa_doctor_design_review BEFORE UPDATE OF design_qc_revision_id, production_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_doctor_design_review();

CREATE FUNCTION public.guard_doctor_design_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    target_order uuid;
BEGIN
    IF TG_TABLE_NAME = 'production_stage_runs' THEN
        IF NEW.status NOT IN ('in_progress', 'waiting_external', 'done') OR
           EXISTS (SELECT 1 FROM public.production_stages s WHERE s.id = NEW.stage_id AND s.code = 'design') THEN
            RETURN NEW;
        END IF;
        SELECT j.order_id INTO target_order FROM public.production_jobs j WHERE j.id = NEW.job_id;
    ELSE
        SELECT j.order_id INTO target_order FROM public.production_stage_runs r
        JOIN public.production_jobs j ON j.id = r.job_id WHERE r.id = NEW.stage_run_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.orders o JOIN public.doctor_design_reviews r ON r.revision_id = o.design_qc_revision_id
               WHERE o.id = target_order AND r.state <> 'approved') THEN
        RAISE EXCEPTION 'Doctor design approval required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_doctor_design_stage BEFORE INSERT OR UPDATE OF status ON public.production_stage_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_doctor_design_execution();
CREATE TRIGGER guard_doctor_design_dispatch BEFORE INSERT OR UPDATE OF status ON public.external_work_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_doctor_design_execution();

-- Allow exactly the production transition recorded by the scoped approval RPC.
DO $patch$
DECLARE
    definition text := pg_get_functiondef('public.orders_role_field_guard()'::regprocedure);
    anchor text := 'IF v_role = ''doctor'' THEN RAISE EXCEPTION ''doctor role cannot update orders directly''; END IF;';
BEGIN
    IF strpos(definition, anchor) = 0 THEN RAISE EXCEPTION 'Doctor order guard anchor missing'; END IF;
    EXECUTE replace(definition, anchor, $guard$
    IF v_role = 'doctor' THEN
        IF OLD.production_status = 'designing' AND NEW.production_status = 'in_production'
           AND (to_jsonb(NEW) - ARRAY['production_status','status']) = (to_jsonb(OLD) - ARRAY['production_status','status'])
           AND public.doctor_portal_can_access_order(OLD.id)
           AND EXISTS (
               SELECT 1 FROM public.doctor_design_reviews review
               WHERE review.revision_id = OLD.design_qc_revision_id AND review.order_id = OLD.id
                 AND review.state = 'approved' AND review.decided_by = public.get_my_user_id()
                 AND review.decided_at >= transaction_timestamp()
           ) THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'doctor role cannot update orders directly';
    END IF;
    $guard$);
END;
$patch$;

CREATE FUNCTION public.decide_doctor_design_review(p_revision uuid, p_action text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    selected_order public.orders%ROWTYPE;
    decision public.doctor_design_reviews%ROWTYPE;
    comment text := trim(coalesce(p_note, ''));
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'doctor' THEN
        RAISE EXCEPTION 'Doctor design review access denied' USING ERRCODE = '42501';
    END IF;
    IF p_action IS NULL OR p_action NOT IN ('approved', 'changes')
       OR length(comment) > 1000 OR (p_action = 'changes' AND comment = '') THEN
        RAISE EXCEPTION 'Write the requested changes' USING ERRCODE = '22023';
    END IF;
    SELECT o.* INTO selected_order FROM public.orders o
    WHERE o.design_qc_revision_id = p_revision AND public.doctor_portal_can_access_order(o.id) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Doctor design review access denied' USING ERRCODE = '42501'; END IF;
    SELECT * INTO decision FROM public.doctor_design_reviews WHERE revision_id = p_revision FOR UPDATE;
    IF NOT FOUND OR decision.state <> 'pending' OR selected_order.production_status <> 'designing'
        OR selected_order.issue_state <> 'none' OR selected_order.is_archived THEN
        RAISE EXCEPTION 'This revision is no longer awaiting your response' USING ERRCODE = '23514';
    END IF;
    UPDATE public.doctor_design_reviews SET state = p_action, note = comment,
        decided_by = public.get_my_user_id(), decided_at = clock_timestamp() WHERE revision_id = p_revision;
    IF p_action = 'changes' THEN
        INSERT INTO public.design_qc_events(order_id, revision_id, action, note, actor_id, actor_role)
        VALUES (selected_order.id, p_revision, 'returned', comment, public.get_my_user_id(), 'doctor');
    ELSIF NOT EXISTS (SELECT 1 FROM public.design_qc_control WHERE enabled)
          OR NOT selected_order.design_qc_required OR coalesce(public.design_qc_gate_passes(p_revision), false) THEN
        UPDATE public.orders SET production_status = 'in_production' WHERE id = selected_order.id;
    END IF;
END;
$$;

CREATE FUNCTION public.doctor_design_preview_allowed(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT public.get_my_role() = 'doctor' AND EXISTS (
        SELECT 1 FROM public.design_revisions r JOIN public.orders o ON o.design_qc_revision_id = r.id
        JOIN public.doctor_design_reviews d ON d.revision_id = r.id
        WHERE r.preview_path = p_path AND public.doctor_portal_can_access_order(o.id)
    )
$$;
ALTER POLICY qc_file_read_limit ON storage.objects USING (
    bucket_id <> 'design-qc-files' OR public.design_qc_can_read_path(name) OR public.doctor_design_preview_allowed(name)
);
ALTER POLICY qc_file_read ON storage.objects USING (
    bucket_id = 'design-qc-files' AND (public.design_qc_can_read_path(name) OR public.doctor_design_preview_allowed(name))
);
ALTER POLICY doctor_blocked_internal_buckets ON storage.objects USING (
    public.get_my_role() IS DISTINCT FROM 'doctor'
    OR (bucket_id IN ('case-files', 'case-scans') AND public.doctor_portal_owns_file(name))
    OR (bucket_id = 'design-qc-files' AND public.doctor_design_preview_allowed(name))
);
ALTER POLICY portal_storage_read_scope ON storage.objects USING (
    public.get_my_role() IS DISTINCT FROM 'doctor'
    OR (bucket_id IN ('case-files', 'case-scans') AND public.doctor_portal_owns_file(name))
    OR (bucket_id = 'design-qc-files' AND public.doctor_design_preview_allowed(name))
);

CREATE FUNCTION public.get_my_doctor_design_reviews()
RETURNS TABLE(order_id uuid, revision_id uuid, state text, note text, preview_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT o.id, r.id, d.state, d.note, r.preview_path
    FROM public.orders o JOIN public.design_revisions r ON r.id = o.design_qc_revision_id
    JOIN public.doctor_design_reviews d ON d.revision_id = r.id
    WHERE public.get_my_role() = 'doctor' AND public.doctor_portal_can_access_order(o.id)
$$;

REVOKE ALL ON FUNCTION public.guard_doctor_design_preference(), public.guard_doctor_design_review(), public.guard_doctor_design_execution(),
    public.decide_doctor_design_review(uuid, text, text), public.get_my_doctor_design_reviews(),
    public.doctor_design_preview_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_doctor_design_review(uuid, text, text), public.get_my_doctor_design_reviews(),
    public.doctor_design_preview_allowed(text) TO authenticated;
COMMIT;
