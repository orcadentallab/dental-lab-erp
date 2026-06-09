-- Migration 088: Representative Order Edits & Admin Approval Workflow
--
-- 1. Updates trigger `orders_role_field_guard` to allow representative to change `items`
--    and allow `total_price` / `cost` / `design_price` only if `items` is also changing.
-- 2. Updates `rep_update_order_fields_with_audit` RPC to:
--    - Add `'instructions'`, `'items'`, `'total_price'`, `'cost'`, `'design_price'` to allowed keys.
--    - If order is delivered (status 'Delivered'/'Completed' or production_status 'final_delivered'),
--      intercept update and save it as a pending proposal in `order_events` with type 'order_edit_proposed'.
--    - If not delivered, apply updates directly to `orders`, write standard field-level events,
--      and write a combined 'order_edit_applied' event.
-- 3. Adds `admin_review_order_edit` RPC for Admin to approve or reject pending proposals.

-- =====================================================================
-- 1. Update orders_role_field_guard Function
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
        -- items is allowed now. total_price/cost/design_price are allowed only if items is changing.
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

    -- Doctor: read-only. Existing RLS already prevents UPDATE; this is defense-in-depth.
    IF v_role = 'doctor' THEN
        RAISE EXCEPTION 'doctor role cannot update orders';
    END IF;

    -- Unknown role: be conservative.
    RAISE EXCEPTION 'role % is not permitted to update orders', v_role;
END $$;


-- =====================================================================
-- 2. Update rep_update_order_fields_with_audit RPC
-- =====================================================================

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
    -- Added items, instructions, total_price, cost, design_price to allowed keys.
    v_allowed_keys CONSTANT TEXT[] := ARRAY[
        'patient_name','stl_url','images_url','delivery_date',
        'is_urgent','priority','supplier_id','designer_id',
        'instructions','items','total_price','cost','design_price'
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

    -- 6. INTERCEPT IF DELIVERED & actor is representative.
    -- If delivered/completed, save as pending proposal event.
    IF v_role = 'representative' AND (v_old.status IN ('Delivered', 'Completed') OR v_old.production_status = 'final_delivered') THEN
        v_metadata := jsonb_build_object(
            'changes', p_changes,
            'oldValues', jsonb_build_object(
                'patient_name', v_old.patient_name,
                'delivery_date', v_old.delivery_date::TEXT,
                'supplier_id', v_old.supplier_id::TEXT,
                'designer_id', v_old.designer_id::TEXT,
                'stl_url', v_old.stl_url,
                'images_url', v_old.images_url,
                'instructions', v_old.instructions,
                'items', v_old.items,
                'total_price', v_old.total_price::TEXT,
                'cost', v_old.cost::TEXT,
                'design_price', v_old.design_price::TEXT,
                'priority', v_old.priority,
                'is_urgent', v_old.is_urgent::TEXT
            ),
            'reasonCode', p_reason_code,
            'note', p_reason_note,
            'actorUserId', v_user_id,
            'actorRole', v_role
        );
        
        INSERT INTO order_events (
            order_id, event_type, approval_status, changed_by, actor_role, reason, notes, metadata
        ) VALUES (
            p_order_id, 'order_edit_proposed', 'pending', v_user_id, v_role, p_reason_code, p_reason_note, v_metadata
        );
        
        RETURN p_order_id;
    END IF;

    -- 7. State guards for undelivered (representative only; admin/lab bypass).
    IF v_role = 'representative' THEN
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

    -- 8. Resolve display names for assignment changes.
    IF p_changes ? 'supplier_id' THEN
        SELECT name INTO v_prev_supplier_name FROM suppliers WHERE id = v_old.supplier_id;
        SELECT name INTO v_new_supplier_name  FROM suppliers WHERE id = (p_changes->>'supplier_id')::UUID;
    END IF;
    IF p_changes ? 'designer_id' THEN
        SELECT name INTO v_prev_designer_name FROM users WHERE id = v_old.designer_id;
        SELECT name INTO v_new_designer_name  FROM users WHERE id = (p_changes->>'designer_id')::UUID;
    END IF;

    -- 9. Write one order_events row per changed field.
    FOREACH v_key IN ARRAY v_changed_keys LOOP
        -- Skip price/cost events directly, or log them as info if items is updated.
        IF v_key IN ('total_price', 'cost', 'design_price') THEN
            CONTINUE;
        END IF;

        v_event_type := CASE v_key
            WHEN 'patient_name'   THEN 'patient_name_changed'
            WHEN 'stl_url'        THEN 'stl_url_changed'
            WHEN 'images_url'     THEN 'images_url_changed'
            WHEN 'delivery_date'  THEN 'delivery_date_changed'
            WHEN 'is_urgent'      THEN 'urgency_changed'
            WHEN 'priority'       THEN 'priority_changed'
            WHEN 'supplier_id'    THEN 'supplier_changed'
            WHEN 'designer_id'    THEN 'designer_changed'
            WHEN 'instructions'   THEN 'instructions_changed'
            WHEN 'items'          THEN 'items_changed'
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
            WHEN 'instructions'   THEN v_old.instructions
            WHEN 'items'          THEN v_old.items::TEXT
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

    -- Write a combined 'order_edit_applied' event for undelivered cases.
    v_metadata := jsonb_build_object(
        'changes', p_changes,
        'oldValues', jsonb_build_object(
            'patient_name', v_old.patient_name,
            'delivery_date', v_old.delivery_date::TEXT,
            'supplier_id', v_old.supplier_id::TEXT,
            'designer_id', v_old.designer_id::TEXT,
            'stl_url', v_old.stl_url,
            'images_url', v_old.images_url,
            'instructions', v_old.instructions,
            'items', v_old.items,
            'total_price', v_old.total_price::TEXT,
            'cost', v_old.cost::TEXT,
            'design_price', v_old.design_price::TEXT,
            'priority', v_old.priority,
            'is_urgent', v_old.is_urgent::TEXT
        ),
        'reasonCode', p_reason_code,
        'note', p_reason_note,
        'actorUserId', v_user_id,
        'actorRole', v_role
    );
    
    INSERT INTO order_events (
        order_id, event_type, approval_status, changed_by, actor_role, reason, notes, metadata
    ) VALUES (
        p_order_id, 'order_edit_applied', 'none', v_user_id, v_role, p_reason_code, p_reason_note, v_metadata
    );

    -- 10. Set tx-local audit flag for the trigger and apply UPDATE.
    PERFORM set_config('app.rep_audit_in_progress', 'true', true);

    UPDATE orders SET
        patient_name  = CASE WHEN p_changes ? 'patient_name'  THEN p_changes->>'patient_name'                       ELSE patient_name  END,
        stl_url       = CASE WHEN p_changes ? 'stl_url'       THEN NULLIF(p_changes->>'stl_url','')                 ELSE stl_url       END,
        images_url    = CASE WHEN p_changes ? 'images_url'    THEN NULLIF(p_changes->>'images_url','')              ELSE images_url    END,
        delivery_date = CASE WHEN p_changes ? 'delivery_date' THEN (p_changes->>'delivery_date')::DATE              ELSE delivery_date END,
        is_urgent     = CASE WHEN p_changes ? 'is_urgent'     THEN (p_changes->>'is_urgent')::BOOLEAN               ELSE is_urgent     END,
        priority      = CASE WHEN p_changes ? 'priority'      THEN p_changes->>'priority'                           ELSE priority      END,
        supplier_id   = CASE WHEN p_changes ? 'supplier_id'   THEN NULLIF(p_changes->>'supplier_id','')::UUID       ELSE supplier_id   END,
        designer_id   = CASE WHEN p_changes ? 'designer_id'   THEN NULLIF(p_changes->>'designer_id','')::UUID       ELSE designer_id   END,
        instructions  = CASE WHEN p_changes ? 'instructions'  THEN NULLIF(p_changes->>'instructions','')            ELSE instructions  END,
        items         = CASE WHEN p_changes ? 'items'         THEN p_changes->'items'                               ELSE items         END,
        total_price   = CASE WHEN p_changes ? 'total_price'   THEN (p_changes->>'total_price')::NUMERIC              ELSE total_price   END,
        cost          = CASE WHEN p_changes ? 'cost'          THEN (p_changes->>'cost')::NUMERIC                     ELSE cost          END,
        design_price  = CASE WHEN p_changes ? 'design_price'  THEN (p_changes->>'design_price')::NUMERIC             ELSE design_price  END
    WHERE id = p_order_id;

    -- 11. Reset flag (defense in depth; tx-local already self-clears).
    PERFORM set_config('app.rep_audit_in_progress', 'false', true);

    RETURN p_order_id;
END $$;


-- =====================================================================
-- 3. Create admin_review_order_edit RPC
-- =====================================================================

CREATE OR REPLACE FUNCTION admin_review_order_edit(
    p_event_id    UUID,
    p_action      TEXT,
    p_admin_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := get_my_role();
    v_admin_user_id UUID;
    v_event RECORD;
    v_changes JSONB;
    v_old_values JSONB;
    v_order_id UUID;
    v_key TEXT;
    v_new_val JSONB;
    v_event_type TEXT;
    v_old_text TEXT;
    v_new_text TEXT;
    v_changed_keys TEXT[];
BEGIN
    -- 1. Auth & role checks.
    SELECT id INTO v_admin_user_id FROM users WHERE auth_id = auth.uid();
    IF v_admin_user_id IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;
    
    IF v_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only admins can review order edits';
    END IF;
    
    IF p_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'action must be approve or reject';
    END IF;
    
    -- 2. Fetch the pending proposal.
    SELECT * INTO v_event FROM order_events 
    WHERE id = p_event_id AND approval_status = 'pending' AND event_type = 'order_edit_proposed'
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending proposal event not found';
    END IF;
    
    v_changes := v_event.metadata->'changes';
    v_old_values := v_event.metadata->'oldValues';
    v_order_id := v_event.order_id;
    v_changed_keys := ARRAY(SELECT jsonb_object_keys(v_changes));
    
    -- 3. If action is approve, apply changes to orders.
    IF p_action = 'approve' THEN
        -- Set auditing bypass flag (just in case) and run update.
        PERFORM set_config('app.rep_audit_in_progress', 'true', true);
        
        UPDATE orders SET
            patient_name  = CASE WHEN v_changes ? 'patient_name'  THEN v_changes->>'patient_name'                       ELSE patient_name  END,
            stl_url       = CASE WHEN v_changes ? 'stl_url'       THEN NULLIF(v_changes->>'stl_url','')                 ELSE stl_url       END,
            images_url    = CASE WHEN v_changes ? 'images_url'    THEN NULLIF(v_changes->>'images_url','')              ELSE images_url    END,
            delivery_date = CASE WHEN v_changes ? 'delivery_date' THEN (v_changes->>'delivery_date')::DATE              ELSE delivery_date END,
            is_urgent     = CASE WHEN v_changes ? 'is_urgent'     THEN (v_changes->>'is_urgent')::BOOLEAN               ELSE is_urgent     END,
            priority      = CASE WHEN v_changes ? 'priority'      THEN v_changes->>'priority'                           ELSE priority      END,
            supplier_id   = CASE WHEN v_changes ? 'supplier_id'   THEN NULLIF(v_changes->>'supplier_id','')::UUID       ELSE supplier_id   END,
            designer_id   = CASE WHEN v_changes ? 'designer_id'   THEN NULLIF(v_changes->>'designer_id','')::UUID       ELSE designer_id   END,
            instructions  = CASE WHEN v_changes ? 'instructions'  THEN NULLIF(v_changes->>'instructions','')            ELSE instructions  END,
            items         = CASE WHEN v_changes ? 'items'         THEN v_changes->'items'                               ELSE items         END,
            total_price   = CASE WHEN v_changes ? 'total_price'   THEN (v_changes->>'total_price')::NUMERIC              ELSE total_price   END,
            cost          = CASE WHEN v_changes ? 'cost'          THEN (v_changes->>'cost')::NUMERIC                     ELSE cost          END,
            design_price  = CASE WHEN v_changes ? 'design_price'  THEN (v_changes->>'design_price')::NUMERIC             ELSE design_price  END
        WHERE id = v_order_id;
        
        PERFORM set_config('app.rep_audit_in_progress', 'false', true);
        
        -- Write individual approved field changes to timeline for audit.
        FOREACH v_key IN ARRAY v_changed_keys LOOP
            -- Skip price/cost fields directly in individual logs.
            IF v_key IN ('total_price', 'cost', 'design_price') THEN
                CONTINUE;
            END IF;

            v_event_type := CASE v_key
                WHEN 'patient_name'   THEN 'patient_name_changed'
                WHEN 'stl_url'        THEN 'stl_url_changed'
                WHEN 'images_url'     THEN 'images_url_changed'
                WHEN 'delivery_date'  THEN 'delivery_date_changed'
                WHEN 'is_urgent'      THEN 'urgency_changed'
                WHEN 'priority'       THEN 'priority_changed'
                WHEN 'supplier_id'    THEN 'supplier_changed'
                WHEN 'designer_id'    THEN 'designer_changed'
                WHEN 'instructions'   THEN 'instructions_changed'
                WHEN 'items'          THEN 'items_changed'
                ELSE 'order_field_changed'
            END;
            
            v_old_text := v_old_values->>v_key;
            v_new_val := v_changes->v_key;
            v_new_text := CASE jsonb_typeof(v_new_val)
                WHEN 'string'  THEN v_new_val #>> '{}'
                WHEN 'null'    THEN NULL
                WHEN 'boolean' THEN v_new_val::TEXT
                WHEN 'number'  THEN v_new_val::TEXT
                ELSE v_new_val::TEXT
            END;
            
            INSERT INTO order_events (
                order_id, event_type, old_value, new_value,
                changed_by, actor_role, reason, notes, severity,
                responsibility_party, metadata, approval_status, approved_by, approved_at
            ) VALUES (
                v_order_id, v_event_type,
                substring(v_old_text from 1 for 4000),
                substring(v_new_text from 1 for 4000),
                v_event.changed_by, v_event.actor_role, v_event.reason, v_event.notes, 'info',
                'representative', v_event.metadata, 'approved', v_admin_user_id, now()
            );
        END LOOP;
        
        -- Update original proposal
        UPDATE order_events SET
            approval_status = 'approved',
            approved_by = v_admin_user_id,
            approved_at = now(),
            notes = coalesce(notes, '') || E'\nApproved Notes: ' || coalesce(p_admin_notes, '')
        WHERE id = p_event_id;
        
    -- 4. If action is reject, just update event status.
    ELSIF p_action = 'reject' THEN
        UPDATE order_events SET
            approval_status = 'rejected',
            approved_by = v_admin_user_id,
            approved_at = now(),
            notes = coalesce(notes, '') || E'\nRejected Notes: ' || coalesce(p_admin_notes, '')
        WHERE id = p_event_id;
    END IF;
END $$;

REVOKE ALL ON FUNCTION admin_review_order_edit(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_review_order_edit(UUID, TEXT, TEXT) TO authenticated;
