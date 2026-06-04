-- Migration 091: Allow multiple returned issues on transitions and backfill from status_history

-- 1. Recreate trigger function log_order_issue_trigger_fn to log issues on actual state transitions
CREATE OR REPLACE FUNCTION log_order_issue_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_latest_comment RECORD;
    v_cause_category TEXT := 'other';
    v_notes TEXT;
    v_reporter_name TEXT := 'system';
    v_reporter_id UUID := NULL;
    v_is_transition BOOLEAN := FALSE;
BEGIN
    -- Detect if this is an insert or the issue_state has transitioned to a non-none value
    IF TG_OP = 'INSERT' THEN
        IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo') THEN
            v_is_transition := TRUE;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo')
           AND NEW.issue_state IS DISTINCT FROM OLD.issue_state THEN
            v_is_transition := TRUE;
        END IF;
    END IF;

    -- Only log issue if a valid transition occurred
    IF v_is_transition THEN
        -- Get the latest comment for this order
        SELECT content, user_id, user_name INTO v_latest_comment
        FROM order_comments
        WHERE order_id = NEW.id
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_latest_comment.content IS NOT NULL THEN
            v_notes := v_latest_comment.content;
            v_reporter_id := v_latest_comment.user_id;
            v_reporter_name := v_latest_comment.user_name;

            -- Try to match cause category from comment keywords
            IF v_notes LIKE '%معمل%' OR v_notes LIKE '%lab%' THEN
                v_cause_category := 'lab';
            ELSIF v_notes LIKE '%دكتور%' OR v_notes LIKE '%doctor%' OR v_notes LIKE '%طبيب%' THEN
                v_cause_category := 'doctor';
            ELSIF v_notes LIKE '%سكان%' OR v_notes LIKE '%scan%' THEN
                v_cause_category := 'scan';
            ELSIF v_notes LIKE '%تصميم%' OR v_notes LIKE '%design%' OR v_notes LIKE '%مصمم%' THEN
                v_cause_category := 'design';
            ELSIF v_notes LIKE '%تواصل%' OR v_notes LIKE '%communication%' THEN
                v_cause_category := 'communication';
            ELSE
                v_cause_category := 'other';
            END IF;
        ELSE
            -- System fallback notes based on state
            v_notes := CASE NEW.issue_state
                WHEN 'returned'  THEN 'تم الإرجاع للتعديل من لوحة التحكم'
                WHEN 'rejected'  THEN 'تم رفض الحالة من لوحة التحكم'
                WHEN 'cancelled' THEN 'تم إلغاء الحالة من لوحة التحكم'
                WHEN 'redo'      THEN 'تم طلب إعادة إنتاج للحالة'
                ELSE 'تغيير حالة الأوردر تلقائياً'
            END;
            v_reporter_name := 'system';
        END IF;

        INSERT INTO order_issues (order_id, issue_type, cause_category, notes, reporter_id, reporter_name, created_at)
        VALUES (NEW.id, NEW.issue_state, v_cause_category, v_notes, v_reporter_id, v_reporter_name, NOW());
    END IF;

    RETURN NEW;
END;
$$;

-- 2. Backfill any historical "Returned for Adjustments" events from status_history status transitions
INSERT INTO order_issues (order_id, issue_type, cause_category, notes, reporter_name, created_at)
SELECT
    o.id,
    'returned',
    'other',
    'تم الترحيل تلقائياً من تاريخ الحالات (تعديل)',
    'system',
    (sh->>'enteredAt')::timestamptz
FROM orders o,
     jsonb_array_elements(o.status_history) sh
WHERE sh->>'status' = 'Returned for Adjustments'
  AND NOT EXISTS (
      SELECT 1 FROM order_issues oi
      WHERE oi.order_id = o.id
        AND oi.issue_type = 'returned'
        -- Avoid duplicating within a 5-minute window of the same transition timestamp
        AND ABS(EXTRACT(EPOCH FROM (oi.created_at - (sh->>'enteredAt')::timestamptz))) < 300
  );
