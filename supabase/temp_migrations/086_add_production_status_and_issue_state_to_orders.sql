-- Migration 086: Unified Order Workflow Layer (WF-1)
--
-- Adds two SHADOW columns to `orders`:
--   * production_status (8-value operational state)
--   * issue_state       (5-value orthogonal axis)
--
-- Backfills both from the legacy `orders.status` enum + `delivery_type` +
-- `status_history` JSONB. The legacy `orders.status` column is NOT modified
-- and remains authoritative for finance and existing UI behavior.
--
-- Also installs:
--   * Trigger `orders_role_field_guard` (BEFORE UPDATE) — feature-flag-gated
--     for the representative role; admin/lab/accountant/designer rules ship
--     active.
--   * RPC `rep_update_order_fields_with_audit` (SECURITY DEFINER) — the
--     single audit-gated mutation pathway for representative edits, designed
--     to be reused by future workflow operations.
--
-- HARD GUARANTEES:
--   - orders.status enum / values unchanged
--   - financial helpers untouched
--   - existing trigger `check_order_update_permissions` (lab restrictions)
--     untouched
--   - existing trigger `trg_sync_design_status` untouched
--   - RLS policies unchanged
--   - Reps see no behavior change until app.workflow_strict_rep is flipped on.
--
-- Reference: docs/orders-field-permissions.md.

-- =====================================================================
-- 1. Add columns + CHECK constraints
-- =====================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS issue_state TEXT NOT NULL DEFAULT 'none';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_production_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_production_status_check CHECK (production_status IN (
    'not_started','designing','in_production','try_in_ready','waiting_doctor',
    'finalization','final_ready','final_delivered'
));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_issue_state_check;
ALTER TABLE orders ADD CONSTRAINT orders_issue_state_check CHECK (issue_state IN (
    'none','returned','rejected','cancelled','on_hold'
));

-- =====================================================================
-- 2. Indexes
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_orders_production_status ON orders(production_status);
CREATE INDEX IF NOT EXISTS idx_orders_issue_state ON orders(issue_state) WHERE issue_state <> 'none';

-- =====================================================================
-- 3. Backfill — non-terminal legacy statuses
-- =====================================================================
-- HARD RULE: status IN ('Delivered','Completed') always maps to final_delivered,
-- regardless of delivery_type. Existing financial obligations are preserved.

UPDATE orders SET production_status = CASE
    WHEN status IN ('Delivered','Completed')                                   THEN 'final_delivered'
    WHEN status = 'Try In Approved'                                            THEN 'finalization'
    WHEN status = 'Ready'  AND delivery_type = 'TryIn'                         THEN 'try_in_ready'
    WHEN status = 'Ready'                                                      THEN 'final_ready'
    WHEN status = 'Try In' AND delivery_type = 'TryIn'                         THEN 'try_in_ready'
    WHEN status IN ('Under Production','In Progress')                          THEN 'in_production'
    WHEN status IN ('Under Design','Waiting Dr Approval')                      THEN 'designing'
    WHEN status IN ('New Case','Pending','Pending Review')                     THEN 'not_started'
    ELSE production_status
END
WHERE status NOT IN ('Returned for Adjustments','Rejected','Cancelled');

-- =====================================================================
-- 4. Backfill — terminal legacy statuses (status_history-aware)
-- =====================================================================
-- Walk status_history JSONB looking for the most recent non-terminal status,
-- then map it through the same rules as Section 3.
-- Fallbacks per docs/orders-field-permissions.md §2 + plan L.1/L.2:
--   Returned/Rejected → 'final_ready'
--   Cancelled        → 'not_started'

DO $$
DECLARE
    r RECORD;
    v_last_status TEXT;
    v_mapped TEXT;
BEGIN
    FOR r IN SELECT id, status, delivery_type, status_history FROM orders
             WHERE status IN ('Returned for Adjustments','Rejected','Cancelled')
    LOOP
        v_last_status := NULL;

        IF r.status_history IS NOT NULL AND jsonb_typeof(r.status_history) = 'array' THEN
            -- Pick the latest history entry whose status is non-terminal.
            SELECT entry->>'status' INTO v_last_status
            FROM jsonb_array_elements(r.status_history) AS entry
            WHERE entry->>'status' NOT IN ('Returned for Adjustments','Rejected','Cancelled')
            ORDER BY (entry->>'enteredAt') DESC NULLS LAST
            LIMIT 1;
        END IF;

        v_mapped := CASE
            WHEN v_last_status IN ('Delivered','Completed')                             THEN 'final_delivered'
            WHEN v_last_status = 'Try In Approved'                                      THEN 'finalization'
            WHEN v_last_status = 'Ready'  AND r.delivery_type = 'TryIn'                 THEN 'try_in_ready'
            WHEN v_last_status = 'Ready'                                                THEN 'final_ready'
            WHEN v_last_status = 'Try In' AND r.delivery_type = 'TryIn'                 THEN 'try_in_ready'
            WHEN v_last_status IN ('Under Production','In Progress')                    THEN 'in_production'
            WHEN v_last_status IN ('Under Design','Waiting Dr Approval')                THEN 'designing'
            WHEN v_last_status IN ('New Case','Pending','Pending Review')               THEN 'not_started'
            ELSE NULL
        END;

        IF v_mapped IS NULL THEN
            -- Fallback rules (no useful history).
            v_mapped := CASE r.status
                WHEN 'Cancelled' THEN 'not_started'
                ELSE 'final_ready'
            END;
        END IF;

        UPDATE orders SET production_status = v_mapped WHERE id = r.id;
    END LOOP;

    RAISE NOTICE 'production_status backfill complete';
END $$;

-- =====================================================================
-- 5. Backfill — issue_state
-- =====================================================================

UPDATE orders SET issue_state = CASE
    WHEN status = 'Returned for Adjustments' THEN 'returned'
    WHEN status = 'Rejected'                 THEN 'rejected'
    WHEN status = 'Cancelled'                THEN 'cancelled'
    ELSE 'none'
END;

-- =====================================================================
-- 6. orders_role_field_guard trigger
-- =====================================================================
-- Defense-in-depth: enforces field-level role rules at the DB layer.
-- Coexists with existing `check_order_update_permissions` (lab) and
-- `trg_sync_design_status` triggers — disjoint columns/roles.
--
-- Service-role / migration / unauthenticated DDL bypass: get_my_role() returns
-- NULL when auth.uid() doesn't match a row in public.users, so these contexts
-- never trigger any RAISE.
--
-- Representative branch is feature-flag-gated by app.workflow_strict_rep.

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
    -- restrictions (migration 031). Add ONLY the issue_state carve-out here:
    -- lab cannot reject or cancel.
    IF v_role = 'lab' THEN
        IF NEW.issue_state IN ('rejected','cancelled')
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
        OR NEW.total_price         IS DISTINCT FROM OLD.total_price
        OR NEW.cost                IS DISTINCT FROM OLD.cost
        OR NEW.manual_cost         IS DISTINCT FROM OLD.manual_cost
        OR NEW.design_price        IS DISTINCT FROM OLD.design_price
        OR NEW.discount            IS DISTINCT FROM OLD.discount
        OR NEW.rejected_lab_cost   IS DISTINCT FROM OLD.rejected_lab_cost
        OR NEW.doctor_id           IS DISTINCT FROM OLD.doctor_id
        OR NEW.representative_id   IS DISTINCT FROM OLD.representative_id
        OR NEW.items               IS DISTINCT FROM OLD.items   -- WF-1b removes this line
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

    -- Doctor: read-only. Existing RLS already prevents UPDATE; this is defense-in-depth.
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
-- 7. RPC: rep_update_order_fields_with_audit
-- =====================================================================
-- Single audit-gated mutation pathway for representatives. Admin and lab
-- callers may also use it for unified audit trails (their state guards
-- bypass; audit rows still emitted).

CREATE OR REPLACE FUNCTION rep_update_order_fields_with_audit(
    p_order_id    UUID,
    p_changes     JSONB,
    p_reason_code TEXT,
    p_reason_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := get_my_role();
    v_user_id UUID;
    v_old orders%ROWTYPE;
    v_changed_keys TEXT[] := ARRAY(SELECT jsonb_object_keys(p_changes));
    v_allowed_keys CONSTANT TEXT[] := ARRAY[
        'patient_name','stl_url','images_url','delivery_date',
        'is_urgent','priority','supplier_id','designer_id'
    ];
    v_allowed_reasons CONSTANT TEXT[] := ARRAY[
        'doctor_requested','wrong_intake_data','missing_info_completed',
        'scan_updated','images_updated','items_corrected','teeth_corrected',
        'delivery_rescheduled_doctor','delivery_rescheduled_lab',
        'urgent_doctor_requested','external_lab_reassigned',
        'designer_reassigned','internal_correction','other'
    ];
    v_key TEXT;
    v_event_type TEXT;
    v_old_text TEXT;
    v_new_text TEXT;
    v_metadata JSONB;
    v_severity TEXT;
    v_responsibility TEXT;
    v_prev_supplier_name TEXT;
    v_new_supplier_name TEXT;
    v_prev_designer_name TEXT;
    v_new_designer_name TEXT;
    v_new_value JSONB;
BEGIN
    -- 1. Auth.
    SELECT id INTO v_user_id FROM users WHERE auth_id = auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    -- 2. Role check.
    IF v_role NOT IN ('representative','admin','lab') THEN
        RAISE EXCEPTION 'role % cannot use this RPC', v_role;
    END IF;

    -- 3. Reason validation.
    IF p_reason_code IS NULL OR NOT (p_reason_code = ANY(v_allowed_reasons)) THEN
        RAISE EXCEPTION 'invalid reason_code: %', p_reason_code;
    END IF;
    IF p_reason_code = 'other' AND coalesce(btrim(p_reason_note),'') = '' THEN
        RAISE EXCEPTION 'reason_note required when reason_code=other';
    END IF;

    -- 4. Allow-list check.
    IF v_changed_keys IS NULL OR array_length(v_changed_keys, 1) IS NULL THEN
        RAISE EXCEPTION 'no changes provided';
    END IF;
    FOREACH v_key IN ARRAY v_changed_keys LOOP
        IF NOT (v_key = ANY(v_allowed_keys)) THEN
            RAISE EXCEPTION 'field % not in audited rep allow-list', v_key;
        END IF;
    END LOOP;

    -- 5. Lock OLD row.
    SELECT * INTO v_old FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'order % not found', p_order_id;
    END IF;

    -- 6. State guards (representative only; admin/lab bypass).
    IF v_role = 'representative' THEN
        IF v_old.production_status = 'final_delivered' THEN
            RAISE EXCEPTION 'representative cannot edit after final delivery';
        END IF;
        IF v_old.issue_state <> 'none' THEN
            RAISE EXCEPTION 'representative cannot edit while issue_state=%', v_old.issue_state;
        END IF;
        IF p_changes ? 'supplier_id'
           AND v_old.production_status IN ('final_ready','final_delivered') THEN
            RAISE EXCEPTION 'representative cannot reassign supplier after final_ready';
        END IF;
        IF p_changes ? 'designer_id' THEN
            IF v_old.production_status IN ('finalization','final_ready','final_delivered') THEN
                RAISE EXCEPTION 'representative cannot reassign designer after finalization';
            END IF;
            IF v_old.workflow_type IS DISTINCT FROM 'split' THEN
                RAISE EXCEPTION 'representative can only reassign designer in split workflow';
            END IF;
        END IF;
    END IF;

    -- 7. Resolve display names for assignment changes.
    IF p_changes ? 'supplier_id' THEN
        SELECT name INTO v_prev_supplier_name FROM suppliers WHERE id = v_old.supplier_id;
        SELECT name INTO v_new_supplier_name  FROM suppliers WHERE id = (p_changes->>'supplier_id')::UUID;
    END IF;
    IF p_changes ? 'designer_id' THEN
        SELECT name INTO v_prev_designer_name FROM users WHERE id = v_old.designer_id;
        SELECT name INTO v_new_designer_name  FROM users WHERE id = (p_changes->>'designer_id')::UUID;
    END IF;

    -- 8. Write one order_events row per changed field.
    FOREACH v_key IN ARRAY v_changed_keys LOOP
        v_event_type := CASE v_key
            WHEN 'patient_name'   THEN 'patient_name_changed'
            WHEN 'stl_url'        THEN 'stl_url_changed'
            WHEN 'images_url'     THEN 'images_url_changed'
            WHEN 'delivery_date'  THEN 'delivery_date_changed'
            WHEN 'is_urgent'      THEN 'urgency_changed'
            WHEN 'priority'       THEN 'priority_changed'
            WHEN 'supplier_id'    THEN 'supplier_changed'
            WHEN 'designer_id'    THEN 'designer_changed'
            ELSE 'order_field_changed'
        END;

        v_severity := CASE WHEN v_key IN ('supplier_id','designer_id') THEN 'warning' ELSE 'info' END;
        v_responsibility := CASE WHEN v_role = 'representative' THEN 'representative' ELSE NULL END;

        -- Scalar repr for the timeline UI.
        v_old_text := CASE v_key
            WHEN 'patient_name'   THEN v_old.patient_name
            WHEN 'stl_url'        THEN v_old.stl_url
            WHEN 'images_url'     THEN v_old.images_url
            WHEN 'delivery_date'  THEN v_old.delivery_date::TEXT
            WHEN 'is_urgent'      THEN v_old.is_urgent::TEXT
            WHEN 'priority'       THEN v_old.priority
            WHEN 'supplier_id'    THEN v_old.supplier_id::TEXT
            WHEN 'designer_id'    THEN v_old.designer_id::TEXT
            ELSE NULL
        END;

        v_new_value := p_changes -> v_key;
        v_new_text := CASE jsonb_typeof(v_new_value)
            WHEN 'string'  THEN v_new_value #>> '{}'
            WHEN 'null'    THEN NULL
            WHEN 'boolean' THEN v_new_value::TEXT
            WHEN 'number'  THEN v_new_value::TEXT
            ELSE v_new_value::TEXT
        END;

        v_metadata := jsonb_build_object(
            'fieldName',   v_key,
            'oldValue',    to_jsonb(v_old_text),
            'newValue',    v_new_value,
            'reasonCode',  p_reason_code,
            'note',        p_reason_note,
            'source',      CASE v_role
                              WHEN 'representative' THEN 'representative_edit'
                              WHEN 'admin' THEN 'admin_correction'
                              WHEN 'lab' THEN 'lab_operation'
                           END,
            'rpcVersion',  1,
            'actorUserId', v_user_id,
            'actorRole',   v_role
        );

        IF v_key = 'supplier_id' THEN
            v_metadata := v_metadata
                || jsonb_build_object(
                    'previousSupplierId',   v_old.supplier_id,
                    'newSupplierId',        (p_changes->>'supplier_id')::UUID,
                    'previousSupplierName', v_prev_supplier_name,
                    'newSupplierName',      v_new_supplier_name
                );
        ELSIF v_key = 'designer_id' THEN
            v_metadata := v_metadata
                || jsonb_build_object(
                    'previousDesignerId',   v_old.designer_id,
                    'newDesignerId',        (p_changes->>'designer_id')::UUID,
                    'previousDesignerName', v_prev_designer_name,
                    'newDesignerName',      v_new_designer_name
                );
        END IF;

        INSERT INTO order_events (
            order_id, event_type, old_value, new_value,
            changed_by, actor_role, reason, notes, severity,
            responsibility_party, metadata
        ) VALUES (
            p_order_id, v_event_type,
            CASE WHEN v_old_text IS NOT NULL THEN substring(v_old_text from 1 for 4000) ELSE NULL END,
            CASE WHEN v_new_text IS NOT NULL THEN substring(v_new_text from 1 for 4000) ELSE NULL END,
            v_user_id, v_role, p_reason_code, p_reason_note, v_severity,
            v_responsibility, v_metadata
        );
    END LOOP;

    -- 9. Set tx-local audit flag for the trigger and apply UPDATE.
    PERFORM set_config('app.rep_audit_in_progress', 'true', true);

    UPDATE orders SET
        patient_name  = CASE WHEN p_changes ? 'patient_name'  THEN p_changes->>'patient_name'                       ELSE patient_name  END,
        stl_url       = CASE WHEN p_changes ? 'stl_url'       THEN NULLIF(p_changes->>'stl_url','')                 ELSE stl_url       END,
        images_url    = CASE WHEN p_changes ? 'images_url'    THEN NULLIF(p_changes->>'images_url','')              ELSE images_url    END,
        delivery_date = CASE WHEN p_changes ? 'delivery_date' THEN (p_changes->>'delivery_date')::DATE              ELSE delivery_date END,
        is_urgent     = CASE WHEN p_changes ? 'is_urgent'     THEN (p_changes->>'is_urgent')::BOOLEAN               ELSE is_urgent     END,
        priority      = CASE WHEN p_changes ? 'priority'      THEN p_changes->>'priority'                           ELSE priority      END,
        supplier_id   = CASE WHEN p_changes ? 'supplier_id'   THEN NULLIF(p_changes->>'supplier_id','')::UUID       ELSE supplier_id   END,
        designer_id   = CASE WHEN p_changes ? 'designer_id'   THEN NULLIF(p_changes->>'designer_id','')::UUID       ELSE designer_id   END
    WHERE id = p_order_id;

    -- 10. Reset flag (defense in depth; tx-local already self-clears).
    PERFORM set_config('app.rep_audit_in_progress', 'false', true);

    RETURN p_order_id;
END $$;

REVOKE ALL ON FUNCTION rep_update_order_fields_with_audit(UUID, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rep_update_order_fields_with_audit(UUID, JSONB, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION rep_update_order_fields_with_audit(UUID, JSONB, TEXT, TEXT) IS
    'WF-1 unified audit-gated mutation pathway. See docs/orders-field-permissions.md §5.';

-- =====================================================================
-- 8. Notice for migration logs
-- =====================================================================
DO $$ BEGIN
    RAISE NOTICE 'Migration 086 complete: production_status + issue_state added; orders_role_field_guard installed (rep branch flag-gated by app.workflow_strict_rep, default off); rep_update_order_fields_with_audit RPC ready.';
END $$;
