-- Migration 093: Rename 'Rejected' → 'Doctor Rejected' and add 'Lab Rejected'
-- 
-- CHANGES:
--   1. Expand orders.status CHECK constraint to include 'Doctor Rejected' and 'Lab Rejected'
--   2. Expand orders.issue_state CHECK constraint to add 'doctor_rejected' and 'lab_rejected'
--   3. Expand order_issues.issue_type CHECK constraint
--   4. Update sync_workflow_states_fn trigger to handle new statuses
--   5. Update log_order_issue_trigger_fn trigger to handle new issue states
--   6. Update orders_role_field_guard to block lab from setting new issue states
--   7. Data migration: rename all existing 'Rejected' → 'Doctor Rejected'
--   8. Backfill order_issues records for existing data
--
-- FINANCIAL RULE:
--   - 'Doctor Rejected': same financial behavior as old 'Rejected' (rejectedLabCost applies)
--   - 'Lab Rejected': zero financial impact (same as 'Cancelled')
--
-- HARD GUARANTEES:
--   - financial helpers untouched
--   - existing Delivered/Completed/Returned data untouched
--   - RLS policies unchanged

-- =====================================================================
-- 1. Expand orders.status CHECK constraint
-- =====================================================================

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
    'Pending', 'In Progress', 'Completed', 'Delivered',
    'New Case', 'Under Design', 'Waiting Dr Approval', 'Under Production',
    'Try In', 'Try In Approved', 'Ready',
    'Returned for Adjustments',
    'Rejected',           -- kept temporarily for migration safety
    'Doctor Rejected',    -- Doctor returned/rejected the case; rejectedLabCost applies
    'Lab Rejected',       -- Lab/designer rejected; zero financial impact
    'Pending Review', 'Cancelled'
));

-- =====================================================================
-- 2. Expand orders.issue_state CHECK constraint
-- =====================================================================

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_issue_state_check;
ALTER TABLE orders ADD CONSTRAINT orders_issue_state_check CHECK (issue_state IN (
    'none', 'returned', 'rejected', 'cancelled', 'on_hold', 'redo',
    'doctor_rejected',   -- maps to status = 'Doctor Rejected'
    'lab_rejected'       -- maps to status = 'Lab Rejected'
));

-- =====================================================================
-- 3. Expand order_issues.issue_type CHECK constraint
-- =====================================================================

ALTER TABLE order_issues DROP CONSTRAINT IF EXISTS order_issues_issue_type_check;
ALTER TABLE order_issues ADD CONSTRAINT order_issues_issue_type_check CHECK (
    issue_type IN ('returned', 'rejected', 'cancelled', 'redo', 'doctor_rejected', 'lab_rejected')
);

-- =====================================================================
-- 4. Update sync_workflow_states_fn to handle new statuses
-- =====================================================================

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
                WHEN NEW.status = 'Doctor Rejected'          THEN 'doctor_rejected'
                WHEN NEW.status = 'Lab Rejected'             THEN 'lab_rejected'
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
                WHEN NEW.status = 'Doctor Rejected'          THEN 'doctor_rejected'
                WHEN NEW.status = 'Lab Rejected'             THEN 'lab_rejected'
                WHEN NEW.status = 'Cancelled'                THEN 'cancelled'
                ELSE 'none'
            END;
        END IF;

        -- If status changed and production_status didn't change (or was default)
        IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.production_status = OLD.production_status OR NEW.production_status = 'not_started') THEN
            NEW.production_status := CASE
                WHEN NEW.status IN ('Delivered','Completed')                                   THEN 'final_delivered'
                WHEN NEW.status = 'Try In Approved'                                            THEN 'finalization'
                WHEN NEW.status = 'Ready'  AND NEW.delivery_type = 'TryIn' AND COALESCE(OLD.production_status, '') NOT IN ('finalization', 'final_ready', 'final_delivered') THEN 'try_in_ready'
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

-- =====================================================================
-- 5. Update log_order_issue_trigger_fn to handle new issue states
-- =====================================================================

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
        IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo', 'doctor_rejected', 'lab_rejected') THEN
            v_is_transition := TRUE;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo', 'doctor_rejected', 'lab_rejected')
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
                WHEN 'returned'         THEN 'تم الإرجاع للتعديل من لوحة التحكم'
                WHEN 'rejected'         THEN 'تم رفض الحالة من لوحة التحكم'
                WHEN 'doctor_rejected'  THEN 'مرتجع طبيب - تم رفض الحالة من قبل الطبيب'
                WHEN 'lab_rejected'     THEN 'رفض معمل - تم رفض الحالة داخلياً'
                WHEN 'cancelled'        THEN 'تم إلغاء الحالة من لوحة التحكم'
                WHEN 'redo'             THEN 'تم طلب إعادة إنتاج للحالة'
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

DROP TRIGGER IF EXISTS trigger_log_order_issues ON orders;
CREATE TRIGGER trigger_log_order_issues
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION log_order_issue_trigger_fn();

-- =====================================================================
-- 6. Update orders_role_field_guard to block lab from setting new issue states
-- =====================================================================

CREATE OR REPLACE FUNCTION orders_role_field_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := get_my_role();
    v_strict_rep TEXT;
    v_audit_flag TEXT;
BEGIN
    -- Bypass: service role / migrations / unauthenticated.
    IF v_role IS NULL THEN
        RETURN NEW;
    END IF;

    -- Bypass: admin.
    IF v_role = 'admin' THEN
        RETURN NEW;
    END IF;

    -- Lab: existing check_order_update_permissions handles general column
    -- restrictions. Add ONLY the issue_state carve-out here:
    -- lab cannot set doctor_rejected, lab_rejected, or cancelled.
    IF v_role = 'lab' THEN
        IF NEW.issue_state IN ('doctor_rejected','lab_rejected','cancelled')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'lab role cannot set issue_state=%', NEW.issue_state
                USING HINT = 'Only admin can reject or cancel orders';
        END IF;
        RETURN NEW;
    END IF;

    -- Accountant: cannot touch workflow / delivery axes.
    IF v_role = 'accountant' THEN
        IF NEW.production_status   IS DISTINCT FROM OLD.production_status
        OR NEW.issue_state         IS DISTINCT FROM OLD.issue_state
        OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date THEN
            RAISE EXCEPTION 'accountant cannot change workflow fields'
                USING HINT = 'production_status / issue_state / actual_delivery_date are admin/lab only';
        END IF;
        RETURN NEW;
    END IF;

    -- Designer: only design-related columns.
    IF v_role = 'designer' THEN
        IF NEW.production_status   IS DISTINCT FROM OLD.production_status
        OR NEW.issue_state         IS DISTINCT FROM OLD.issue_state
        OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
        OR NEW.total_price         IS DISTINCT FROM OLD.total_price
        OR NEW.cost                IS DISTINCT FROM OLD.cost
        OR NEW.manual_cost         IS DISTINCT FROM OLD.manual_cost
        OR NEW.discount            IS DISTINCT FROM OLD.discount
        OR NEW.rejected_lab_cost   IS DISTINCT FROM OLD.rejected_lab_cost
        OR NEW.doctor_id           IS DISTINCT FROM OLD.doctor_id
        OR NEW.representative_id   IS DISTINCT FROM OLD.representative_id
        OR NEW.supplier_id         IS DISTINCT FROM OLD.supplier_id
        OR NEW.delivery_type       IS DISTINCT FROM OLD.delivery_type
        OR NEW.items               IS DISTINCT FROM OLD.items THEN
            RAISE EXCEPTION 'designer cannot change this field';
        END IF;
        RETURN NEW;
    END IF;

    -- Representative: feature-flag-gated. Default OFF in WF-1.
    IF v_role = 'representative' THEN
        BEGIN
            v_strict_rep := current_setting('app.workflow_strict_rep', true);
        EXCEPTION WHEN OTHERS THEN
            v_strict_rep := NULL;
        END;

        IF v_strict_rep IS DISTINCT FROM 'on' THEN
            -- Strict mode disabled — preserve existing behavior.
            RETURN NEW;
        END IF;

        -- Strict mode active. Only the audited RPC may change anything.
        BEGIN
            v_audit_flag := current_setting('app.rep_audit_in_progress', true);
        EXCEPTION WHEN OTHERS THEN
            v_audit_flag := NULL;
        END;

        IF v_audit_flag IS DISTINCT FROM 'true' THEN
            RAISE EXCEPTION 'representative updates must go through rep_update_order_fields_with_audit'
                USING HINT = 'Direct order UPDATEs by representatives are not allowed when strict workflow mode is on';
        END IF;

        -- Even with audit flag, hard-deny finance/identity/status columns.
        IF NEW.production_status   IS DISTINCT FROM OLD.production_status
        OR NEW.issue_state         IS DISTINCT FROM OLD.issue_state
        OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
        OR (NEW.total_price        IS DISTINCT FROM OLD.total_price AND NEW.items IS NOT DISTINCT FROM OLD.items)
        OR (NEW.cost               IS DISTINCT FROM OLD.cost AND NEW.items IS NOT DISTINCT FROM OLD.items)
        OR (NEW.design_price       IS DISTINCT FROM OLD.design_price AND NEW.items IS NOT DISTINCT FROM OLD.items)
        OR NEW.manual_cost         IS DISTINCT FROM OLD.manual_cost
        OR NEW.discount            IS DISTINCT FROM OLD.discount
        OR NEW.rejected_lab_cost   IS DISTINCT FROM OLD.rejected_lab_cost
        OR NEW.doctor_id           IS DISTINCT FROM OLD.doctor_id
        OR NEW.representative_id   IS DISTINCT FROM OLD.representative_id
        OR NEW.delivery_type       IS DISTINCT FROM OLD.delivery_type
        OR NEW.workflow_type       IS DISTINCT FROM OLD.workflow_type
        OR NEW.is_archived         IS DISTINCT FROM OLD.is_archived
        OR NEW.feedback            IS DISTINCT FROM OLD.feedback
        OR NEW.status              IS DISTINCT FROM OLD.status
        OR NEW.case_id             IS DISTINCT FROM OLD.case_id
        OR NEW.created_at          IS DISTINCT FROM OLD.created_at
        OR NEW.is_registered       IS DISTINCT FROM OLD.is_registered
        OR NEW.design_status       IS DISTINCT FROM OLD.design_status
        OR NEW.technician_status   IS DISTINCT FROM OLD.technician_status
        OR NEW.external_lab_status IS DISTINCT FROM OLD.external_lab_status
        OR NEW.external_lab_notes  IS DISTINCT FROM OLD.external_lab_notes
        OR NEW.design_url          IS DISTINCT FROM OLD.design_url
        OR NEW.shade               IS DISTINCT FROM OLD.shade THEN
            RAISE EXCEPTION 'representative cannot change protected field even via audited RPC';
        END IF;

        RETURN NEW;
    END IF;

    -- Doctor: read-only.
    IF v_role = 'doctor' THEN
        RAISE EXCEPTION 'doctor role cannot update orders';
    END IF;

    -- Unknown role: be conservative.
    RAISE EXCEPTION 'role % is not permitted to update orders', v_role;
END $$;

DROP TRIGGER IF EXISTS trigger_orders_role_field_guard ON orders;
CREATE TRIGGER trigger_orders_role_field_guard
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION orders_role_field_guard();

-- =====================================================================
-- 7. Data Migration: Rename all 'Rejected' → 'Doctor Rejected'
-- =====================================================================

-- Step 7a: Update order status
UPDATE orders
SET
    status = 'Doctor Rejected',
    issue_state = 'doctor_rejected'
WHERE status = 'Rejected';

-- Step 7b: Update status_history JSONB to rename 'Rejected' entries
UPDATE orders
SET status_history = (
    SELECT jsonb_agg(
        CASE
            WHEN entry->>'status' = 'Rejected'
            THEN jsonb_set(entry, '{status}', '"Doctor Rejected"')
            ELSE entry
        END
    )
    FROM jsonb_array_elements(status_history) AS entry
)
WHERE status_history IS NOT NULL
  AND status_history::text LIKE '%"Rejected"%';

-- Step 7c: Update order_issues: rename old 'rejected' type → 'doctor_rejected'
UPDATE order_issues
SET issue_type = 'doctor_rejected'
WHERE issue_type = 'rejected';

-- =====================================================================
-- 8. Now remove the legacy 'Rejected' value from the CHECK constraint
-- (safe after data migration above)
-- =====================================================================

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
    'Pending', 'In Progress', 'Completed', 'Delivered',
    'New Case', 'Under Design', 'Waiting Dr Approval', 'Under Production',
    'Try In', 'Try In Approved', 'Ready',
    'Returned for Adjustments',
    'Doctor Rejected',    -- Doctor returned/rejected the case; rejectedLabCost applies
    'Lab Rejected',       -- Lab/designer rejected; zero financial impact
    'Pending Review', 'Cancelled'
));

-- Also remove old 'rejected' from issue_state constraint (keep doctor_rejected, lab_rejected)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_issue_state_check;
ALTER TABLE orders ADD CONSTRAINT orders_issue_state_check CHECK (issue_state IN (
    'none', 'returned', 'cancelled', 'on_hold', 'redo',
    'doctor_rejected',
    'lab_rejected'
));

-- Also remove old 'rejected' from order_issues issue_type constraint
ALTER TABLE order_issues DROP CONSTRAINT IF EXISTS order_issues_issue_type_check;
ALTER TABLE order_issues ADD CONSTRAINT order_issues_issue_type_check CHECK (
    issue_type IN ('returned', 'cancelled', 'redo', 'doctor_rejected', 'lab_rejected')
);

DO $$ BEGIN
    RAISE NOTICE 'Migration 093 complete: Rejected → Doctor Rejected renamed, Lab Rejected added, triggers updated, data migrated.';
END $$;
