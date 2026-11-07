BEGIN;

-- The coordinator's normal workflow edits remain blocked. Permit only the
-- exact transition backed by the bypass event written in this transaction.
DO $$
DECLARE
    definition text := pg_get_functiondef('public.orders_role_field_guard()'::regprocedure);
    marker text := 'IF v_role = ANY (ARRAY[''accountant'', ''coordinator'']) THEN';
BEGIN
    IF position('app.design_qc_bypass_event' IN definition) > 0 THEN RETURN; END IF;
    IF position(marker IN definition) = 0 THEN
        RAISE EXCEPTION 'Expected coordinator workflow guard was not found';
    END IF;
    EXECUTE replace(definition, marker, $guard$
    IF v_role = 'coordinator' AND OLD.production_status = 'designing' AND NEW.production_status = 'in_production'
       AND OLD.issue_state = 'none' AND NEW.issue_state IS NOT DISTINCT FROM OLD.issue_state
       AND NEW.actual_delivery_date IS NOT DISTINCT FROM OLD.actual_delivery_date
       AND NEW.first_delivered_at IS NOT DISTINCT FROM OLD.first_delivered_at
       AND NEW.design_submitted_at IS NOT DISTINCT FROM OLD.design_submitted_at
       AND NEW.design_qc_revision_id IS NOT DISTINCT FROM OLD.design_qc_revision_id
       AND EXISTS (SELECT 1 FROM public.design_qc_events e
           WHERE e.id::text = current_setting('app.design_qc_bypass_event', true)
             AND e.order_id = OLD.id AND e.revision_id = OLD.design_qc_revision_id
             AND e.actor_id = public.get_my_user_id() AND e.action = 'bypassed') THEN
        RETURN NEW;
    END IF;
    $guard$ || marker);
END;
$$;

CREATE FUNCTION public.resolve_design_qc_review(
    p_revision_id uuid, p_command_id uuid, p_action text, p_note text,
    p_destination text, p_designer_id uuid, p_old_amount numeric, p_new_amount numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    selected_order public.orders%ROWTYPE;
    last_action text;
    retry public.design_qc_events%ROWTYPE;
    command jsonb;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
    END IF;
    IF nullif(btrim(p_note), '') IS NULL THEN
        RAISE EXCEPTION 'Reason required' USING ERRCODE = '22023';
    END IF;
    IF p_command_id IS NULL OR p_action IS NULL OR p_action NOT IN ('changes', 'reject')
       OR p_destination IS NULL OR p_destination NOT IN ('current', 'replacement', 'none')
       OR (p_action = 'changes' AND p_destination = 'none') THEN
        RAISE EXCEPTION 'Invalid review action' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.design_qc_control WHERE id FOR SHARE;
    SELECT o.* INTO selected_order FROM public.orders o
    JOIN public.design_revisions r ON r.order_id = o.id
    WHERE r.id = p_revision_id FOR UPDATE OF o;
    IF NOT FOUND OR coalesce(selected_order.is_deleted, false) OR coalesce(selected_order.is_archived, false)
       OR NOT coalesce(public.design_qc_can_read(selected_order.id), false) THEN
        RAISE EXCEPTION 'Design access denied' USING ERRCODE = '42501';
    END IF;

    command := jsonb_build_object('action', p_action, 'destination', p_destination);
    SELECT * INTO retry FROM public.design_qc_events WHERE id = p_command_id;
    IF FOUND THEN
        IF retry.revision_id IS DISTINCT FROM p_revision_id OR retry.actor_id IS DISTINCT FROM public.get_my_user_id()
           OR retry.note IS DISTINCT FROM btrim(p_note) OR retry.metadata->'reviewCommand' IS DISTINCT FROM command THEN
            RAISE EXCEPTION 'Review retry mismatch' USING ERRCODE = '22023';
        END IF;
        RETURN;
    END IF;
    IF selected_order.design_qc_revision_id IS DISTINCT FROM p_revision_id THEN
        RAISE EXCEPTION 'Review the current revision' USING ERRCODE = '23514';
    END IF;
    SELECT e.action INTO last_action FROM public.design_qc_events e
    WHERE e.revision_id = p_revision_id AND e.action IN ('approved', 'rejected', 'bypassed', 'returned')
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
    IF last_action = 'returned' THEN
        RAISE EXCEPTION 'Await a new design submission' USING ERRCODE = '23514';
    END IF;
    IF p_destination <> 'none' AND (selected_order.production_status = 'final_delivered' OR selected_order.designer_id IS NULL
        OR selected_order.issue_state IS DISTINCT FROM 'none') THEN
        RAISE EXCEPTION 'Design cannot be released in its current state' USING ERRCODE = '23514';
    END IF;

    IF p_action = 'reject' THEN
        PERFORM public.decide_design_revision(p_revision_id,
            CASE WHEN p_destination = 'replacement' THEN gen_random_uuid() ELSE p_command_id END, 'rejected', p_note);
    END IF;
    IF p_destination = 'current' THEN
        PERFORM public.return_design_revision(selected_order.id, selected_order.designer_id, p_note);
    ELSIF p_destination = 'replacement' THEN
        PERFORM public.reassign_design_revision(selected_order.id, p_designer_id, p_note, p_old_amount, p_new_amount, p_command_id);
    END IF;

    IF p_action = 'changes' AND p_destination = 'current' THEN
        -- The existing same-designer operation supplies the return event. Bind it to the command for retries.
        UPDATE public.design_qc_events SET id = p_command_id
        WHERE id = (SELECT e.id FROM public.design_qc_events e WHERE e.revision_id = p_revision_id
            AND e.action = 'returned' ORDER BY e.created_at DESC, e.id DESC LIMIT 1);
    END IF;
    UPDATE public.design_qc_events SET metadata = metadata || jsonb_build_object('reviewCommand', command)
    WHERE id = p_command_id;
END;
$$;

CREATE FUNCTION public.bypass_and_release_design_revision(p_revision_id uuid, p_event_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    selected_order public.orders%ROWTYPE;
    latest_action text;
    previous_bypass_event text := current_setting('app.design_qc_bypass_event', true);
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'coordinator' THEN
        RAISE EXCEPTION 'Coordinator role required' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.design_qc_control WHERE id FOR SHARE;
    SELECT o.* INTO selected_order FROM public.orders o
    JOIN public.design_revisions r ON r.order_id = o.id
    WHERE r.id = p_revision_id FOR UPDATE OF o;
    IF NOT FOUND OR NOT coalesce(public.design_qc_can_read(selected_order.id), false)
       OR coalesce(selected_order.is_deleted, false) OR coalesce(selected_order.is_archived, false) THEN
        RAISE EXCEPTION 'Design access denied' USING ERRCODE = '42501';
    END IF;
    IF selected_order.design_qc_revision_id IS DISTINCT FROM p_revision_id THEN
        RAISE EXCEPTION 'Review the current revision' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.design_qc_events WHERE id = p_event_id) THEN
        PERFORM public.decide_design_revision(p_revision_id, p_event_id, 'bypassed', p_note);
        RETURN;
    END IF;
    SELECT e.action INTO latest_action FROM public.design_qc_events e
    WHERE e.revision_id = p_revision_id AND e.action IN ('approved', 'rejected', 'bypassed', 'returned')
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
    IF latest_action IS NOT NULL OR NOT selected_order.design_qc_required
       OR selected_order.production_status IS DISTINCT FROM 'designing'
       OR selected_order.issue_state IS DISTINCT FROM 'none' THEN
        RAISE EXCEPTION 'Design no longer awaits QC' USING ERRCODE = '23514';
    END IF;
    PERFORM public.decide_design_revision(p_revision_id, p_event_id, 'bypassed', p_note);
    PERFORM set_config('app.design_qc_bypass_event', p_event_id::text, true);
    PERFORM public.release_design_revision(selected_order.id);
    PERFORM set_config('app.design_qc_bypass_event', coalesce(previous_bypass_event, ''), true);
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = selected_order.id AND production_status = 'in_production') THEN
        RAISE EXCEPTION 'Design cannot be released in its current state' USING ERRCODE = '23514';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_design_qc_review(uuid, uuid, text, text, text, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_design_qc_review(uuid, uuid, text, text, text, uuid, numeric, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.bypass_and_release_design_revision(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bypass_and_release_design_revision(uuid, uuid, text) TO authenticated;

-- Require a new submission before advancing the order after a return.
-- Stage snapshots keep their original QC decision for historical execution.
CREATE FUNCTION public.guard_returned_design_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF OLD.production_status = 'designing'
       AND NEW.production_status NOT IN ('designing', 'not_started')
       AND NEW.design_qc_revision_id = OLD.design_qc_revision_id
       AND (SELECT e.action FROM public.design_qc_events e
           WHERE e.revision_id = OLD.design_qc_revision_id
             AND e.action IN ('approved', 'rejected', 'bypassed', 'returned')
           ORDER BY e.created_at DESC, e.id DESC LIMIT 1) = 'returned' THEN
        RAISE EXCEPTION 'Await a new design submission' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_returned_design_release() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER aab_guard_returned_design_release BEFORE UPDATE OF production_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_returned_design_release();

CREATE OR REPLACE FUNCTION public.get_design_qc_queue()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH work AS (
        SELECT o.id, o.case_id, o.design_qc_revision_id, o.design_qc_required, r.submitted_at, o.production_status,
            o.production_status = 'designing' AND o.issue_state = 'none' AND o.design_qc_required
                AND r.id IS NOT NULL AND review.action IS NULL AS can_bypass,
            coalesce(review.action, 'pending') AS state, review.needs_followup,
            CASE WHEN review.action = 'returned' OR review.needs_followup THEN review.note END AS feedback,
            r.id IS NOT NULL AND ((o.design_qc_required AND review.action IS NULL) OR review.action = 'bypassed') AS awaiting_review
        FROM public.orders o LEFT JOIN public.design_revisions r ON r.id = o.design_qc_revision_id
        LEFT JOIN LATERAL (
            SELECT e.action, e.note, e.needs_followup FROM public.design_qc_events e
            WHERE e.revision_id = r.id AND e.action IN ('approved', 'rejected', 'bypassed', 'returned')
              AND (e.action <> 'returned' OR o.production_status = 'designing')
            ORDER BY e.created_at DESC, e.id DESC LIMIT 1
        ) review ON true
        WHERE o.workflow_type = 'split' AND o.designer_id IS NOT NULL AND NOT coalesce(o.is_deleted, false)
          AND NOT coalesce(o.is_archived, false) AND public.design_qc_can_read(o.id)
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'caseId', case_id, 'revisionId', design_qc_revision_id,
        'required', design_qc_required, 'state', state, 'submittedAt', submitted_at, 'awaitingReview', coalesce(awaiting_review, false),
        'canBypass', coalesce(can_bypass, false), 'needsFollowup', coalesce(needs_followup, false), 'feedback', feedback)
        ORDER BY coalesce(awaiting_review, false) DESC, submitted_at ASC NULLS LAST, id), '[]'::jsonb) FROM work;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
