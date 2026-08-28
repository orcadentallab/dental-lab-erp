-- Migration: 20260828001000_mark_all_order_edits_reviewed.sql
-- Description: Server-side "review all" for the applied-edits queue + tighten
--              EXECUTE grants on the review-centre RPCs.
--
-- Why: the dashboard fetches the unreviewed edits in a bounded page, so a
-- "review all" implemented over the loaded rows only acknowledges that page and
-- the rest silently stay in the queue — the same class of bug as the old
-- limit(50). Marking them in one server-side statement makes the button mean
-- what it says regardless of how many events exist.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_all_order_edits_reviewed()
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
    v_user UUID := public.get_my_user_id();
    v_count INT;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'لا يوجد مستخدم مرتبط بالجلسة الحالية';
    END IF;

    -- SECURITY INVOKER on purpose: order_events RLS still applies, so a caller
    -- only ever acknowledges the events they are allowed to see.
    INSERT INTO public.dashboard_review_marks (user_id, item_type, item_id)
    SELECT v_user, 'order_edit', e.id
    FROM public.order_events e
    WHERE e.event_type IN ('order_edit_applied', 'order_edit_proposed')
      AND e.approval_status <> 'pending'
    ON CONFLICT (user_id, item_type, item_id) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.mark_all_order_edits_reviewed() IS
    'Marks every applied/rejected order edit visible to the caller as reviewed. Returns how many new marks were written.';

-- Postgres grants EXECUTE to PUBLIC by default; the anon key ships in the
-- frontend bundle, so close both review-centre RPCs to it explicitly.
REVOKE ALL ON FUNCTION public.mark_all_order_edits_reviewed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_unreviewed_order_edits(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_order_edits_reviewed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unreviewed_order_edits(INT) TO authenticated;

COMMIT;
