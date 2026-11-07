CREATE FUNCTION public.approve_and_release_design_revision(p_revision_id uuid, p_event_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    selected_order public.orders%ROWTYPE;
    is_retry boolean;
    latest_action text;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
    END IF;

    -- Follow the submission lock order so a concurrent upload cannot replace the reviewed revision.
    PERFORM 1 FROM public.design_qc_control WHERE id FOR SHARE;
    SELECT o.* INTO selected_order
    FROM public.orders o
    JOIN public.design_revisions r ON r.order_id = o.id
    WHERE r.id = p_revision_id
    FOR UPDATE OF o;

    IF NOT FOUND OR NOT coalesce(public.design_qc_can_read(selected_order.id), false) THEN
        RAISE EXCEPTION 'Design access denied' USING ERRCODE = '42501';
    END IF;
    IF selected_order.design_qc_revision_id IS DISTINCT FROM p_revision_id THEN
        RAISE EXCEPTION 'Review the current revision' USING ERRCODE = '23514';
    END IF;
    IF selected_order.production_status = 'not_started'
       OR (selected_order.production_status = 'designing' AND selected_order.issue_state IS DISTINCT FROM 'none') THEN
        RAISE EXCEPTION 'Design cannot be released in its current state' USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.design_qc_events WHERE id = p_event_id) INTO is_retry;
    SELECT e.action INTO latest_action FROM public.design_qc_events e
    WHERE e.revision_id = p_revision_id AND e.action IN ('approved', 'rejected', 'bypassed', 'returned')
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
    IF NOT is_retry AND latest_action = 'returned' THEN
        RAISE EXCEPTION 'Await a new design submission' USING ERRCODE = '23514';
    END IF;
    PERFORM public.decide_design_revision(p_revision_id, p_event_id, 'approved', p_note);
    IF is_retry THEN
        RETURN;
    END IF;
    -- Later review of a bypassed design must not move an already advanced order backwards.
    IF selected_order.production_status = 'designing' THEN
        PERFORM public.release_design_revision(selected_order.id);
        IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = selected_order.id AND production_status = 'in_production') THEN
            RAISE EXCEPTION 'Design cannot be released in its current state' USING ERRCODE = '23514';
        END IF;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_release_design_revision(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_and_release_design_revision(uuid, uuid, text) TO authenticated;
