-- Migration: RPCs to correct or void a logged order issue
--
-- Why this is needed (found 2026-08-16 in production):
--   Nothing in the UI ever writes to order_issues. Rows are created ONLY by
--   log_order_issue_trigger_fn(), which guesses the cause by keyword-matching
--   the order's latest free-text comment. The user never picks a cause, so
--   whenever the comment has no recognised keyword the row lands on the
--   fallback -- which is why most rows read `unknown`.
--
--   That is a pre-existing design issue, not a side effect of the 14-code
--   migration: the old code did exactly the same and simply landed on
--   `other`. Widening the taxonomy just made the guess visibly wrong.
--
--   The real fix is to have the user CHOOSE a cause at the moment the status
--   changes. Until that flow exists, these RPCs let an admin correct the
--   guess afterwards from the issues report -- with an audit trail, so the
--   log stays trustworthy.
--
-- Design rules:
--   - A correction NEVER silently rewrites history: the prior value moves to
--     previous_cause_category and who/when/why are recorded.
--   - A mis-logged row is VOIDED, never deleted. Statistics exclude voided
--     rows; the row itself survives for audit.
--   - Reasons are mandatory. A correction without a stated reason is just an
--     undocumented rewrite.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- correct_order_issue_cause: fix a wrong cause / stage, with an audit trail
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.correct_order_issue_cause(
    p_issue_id          UUID,
    p_cause_category    TEXT,
    p_responsible_stage TEXT,
    p_reason            TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor    UUID;
    v_previous TEXT;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'سبب التصحيح مطلوب' USING ERRCODE = '22023';
    END IF;

    SELECT cause_category INTO v_previous
    FROM order_issues WHERE id = p_issue_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'المشكلة غير موجودة' USING ERRCODE = 'P0002';
    END IF;

    v_actor := public.get_my_user_id();

    UPDATE order_issues
    SET previous_cause_category = v_previous,
        cause_category          = p_cause_category,
        responsible_stage       = p_responsible_stage,
        corrected_at            = NOW(),
        corrected_by            = v_actor,
        correction_reason       = btrim(p_reason)
    WHERE id = p_issue_id;

    RETURN jsonb_build_object(
        'id', p_issue_id,
        'previous_cause_category', v_previous,
        'cause_category', p_cause_category,
        'responsible_stage', p_responsible_stage
    );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_order_issue_cause(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_order_issue_cause(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- void_order_issue: mark a row as logged by mistake. Never deletes.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_order_issue(
    p_issue_id UUID,
    p_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor UUID;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'سبب الإلغاء مطلوب' USING ERRCODE = '22023';
    END IF;

    v_actor := public.get_my_user_id();

    UPDATE order_issues
    SET is_voided         = TRUE,
        corrected_at      = NOW(),
        corrected_by      = v_actor,
        correction_reason = btrim(p_reason)
    WHERE id = p_issue_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'المشكلة غير موجودة' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object('id', p_issue_id, 'is_voided', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.void_order_issue(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_order_issue(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Voided rows must not distort the statistics.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_order_issues_summary(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    WITH scoped AS (
        SELECT oi.issue_type, oi.cause_category, oi.order_id
        FROM order_issues oi
        LEFT JOIN orders o ON o.id = oi.order_id
        WHERE (p_start_date IS NULL OR oi.created_at::date >= p_start_date)
          AND (p_end_date   IS NULL OR oi.created_at::date <= p_end_date)
          -- is_archived deliberately NOT filtered (see 20260812110000)
          AND COALESCE(o.is_deleted, false) = false
          AND COALESCE(oi.is_voided, false) = false
    )
    SELECT jsonb_build_object(
        'distinct_orders_with_issues', COALESCE(COUNT(DISTINCT order_id), 0),
        'total_issue_events',          COALESCE(COUNT(*), 0),
        'date_axis',                   'order_issues.created_at',
        'by_type', COALESCE(
            (SELECT jsonb_object_agg(issue_type, cnt)
             FROM (SELECT issue_type, COUNT(*) AS cnt
                   FROM scoped GROUP BY issue_type) t), '{}'::jsonb),
        'by_cause', COALESCE(
            (SELECT jsonb_object_agg(COALESCE(cause_category, 'unknown'), cnt)
             FROM (SELECT cause_category, COUNT(*) AS cnt
                   FROM scoped GROUP BY cause_category) t), '{}'::jsonb)
    )
    INTO v_result
    FROM scoped;

    RETURN v_result;
END;
$$;

COMMIT;
