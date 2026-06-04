-- =====================================================================
-- Migration 090: Sync order issues and workflow states
-- Date: 2026-06-02
-- Purpose: Keep production_status and issue_state in sync with status,
-- and automatically create records in order_issues table on state change.
-- =====================================================================

-- 1. Update update_order_atomic to support production_status and issue_state
CREATE OR REPLACE FUNCTION update_order_atomic(
    p_order_id UUID,
    p_updates JSONB,
    p_items JSONB DEFAULT NULL,
    p_comments JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_exists BOOLEAN;
    v_result JSONB;
BEGIN
    SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;
    IF NOT v_order_exists THEN
        RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
    END IF;

    UPDATE orders
    SET
        case_id = CASE WHEN p_updates ? 'case_id' THEN (p_updates->>'case_id')::text ELSE case_id END,
        doctor_id = CASE WHEN p_updates ? 'doctor_id' THEN (p_updates->>'doctor_id')::uuid ELSE doctor_id END,
        patient_name = CASE WHEN p_updates ? 'patient_name' THEN (p_updates->>'patient_name')::text ELSE patient_name END,
        status = CASE WHEN p_updates ? 'status' THEN (p_updates->>'status')::text ELSE status END,
        delivery_date = CASE WHEN p_updates ? 'delivery_date' THEN (p_updates->>'delivery_date')::date ELSE delivery_date END,
        cost = CASE WHEN p_updates ? 'cost' THEN (p_updates->>'cost')::numeric ELSE cost END,
        manual_cost = CASE WHEN p_updates ? 'manual_cost' THEN (p_updates->>'manual_cost')::numeric ELSE manual_cost END,
        discount = CASE WHEN p_updates ? 'discount' THEN (p_updates->>'discount')::numeric ELSE discount END,
        total_price = CASE WHEN p_updates ? 'total_price' THEN (p_updates->>'total_price')::numeric ELSE total_price END,
        instructions = CASE WHEN p_updates ? 'instructions' THEN (p_updates->>'instructions')::text ELSE instructions END,
        priority = CASE WHEN p_updates ? 'priority' THEN (p_updates->>'priority')::text ELSE priority END,
        is_urgent = CASE WHEN p_updates ? 'is_urgent' THEN (p_updates->>'is_urgent')::boolean ELSE is_urgent END,
        is_redo = CASE WHEN p_updates ? 'is_redo' THEN (p_updates->>'is_redo')::boolean ELSE is_redo END,
        is_archived = CASE WHEN p_updates ? 'is_archived' THEN (p_updates->>'is_archived')::boolean ELSE is_archived END,

        stl_url = CASE WHEN p_updates ? 'stl_url' THEN (p_updates->>'stl_url')::text ELSE stl_url END,
        images_url = CASE WHEN p_updates ? 'images_url' THEN (p_updates->>'images_url')::text ELSE images_url END,
        supplier_id = CASE WHEN p_updates ? 'supplier_id' THEN (p_updates->>'supplier_id')::uuid ELSE supplier_id END,
        technician_status = CASE WHEN p_updates ? 'technician_status' THEN (p_updates->>'technician_status')::text ELSE technician_status END,
        representative_id = CASE WHEN p_updates ? 'representative_id' THEN (p_updates->>'representative_id')::uuid ELSE representative_id END,
        is_registered = CASE WHEN p_updates ? 'is_registered' THEN (p_updates->>'is_registered')::boolean ELSE is_registered END,
        workflow_type = CASE WHEN p_updates ? 'workflow_type' THEN (p_updates->>'workflow_type')::text ELSE workflow_type END,
        designer_id = CASE WHEN p_updates ? 'designer_id' THEN (p_updates->>'designer_id')::uuid ELSE designer_id END,
        design_url = CASE WHEN p_updates ? 'design_url' THEN (p_updates->>'design_url')::text ELSE design_url END,
        design_status = CASE WHEN p_updates ? 'design_status' THEN (p_updates->>'design_status')::text ELSE design_status END,
        design_price = CASE WHEN p_updates ? 'design_price' THEN (p_updates->>'design_price')::numeric ELSE design_price END,
        actual_delivery_date = CASE WHEN p_updates ? 'actual_delivery_date' THEN (p_updates->>'actual_delivery_date')::date ELSE actual_delivery_date END,
        feedback = CASE WHEN p_updates ? 'feedback' THEN (p_updates->'feedback') ELSE feedback END,
        original_order_id = CASE WHEN p_updates ? 'original_order_id' THEN (p_updates->>'original_order_id')::uuid ELSE original_order_id END,
        status_history = CASE WHEN p_updates ? 'status_history' THEN (p_updates->'status_history') ELSE status_history END,
        rejected_lab_cost = CASE WHEN p_updates ? 'rejected_lab_cost' THEN (p_updates->>'rejected_lab_cost')::numeric ELSE rejected_lab_cost END,

        -- Syncing additions
        production_status = CASE WHEN p_updates ? 'production_status' THEN (p_updates->>'production_status')::text ELSE production_status END,
        issue_state = CASE WHEN p_updates ? 'issue_state' THEN (p_updates->>'issue_state')::text ELSE issue_state END,

        updated_at = NOW()
    WHERE id = p_order_id;

    IF p_items IS NOT NULL THEN
        DELETE FROM order_items WHERE order_id = p_order_id;

        IF jsonb_array_length(p_items) > 0 THEN
            INSERT INTO order_items (
                order_id,
                product_type,
                teeth_numbers,
                price,
                shade,
                count
            )
            SELECT
                p_order_id,
                x->>'product_type',
                x->'teeth_numbers',
                (x->>'price')::numeric,
                x->>'shade',
                COALESCE((x->>'count')::int, 1)
            FROM jsonb_array_elements(p_items) t(x);
        END IF;
    END IF;

    IF p_comments IS NOT NULL THEN
        DELETE FROM order_comments WHERE order_id = p_order_id;

        IF jsonb_array_length(p_comments) > 0 THEN
            INSERT INTO order_comments (
                order_id,
                content,
                user_id,
                user_name,
                created_at
            )
            SELECT
                p_order_id,
                x->>'text',
                (x->>'userId')::uuid,
                x->>'userName',
                (x->>'createdAt')::timestamptz
            FROM jsonb_array_elements(p_comments) t(x);
        END IF;
    END IF;

    SELECT row_to_json(o) INTO v_result FROM orders o WHERE id = p_order_id;
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;

-- 2. Create sync_workflow_states_fn trigger function to keep production_status and issue_state synced with status
CREATE OR REPLACE FUNCTION sync_workflow_states_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Sync issue_state from status if not explicitly updated to a non-none value
    IF TG_OP = 'INSERT' THEN
        IF NEW.issue_state = 'none' OR NEW.issue_state IS NULL THEN
            NEW.issue_state := CASE
                WHEN NEW.status = 'Returned for Adjustments' THEN 'returned'
                WHEN NEW.status = 'Rejected'                 THEN 'rejected'
                WHEN NEW.status = 'Cancelled'                THEN 'cancelled'
                ELSE 'none'
            END;
        END IF;

        IF NEW.production_status = 'not_started' OR NEW.production_status IS NULL THEN
            NEW.production_status := CASE
                WHEN NEW.status IN ('Delivered','Completed')                                   THEN 'final_delivered'
                WHEN NEW.status = 'Try In Approved'                                            THEN 'finalization'
                WHEN NEW.status = 'Ready'  AND NEW.delivery_type = 'TryIn'                     THEN 'try_in_ready'
                WHEN NEW.status = 'Ready'                                                      THEN 'final_ready'
                WHEN NEW.status = 'Try In' AND NEW.delivery_type = 'TryIn'                     THEN 'try_in_ready'
                WHEN NEW.status IN ('Under Production','In Progress')                          THEN 'in_production'
                WHEN NEW.status IN ('Under Design','Waiting Dr Approval')                      THEN 'designing'
                WHEN NEW.status IN ('New Case','Pending','Pending Review')                     THEN 'not_started'
                ELSE 'not_started'
            END;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- If status changed and issue_state didn't change (or was none)
        IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.issue_state = OLD.issue_state OR NEW.issue_state = 'none') THEN
            NEW.issue_state := CASE
                WHEN NEW.status = 'Returned for Adjustments' THEN 'returned'
                WHEN NEW.status = 'Rejected'                 THEN 'rejected'
                WHEN NEW.status = 'Cancelled'                THEN 'cancelled'
                ELSE 'none'
            END;
        END IF;

        -- If status changed and production_status didn't change (or was default)
        IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.production_status = OLD.production_status OR NEW.production_status = 'not_started') THEN
            NEW.production_status := CASE
                WHEN NEW.status IN ('Delivered','Completed')                                   THEN 'final_delivered'
                WHEN NEW.status = 'Try In Approved'                                            THEN 'finalization'
                WHEN NEW.status = 'Ready'  AND NEW.delivery_type = 'TryIn'                     THEN 'try_in_ready'
                WHEN NEW.status = 'Ready'                                                      THEN 'final_ready'
                WHEN NEW.status = 'Try In' AND NEW.delivery_type = 'TryIn'                     THEN 'try_in_ready'
                WHEN NEW.status IN ('Under Production','In Progress')                          THEN 'in_production'
                WHEN NEW.status IN ('Under Design','Waiting Dr Approval')                      THEN 'designing'
                WHEN NEW.status IN ('New Case','Pending','Pending Review')                     THEN 'not_started'
                ELSE NEW.production_status
            END;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_workflow_states ON orders;
CREATE TRIGGER trigger_sync_workflow_states
    BEFORE INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sync_workflow_states_fn();

-- 3. Create log_order_issue_trigger_fn to automatically insert into order_issues when issue_state is activated
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
    v_exists BOOLEAN;
BEGIN
    -- Only log if issue_state is one of 'returned', 'rejected', 'cancelled', 'redo'
    IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo') THEN
        -- Check if this issue is already logged for this order
        SELECT EXISTS(
            SELECT 1 FROM order_issues 
            WHERE order_id = NEW.id AND issue_type = NEW.issue_state
        ) INTO v_exists;

        IF NOT v_exists THEN
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
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_log_order_issues ON orders;
CREATE TRIGGER trigger_log_order_issues
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION log_order_issue_trigger_fn();

-- 4. Backfill existing issues that are not currently in the order_issues table
-- First sync any missing issue_states on existing orders
UPDATE orders 
SET issue_state = CASE status
    WHEN 'Returned for Adjustments' THEN 'returned'
    WHEN 'Rejected'                 THEN 'rejected'
    WHEN 'Cancelled'                THEN 'cancelled'
    ELSE 'none'
END
WHERE issue_state = 'none' AND status IN ('Returned for Adjustments', 'Rejected', 'Cancelled');

-- Then backfill the order_issues table
INSERT INTO order_issues (order_id, issue_type, cause_category, notes, reporter_name, created_at)
SELECT
    o.id,
    o.issue_state,
    'other',
    'تم الترحيل تلقائياً من الحالات السابقة',
    'system',
    COALESCE(o.actual_delivery_date::timestamptz, o.updated_at, o.created_at, NOW())
FROM orders o
WHERE o.issue_state IN ('returned', 'rejected', 'cancelled', 'redo')
  AND NOT EXISTS (
      SELECT 1 FROM order_issues oi 
      WHERE oi.order_id = o.id 
        AND oi.issue_type = o.issue_state
  );
