-- Historical rejected orders can already contain explicit supplier/designer
-- amounts while their newer review-status columns remain pending. An explicit
-- stored amount is an approved historical decision and must be active.
--
-- Also restore the canonical split formula used by the current statements:
-- supplier payable = order cost - non-salaried designer cost.

DROP TRIGGER IF EXISTS zzz_trigger_sync_full_external_lab_order_cost
ON public.orders;
DROP FUNCTION IF EXISTS public.sync_full_external_lab_order_cost();
UPDATE public.orders
SET rejected_lab_cost_status = 'resolved'
WHERE COALESCE(is_deleted, FALSE) = FALSE
  AND COALESCE(issue_state, 'none') IN ('doctor_rejected', 'redo')
  AND supplier_id IS NOT NULL
  AND rejected_lab_cost IS NOT NULL
  AND rejected_lab_cost >= 0
  AND rejected_lab_cost_status IS DISTINCT FROM 'resolved';
UPDATE public.orders
SET rejected_designer_cost_status = 'resolved'
WHERE COALESCE(is_deleted, FALSE) = FALSE
  AND COALESCE(issue_state, 'none') IN ('doctor_rejected', 'redo')
  AND designer_id IS NOT NULL
  AND rejected_designer_cost IS NOT NULL
  AND rejected_designer_cost >= 0
  AND rejected_designer_cost_status IS DISTINCT FROM 'resolved';
-- Re-run the canonical trigger after removing the temporary full-cost override.
UPDATE public.orders
SET status = status,
    cost = cost
WHERE COALESCE(is_deleted, FALSE) = FALSE;
DO $verify$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.orders order_row
        WHERE COALESCE(order_row.is_deleted, FALSE) = FALSE
          AND COALESCE(order_row.issue_state, 'none')
                IN ('doctor_rejected', 'redo')
          AND order_row.supplier_id IS NOT NULL
          AND order_row.rejected_lab_cost IS NOT NULL
          AND order_row.rejected_lab_cost_status <> 'resolved'
    ) THEN
        RAISE EXCEPTION
            'Recorded rejected supplier cost was not activated';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.payment_allocations allocation
        JOIN public.financial_obligations obligation
          ON obligation.id = allocation.obligation_id
        WHERE allocation.status = 'active'
          AND obligation.status = 'void'
    ) THEN
        RAISE EXCEPTION
            'Active allocation points to a void obligation after rejection-cost activation';
    END IF;
END;
$verify$;
