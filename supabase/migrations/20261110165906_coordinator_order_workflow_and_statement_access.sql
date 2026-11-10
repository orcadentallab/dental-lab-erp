BEGIN;

-- Grant the order-card transitions without granting floor management or
-- overriding the independent issue, intake and Design QC guards.
DO $migration$
DECLARE
    v_definition text := pg_get_functiondef('public.orders_role_field_guard()'::regprocedure);
    v_anchor text := '    IF v_role = ANY (ARRAY[''accountant'', ''coordinator'']) THEN';
BEGIN
    IF strpos(v_definition, v_anchor) = 0 THEN
        RAISE EXCEPTION 'Expected coordinator field guard was not found';
    END IF;

    v_definition := replace(v_definition, v_anchor, $guard$
    IF v_role = 'coordinator'
       AND NEW.production_status IS DISTINCT FROM OLD.production_status
       AND COALESCE(OLD.issue_state, 'none') IN ('none', 'returned')
       AND NEW.issue_state IS NOT DISTINCT FROM OLD.issue_state THEN
        IF v_operation = 'record_final_delivery'
           AND COALESCE(OLD.issue_state, 'none') = 'none'
           AND OLD.production_status = 'final_ready' AND NEW.production_status = 'final_delivered'
           AND NEW.design_submitted_at IS NOT DISTINCT FROM OLD.design_submitted_at THEN
            RETURN NEW;
        END IF;

        IF NEW.actual_delivery_date IS NOT DISTINCT FROM OLD.actual_delivery_date
           AND NEW.first_delivered_at IS NOT DISTINCT FROM OLD.first_delivered_at
           AND NEW.design_submitted_at IS NOT DISTINCT FROM OLD.design_submitted_at
           AND (CASE OLD.production_status
               WHEN 'not_started' THEN
                   OLD.intake_state IS DISTINCT FROM 'pending_review'
                   AND (NEW.production_status = 'in_production'
                        OR (NEW.production_status = 'designing' AND OLD.workflow_type = 'split'))
               WHEN 'designing' THEN
                   NEW.production_status = 'in_production'
                   AND (OLD.workflow_type IS DISTINCT FROM 'split'
                        OR NULLIF(OLD.design_url, '') IS NOT NULL
                        OR OLD.design_qc_revision_id IS NOT NULL)
               WHEN 'in_production' THEN
                   NEW.production_status IN ('designing', CASE
                       WHEN lower(OLD.delivery_type) IN ('tryin', 'try_in')
                            AND OLD.issue_state IS DISTINCT FROM 'returned'
                       THEN 'try_in_ready' ELSE 'final_ready' END)
               WHEN 'try_in_ready' THEN NEW.production_status IN ('finalization', 'designing')
               WHEN 'waiting_doctor' THEN NEW.production_status IN ('finalization', 'designing')
               WHEN 'finalization' THEN NEW.production_status = 'final_ready'
               ELSE false
           END) THEN
            RETURN NEW;
        END IF;
    END IF;

$guard$ || v_anchor);

    EXECUTE replace(v_definition,
        '            RAISE EXCEPTION ''accountant cannot change workflow or delivery fields'';',
        $guard$            IF v_role = 'coordinator' THEN
                RAISE EXCEPTION 'انتقال الحالة غير مسموح للمنسق من المرحلة الحالية';
            END IF;
            RAISE EXCEPTION 'accountant cannot change workflow or delivery fields';$guard$);
END;
$migration$;

-- The statement projection exposes other designers' settlement amounts.
-- Keep personal compensation available to the person who earned it.
DO $migration$
DECLARE
    v_definition text := pg_get_functiondef('public.get_design_qc_compensations()'::regprocedure);
    v_anchor text := 'public.get_my_role() IN(''admin'',''accountant'',''coordinator'')';
BEGIN
    IF strpos(v_definition, v_anchor) = 0 THEN
        RAISE EXCEPTION 'Expected designer statement projection was not found';
    END IF;
    EXECUTE replace(v_definition, v_anchor, 'public.get_my_role() IN(''admin'',''accountant'')');
END;
$migration$;

COMMIT;
