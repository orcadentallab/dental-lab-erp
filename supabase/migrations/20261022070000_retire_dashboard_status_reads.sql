-- Phase 3: make the dashboard projection and grouping depend only on the V2
-- workflow axes. This replaces a function definition only; it rewrites no
-- order, accounting, obligation, allocation, or transaction rows.

CREATE OR REPLACE FUNCTION public.get_dashboard_data_privileged_20260801()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_role TEXT;
    v_today DATE := CURRENT_DATE;
    v_entity_id UUID;
    v_active_orders JSONB;
    v_delayed_orders JSONB;
    v_unassigned_orders JSONB;
    v_new_orders JSONB;
    v_try_in_approved_orders JSONB;
    v_stats JSONB;
    v_suppliers JSONB;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    v_role := public.get_my_role();
    v_entity_id := public.get_my_entity_id();

    IF v_role = 'production_manager' THEN
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT
                id, case_id, patient_name, delivery_date,
                production_status, issue_state, intake_state, technician_status,
                items, is_urgent, priority, doctor_id
            FROM public.orders
            WHERE supplier_id = v_entity_id
              AND issue_state = 'none'
              AND production_status NOT IN ('final_ready', 'final_delivered')
              AND technician_status IS DISTINCT FROM 'Rejected'
            ORDER BY delivery_date ASC
        ) sub;

        SELECT jsonb_agg(sub) INTO v_delayed_orders FROM (
            SELECT
                id, case_id, patient_name, delivery_date,
                production_status, issue_state, intake_state
            FROM public.orders
            WHERE supplier_id = v_entity_id
              AND delivery_date < v_today
              AND issue_state = 'none'
              AND production_status NOT IN ('final_ready', 'final_delivered')
              AND technician_status IS DISTINCT FROM 'Rejected'
        ) sub;

        SELECT jsonb_build_object(
            'active_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE supplier_id = v_entity_id
                  AND issue_state = 'none'
                  AND production_status NOT IN ('final_ready', 'final_delivered')
                  AND technician_status IS DISTINCT FROM 'Rejected'
            ),
            'delayed_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE supplier_id = v_entity_id
                  AND delivery_date < v_today
                  AND issue_state = 'none'
                  AND production_status NOT IN ('final_ready', 'final_delivered')
            ),
            'rejected_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE supplier_id = v_entity_id
                  AND (issue_state = 'returned' OR technician_status = 'Rejected')
            ),
            'ready_today_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE supplier_id = v_entity_id
                  AND production_status = 'final_ready'
                  AND issue_state = 'none'
                  AND delivery_date = v_today
            )
        ) INTO v_stats;

        SELECT jsonb_agg(sub) INTO v_try_in_approved_orders FROM (
            SELECT
                id, case_id, patient_name, delivery_date,
                production_status, issue_state, intake_state
            FROM public.orders
            WHERE supplier_id = v_entity_id
              AND production_status = 'finalization'
              AND issue_state = 'none'
        ) sub;

        v_result := jsonb_build_object(
            'role', 'lab',
            'stats', v_stats,
            'active_orders', COALESCE(v_active_orders, '[]'::jsonb),
            'delayed_orders', COALESCE(v_delayed_orders, '[]'::jsonb),
            'try_in_approved_orders', COALESCE(v_try_in_approved_orders, '[]'::jsonb)
        );

    ELSIF v_role = 'designer' THEN
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT
                id, case_id, patient_name, delivery_date,
                production_status, issue_state, intake_state, items
            FROM public.orders
            WHERE designer_id = v_user_id
              AND (
                  issue_state = 'returned'
                  OR (
                      issue_state = 'none'
                      AND production_status IN ('not_started', 'designing', 'waiting_doctor')
                  )
              )
        ) sub;

        SELECT jsonb_build_object(
            'pending_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE designer_id = v_user_id
                  AND production_status = 'not_started'
                  AND issue_state = 'none'
            ),
            'in_progress_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE designer_id = v_user_id
                  AND production_status = 'designing'
                  AND issue_state = 'none'
            ),
            'waiting_approval_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE designer_id = v_user_id
                  AND production_status = 'waiting_doctor'
                  AND issue_state = 'none'
            ),
            'returned_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE designer_id = v_user_id
                  AND issue_state = 'returned'
            )
        ) INTO v_stats;

        v_result := jsonb_build_object(
            'role', 'designer',
            'orders', COALESCE(v_active_orders, '[]'::jsonb),
            'stats', v_stats
        );

    ELSE
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT
                id, case_id, patient_name, delivery_date,
                production_status, issue_state, intake_state,
                doctor_id, items, is_urgent, priority, supplier_id,
                technician_status
            FROM public.orders
            WHERE production_status <> 'final_delivered'
              AND issue_state = 'none'
              AND technician_status IS DISTINCT FROM 'Rejected'
              AND v_role IN ('admin', 'accountant', 'coordinator', 'representative')
            ORDER BY delivery_date ASC
            LIMIT 50
        ) sub;

        SELECT jsonb_agg(sub) INTO v_unassigned_orders FROM (
            SELECT
                id, case_id, patient_name, items, delivery_date,
                production_status, issue_state, intake_state
            FROM public.orders
            WHERE supplier_id IS NULL
              AND production_status <> 'final_delivered'
              AND issue_state = 'none'
              AND technician_status IS DISTINCT FROM 'Rejected'
        ) sub;

        SELECT jsonb_agg(sub) INTO v_delayed_orders FROM (
            SELECT
                id, case_id, patient_name, items, delivery_date,
                production_status, issue_state, intake_state,
                is_urgent, priority
            FROM public.orders
            WHERE delivery_date < v_today
              AND production_status <> 'final_delivered'
              AND issue_state = 'none'
              AND technician_status IS DISTINCT FROM 'Rejected'
        ) sub;

        SELECT jsonb_agg(sub) INTO v_new_orders FROM (
            SELECT id, production_status, issue_state, intake_state
            FROM public.orders
            WHERE production_status = 'not_started'
              AND issue_state = 'none'
              AND intake_state = 'accepted'
        ) sub;

        SELECT jsonb_agg(sup_obj) INTO v_suppliers FROM (
            SELECT
                s.id,
                s.name,
                (
                    SELECT jsonb_agg(ord) FROM (
                        SELECT
                            id, case_id, patient_name, items, delivery_date,
                            production_status, issue_state, intake_state
                        FROM public.orders o
                        WHERE o.supplier_id = s.id
                          AND o.production_status <> 'final_delivered'
                          AND o.issue_state = 'none'
                          AND o.technician_status IS DISTINCT FROM 'Rejected'
                    ) ord
                ) AS active_orders
            FROM public.suppliers s
        ) sup_obj;

        SELECT jsonb_build_object(
            'active_count', (
                SELECT COUNT(*) FROM public.orders
                WHERE production_status <> 'final_delivered'
                  AND issue_state = 'none'
                  AND technician_status IS DISTINCT FROM 'Rejected'
            ),
            'delayed_count', jsonb_array_length(COALESCE(v_delayed_orders, '[]'::jsonb)),
            'unassigned_count', jsonb_array_length(COALESCE(v_unassigned_orders, '[]'::jsonb))
        ) INTO v_stats;

        v_result := jsonb_build_object(
            'role', 'admin',
            'stats', v_stats,
            'active_orders', COALESCE(v_active_orders, '[]'::jsonb),
            'delayed_orders', COALESCE(v_delayed_orders, '[]'::jsonb),
            'unassigned_orders', COALESCE(v_unassigned_orders, '[]'::jsonb),
            'new_orders', COALESCE(v_new_orders, '[]'::jsonb),
            'suppliers', COALESCE(v_suppliers, '[]'::jsonb)
        );
    END IF;

    RETURN v_result;
END;
$function$;
