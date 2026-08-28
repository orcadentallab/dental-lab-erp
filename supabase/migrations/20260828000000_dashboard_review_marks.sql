-- Migration: 20260828000000_dashboard_review_marks.sql
-- Description: Durable per-user "reviewed" marks for the dashboard review centre
--              (comments + applied order edits).
--
-- Why: the review centre used to keep these marks in browser localStorage only.
-- That state is per-browser and per-tab: a second open tab (or another device)
-- holds a stale snapshot of the set and its next write clobbers everything the
-- first tab had dismissed, so "تمت مراجعة الكل" appeared to be undone as soon as
-- a new comment/edit arrived. Storing the marks per user in the database makes
-- the action stick regardless of tab, device or cleared site data.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dashboard_review_marks (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- 'comment'    -> public.order_comments.id
    -- 'order_edit' -> public.order_events.id
    item_type TEXT NOT NULL CHECK (item_type IN ('comment', 'order_edit')),
    item_id UUID NOT NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, item_type, item_id)
);

COMMENT ON TABLE public.dashboard_review_marks IS
    'Per-user acknowledgement of dashboard review-centre items (comments, applied order edits). Replaces the old localStorage-only state.';

CREATE INDEX IF NOT EXISTS idx_dashboard_review_marks_user_type
    ON public.dashboard_review_marks(user_id, item_type);

ALTER TABLE public.dashboard_review_marks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.dashboard_review_marks TO authenticated;

-- Marks are private bookkeeping: every user only ever sees and writes their own.
DROP POLICY IF EXISTS "Users read their own review marks" ON public.dashboard_review_marks;
CREATE POLICY "Users read their own review marks"
    ON public.dashboard_review_marks
    FOR SELECT
    TO authenticated
    USING (user_id = public.get_my_user_id());

DROP POLICY IF EXISTS "Users insert their own review marks" ON public.dashboard_review_marks;
CREATE POLICY "Users insert their own review marks"
    ON public.dashboard_review_marks
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = public.get_my_user_id());

-- Deleting a mark = un-reviewing an item, so it comes back into the queue.
DROP POLICY IF EXISTS "Users delete their own review marks" ON public.dashboard_review_marks;
CREATE POLICY "Users delete their own review marks"
    ON public.dashboard_review_marks
    FOR DELETE
    TO authenticated
    USING (user_id = public.get_my_user_id());

-- Applied/rejected order edits the current user has not reviewed yet.
-- The dashboard used to pull the newest 50 events and filter them in the browser,
-- so once more than 50 events existed the older unreviewed ones could never be
-- reached and the tab was permanently stuck at 50. Filtering server-side keeps
-- the count honest no matter how large order_events grows.
CREATE OR REPLACE FUNCTION public.get_unreviewed_order_edits(p_limit INT DEFAULT 200)
RETURNS SETOF public.order_events
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
    SELECT e.*
    FROM public.order_events e
    WHERE e.event_type IN ('order_edit_applied', 'order_edit_proposed')
      -- Matches the previous PostgREST `neq.pending` filter: NULL approval_status
      -- rows were excluded there too.
      AND e.approval_status <> 'pending'
      AND NOT EXISTS (
          SELECT 1
          FROM public.dashboard_review_marks m
          WHERE m.item_type = 'order_edit'
            AND m.item_id = e.id
            AND m.user_id = public.get_my_user_id()
      )
    ORDER BY e.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

COMMENT ON FUNCTION public.get_unreviewed_order_edits(INT) IS
    'Applied/rejected order edits not yet acknowledged by the calling user, newest first.';

GRANT EXECUTE ON FUNCTION public.get_unreviewed_order_edits(INT) TO authenticated;

COMMIT;
