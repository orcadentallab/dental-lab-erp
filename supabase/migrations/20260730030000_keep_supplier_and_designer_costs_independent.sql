-- Supplier and designer costs are independent commercial amounts.
-- A split-workflow designer fee must not be deducted from the external lab's
-- recorded order cost.

CREATE OR REPLACE FUNCTION public.sync_full_external_lab_order_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changed_by UUID;
    v_amount NUMERIC;
    v_issue_state TEXT;
    v_is_normal_payable BOOLEAN := FALSE;
BEGIN
    v_issue_state := COALESCE(NEW.issue_state, 'none');

    IF COALESCE(NEW.is_deleted, FALSE)
       OR NEW.supplier_id IS NULL
       OR v_issue_state IN (
            'doctor_rejected',
            'lab_rejected',
            'cancelled',
            'redo',
            'on_hold'
       ) THEN
        RETURN NEW;
    END IF;

    v_is_normal_payable :=
        NEW.production_status IN ('final_ready', 'final_delivered')
        OR (
            v_issue_state = 'returned'
            AND EXISTS (
                SELECT 1
                FROM public.financial_obligations obligation
                WHERE obligation.order_id = NEW.id
                  AND obligation.entity_type = 'external_lab'
                  AND obligation.direction = 'payable'
                  AND obligation.trigger_type = 'external_lab_ready'
                  AND obligation.source = 'order'
                  AND obligation.status <> 'void'
            )
        );

    IF NOT v_is_normal_payable THEN
        RETURN NEW;
    END IF;

    v_amount := COALESCE(NEW.manual_cost, NEW.cost, 0);

    SELECT id
    INTO v_changed_by
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    PERFORM public.sync_single_order_obligation(
        NEW.id,
        'external_lab',
        CASE WHEN v_amount > 0 THEN NEW.supplier_id ELSE NULL END,
        'payable',
        'external_lab_ready',
        NEW.status,
        COALESCE(
            NEW.actual_delivery_date,
            NEW.delivery_date,
            NEW.created_at::DATE,
            CURRENT_DATE
        ),
        CASE WHEN v_amount > 0 THEN v_amount ELSE NULL END,
        'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'productionStatus', NEW.production_status,
            'deliveryType', NEW.delivery_type,
            'supplierAndDesignerCostsIndependent', TRUE
        ),
        v_changed_by,
        FALSE
    );

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zzz_trigger_sync_full_external_lab_order_cost
ON public.orders;
CREATE TRIGGER zzz_trigger_sync_full_external_lab_order_cost
AFTER INSERT OR UPDATE OF
    status,
    production_status,
    issue_state,
    supplier_id,
    cost,
    manual_cost,
    delivery_date,
    actual_delivery_date,
    is_deleted
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_full_external_lab_order_cost();
REVOKE ALL ON FUNCTION public.sync_full_external_lab_order_cost()
FROM PUBLIC, anon, authenticated;
-- Reprice existing normal supplier obligations under the corrected rule.
UPDATE public.orders
SET cost = cost
WHERE COALESCE(is_deleted, FALSE) = FALSE;
DO $verify$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.orders order_row
        JOIN public.financial_obligations obligation
          ON obligation.order_id = order_row.id
         AND obligation.entity_type = 'external_lab'
         AND obligation.direction = 'payable'
         AND obligation.trigger_type = 'external_lab_ready'
         AND obligation.source = 'order'
         AND obligation.status NOT IN ('void', 'written_off')
        WHERE COALESCE(order_row.is_deleted, FALSE) = FALSE
          AND COALESCE(order_row.issue_state, 'none') NOT IN (
              'doctor_rejected',
              'lab_rejected',
              'cancelled',
              'redo',
              'returned',
              'on_hold'
          )
          AND order_row.production_status IN ('final_ready', 'final_delivered')
          AND order_row.supplier_id IS NOT NULL
          AND obligation.entity_id = order_row.supplier_id
          AND obligation.net_amount IS DISTINCT FROM
              COALESCE(order_row.manual_cost, order_row.cost, 0)
    ) THEN
        RAISE EXCEPTION
            'Supplier obligation verification failed after independent-cost repricing';
    END IF;
END;
$verify$;
COMMENT ON FUNCTION public.sync_full_external_lab_order_cost() IS
    'Keeps external lab cost independent from designer cost for normal and preserved returned payables.';
