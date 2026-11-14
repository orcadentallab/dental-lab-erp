BEGIN;

-- Declining a pending designer rejection still returns the case to design
-- once the retired compatibility write is removed.
DO $$
DECLARE
    v_definition TEXT := pg_get_functiondef(
        'public.review_designer_rejection_v2(uuid,text,text,uuid,text,text)'::regprocedure
    );
    v_legacy_write CONSTANT TEXT := 'production_status = ''designing'', status = ''Under Design'', updated_at';
    v_approve_branch CONSTANT TEXT := '    IF p_action = ''approve'' AND v_order.issue_state = ''lab_rejected'' THEN';
BEGIN
    IF strpos(v_definition, v_legacy_write) = 0 OR strpos(v_definition, v_approve_branch) = 0 THEN
        RAISE EXCEPTION 'Unexpected definition of review_designer_rejection_v2';
    END IF;
    v_definition := replace(v_definition, v_legacy_write, 'production_status = ''designing'', updated_at');
    v_definition := replace(v_definition, v_approve_branch,
        E'    IF v_order.issue_state = ''lab_rejected'' AND p_action <> ''approve'' THEN\n'
        || E'        RAISE EXCEPTION ''An approved lab rejection requires admin issue correction'' USING ERRCODE = ''22023'';\n'
        || E'    END IF;\n'
        || v_approve_branch);
    EXECUTE v_definition;
END;
$$;

-- Clear the technician rejection in the same audited update that voids the
-- lab issue and lets the financial triggers rebuild the obligations.
DO $$
DECLARE
    v_definition TEXT := pg_get_functiondef(
        'public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)'::regprocedure
    );
    v_preserve_production CONSTANT TEXT := E'            v_target_production := v_order.production_status;\n'
        || E'            v_target_delivery := v_restored_delivery;\n'
        || '            v_target_status := CASE v_order.production_status';
    v_issue_update CONSTANT TEXT := '        issue_state                       = p_target_issue_state,';
BEGIN
    IF strpos(v_definition, v_preserve_production) = 0 OR strpos(v_definition, v_issue_update) = 0 THEN
        RAISE EXCEPTION 'Unexpected definition of admin_correct_order_issue_state_v2';
    END IF;
    v_definition := replace(v_definition, v_preserve_production, $patch$
            v_target_production := CASE
                WHEN v_current = 'lab_rejected' AND p_target_issue_state = 'none'
                     AND v_order.production_status = 'not_started' AND v_order.design_submitted_at IS NULL
                    THEN 'designing'
                ELSE v_order.production_status
            END;
            v_target_delivery := v_restored_delivery;
            v_target_status := CASE v_target_production$patch$);
    v_definition := replace(v_definition, v_issue_update, v_issue_update || $patch$
        technician_status = CASE
            WHEN v_current = 'lab_rejected' AND p_target_issue_state = 'none' THEN 'Approved'
            ELSE technician_status
        END,
        design_status = CASE
            WHEN v_current = 'lab_rejected' AND p_target_issue_state = 'none'
                 AND v_target_production = 'designing' AND v_order.design_submitted_at IS NULL
                THEN 'in_progress'
            ELSE design_status
        END,
        intake_state = CASE
            WHEN v_current = 'lab_rejected' AND p_target_issue_state = 'none' THEN 'accepted'
            ELSE intake_state
        END,$patch$);
    EXECUTE v_definition;
END;
$$;

COMMIT;
