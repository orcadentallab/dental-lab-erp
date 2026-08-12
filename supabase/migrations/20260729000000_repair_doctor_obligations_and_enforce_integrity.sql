-- Repair the explicitly approved historical doctor receivables and make the
-- normal delivered-order invariant fail closed for all future writes.

CREATE OR REPLACE FUNCTION public.assert_delivered_doctor_obligation_integrity(
    p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
BEGIN
    SELECT *
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id;

    IF NOT FOUND
       OR COALESCE(v_order.is_deleted, FALSE)
       OR v_order.production_status IS DISTINCT FROM 'final_delivered'
       OR COALESCE(v_order.issue_state, 'none') IN (
           'cancelled',
           'rejected',
           'redo',
           'returned',
           'doctor_rejected',
           'lab_rejected'
       )
       OR v_order.doctor_id IS NULL
       OR COALESCE(v_order.total_price, 0) <= 0 THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.financial_obligations obligation
        WHERE obligation.order_id = v_order.id
          AND obligation.entity_type = 'doctor'
          AND obligation.entity_id = v_order.doctor_id
          AND obligation.direction = 'receivable'
          AND obligation.trigger_type = 'doctor_delivered'
          AND obligation.source = 'order'
          AND obligation.status <> 'void'
          AND obligation.net_amount = v_order.total_price
    ) THEN
        RAISE EXCEPTION
            'Delivered order % must have one matching active doctor receivable',
            v_order.id;
    END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_delivered_doctor_obligation_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_delivered_doctor_obligation_integrity(NEW.id);
    RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_delivered_doctor_obligation_from_obligation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_delivered_doctor_obligation_integrity(
        COALESCE(NEW.order_id, OLD.order_id)
    );
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS constraint_delivered_order_has_doctor_obligation
ON public.orders;
CREATE CONSTRAINT TRIGGER constraint_delivered_order_has_doctor_obligation
AFTER INSERT OR UPDATE OF
    production_status,
    issue_state,
    doctor_id,
    total_price,
    is_deleted
ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.guard_delivered_doctor_obligation_from_order();
DROP TRIGGER IF EXISTS constraint_doctor_obligation_matches_delivered_order
ON public.financial_obligations;
CREATE CONSTRAINT TRIGGER constraint_doctor_obligation_matches_delivered_order
AFTER INSERT OR UPDATE OR DELETE
ON public.financial_obligations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.guard_delivered_doctor_obligation_from_obligation();
REVOKE ALL ON FUNCTION public.assert_delivered_doctor_obligation_integrity(UUID)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_delivered_doctor_obligation_from_order()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_delivered_doctor_obligation_from_obligation()
FROM PUBLIC, anon, authenticated;
CREATE TEMP TABLE approved_doctor_obligation_repair_20260729
ON COMMIT DROP
AS
SELECT
    orders.id AS order_id,
    orders.case_id,
    orders.doctor_id,
    orders.status,
    COALESCE(
        orders.actual_delivery_date,
        orders.delivery_date,
        orders.created_at::DATE,
        CURRENT_DATE
    ) AS trigger_date,
    orders.total_price AS amount
FROM public.orders
WHERE COALESCE(orders.is_deleted, FALSE) = FALSE
  -- Mirror getDoctorReceivableAmount/isDeliveredForDoctorReceivable exactly:
  -- final delivered remains billable during on_hold, while terminal issue
  -- states explicitly cancel the normal delivered receivable.
  AND orders.production_status = 'final_delivered'
  AND COALESCE(orders.issue_state, 'none') NOT IN (
      'cancelled',
      'rejected',
      'redo',
      'returned',
      'doctor_rejected',
      'lab_rejected'
  )
  AND orders.doctor_id IS NOT NULL
  AND COALESCE(orders.total_price, 0) > 0
  AND NOT EXISTS (
      SELECT 1
      FROM public.financial_obligations obligation
      WHERE obligation.order_id = orders.id
        AND obligation.entity_type = 'doctor'
        AND obligation.entity_id = orders.doctor_id
        AND obligation.direction = 'receivable'
        AND obligation.trigger_type = 'doctor_delivered'
        AND obligation.source = 'order'
        AND obligation.status <> 'void'
        AND obligation.net_amount = orders.total_price
  );
DO $$
DECLARE
    v_count INTEGER;
    v_total NUMERIC(12, 2);
    v_actor UUID;
    v_row RECORD;
    v_invalid INTEGER;
BEGIN
    SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_count, v_total
    FROM approved_doctor_obligation_repair_20260729;

    -- A fresh local/test database has no reviewed production batch to repair.
    -- Install the invariant functions and triggers, but skip the production-only guard.
    IF v_count = 0
       AND NOT EXISTS (SELECT 1 FROM public.orders) THEN
        RETURN;
    END IF;

    IF v_count <> 41 OR v_total <> 39450 THEN
        RAISE EXCEPTION
            'Approved doctor repair guard failed: expected 41 / 39450, found % / %',
            v_count,
            v_total;
    END IF;

    SELECT id
    INTO v_actor
    FROM public.users
    WHERE lower(username) = 'sleem'
       OR lower(name) = 'mohamed sleem'
    ORDER BY CASE WHEN lower(username) = 'sleem' THEN 0 ELSE 1 END
    LIMIT 1;

    FOR v_row IN
        SELECT *
        FROM approved_doctor_obligation_repair_20260729
        ORDER BY trigger_date, order_id
    LOOP
        PERFORM public.sync_single_order_obligation(
            v_row.order_id,
            'doctor',
            v_row.doctor_id,
            'receivable',
            'doctor_delivered',
            v_row.status,
            v_row.trigger_date,
            v_row.amount,
            'order',
            jsonb_build_object(
                'caseId', v_row.case_id,
                'historicalRepair', true,
                'approvedCount', 41,
                'approvedTotal', 39450,
                'repairMigration', '20260729000000'
            ),
            v_actor,
            FALSE
        );
    END LOOP;

    SELECT COUNT(*)
    INTO v_invalid
    FROM approved_doctor_obligation_repair_20260729 repair
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.financial_obligations obligation
        WHERE obligation.order_id = repair.order_id
          AND obligation.entity_type = 'doctor'
          AND obligation.entity_id = repair.doctor_id
          AND obligation.direction = 'receivable'
          AND obligation.trigger_type = 'doctor_delivered'
          AND obligation.source = 'order'
          AND obligation.status <> 'void'
          AND obligation.net_amount = repair.amount
    );

    IF v_invalid <> 0 THEN
        RAISE EXCEPTION
            'Doctor obligation repair verification failed for % orders',
            v_invalid;
    END IF;
END;
$$;
COMMENT ON FUNCTION public.assert_delivered_doctor_obligation_integrity(UUID) IS
    'Deferred fail-closed invariant: every normal final-delivered order must have a matching active doctor receivable.';
