-- Keep an external-lab payable alive while an order is returned, but
-- do not freeze its amount when the order's financial inputs are corrected.
--
-- This is a companion trigger to the canonical synchronization trigger. The
-- canonical trigger preserves an earned payable during returned/cancelled/
-- on-hold lifecycle changes. This trigger runs only for explicit financial
-- changes and atomically replaces that preserved payable with the new amount.

CREATE OR REPLACE FUNCTION public.sync_preserved_external_lab_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changed_by UUID;
    v_is_salaried_designer BOOLEAN := FALSE;
    v_supplier_amount NUMERIC;
BEGIN
    IF COALESCE(NEW.is_deleted, FALSE)
       OR COALESCE(NEW.issue_state, 'none')
            <> 'returned'
       OR (
            NEW.cost IS NOT DISTINCT FROM OLD.cost
            AND NEW.manual_cost IS NOT DISTINCT FROM OLD.manual_cost
            AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
            AND NEW.workflow_type IS NOT DISTINCT FROM OLD.workflow_type
            AND NEW.design_price IS NOT DISTINCT FROM OLD.design_price
            AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id
       )
       OR NOT EXISTS (
            SELECT 1
            FROM public.financial_obligations obligation
            WHERE obligation.order_id = NEW.id
              AND obligation.entity_type = 'external_lab'
              AND obligation.direction = 'payable'
              AND obligation.trigger_type = 'external_lab_ready'
              AND obligation.source = 'order'
              AND obligation.status <> 'void'
       ) THEN
        RETURN NEW;
    END IF;

    IF NEW.designer_id IS NOT NULL THEN
        SELECT COALESCE(
            (custom_permissions->>'designer_fixed_salary')::BOOLEAN,
            FALSE
        )
        INTO v_is_salaried_designer
        FROM public.users
        WHERE id = NEW.designer_id;

        v_is_salaried_designer := COALESCE(
            v_is_salaried_designer,
            FALSE
        );
    END IF;

    v_supplier_amount := CASE
        WHEN NEW.manual_cost IS NOT NULL THEN NEW.manual_cost
        WHEN NEW.workflow_type = 'split' AND NOT v_is_salaried_designer
            THEN GREATEST(
                0,
                COALESCE(NEW.cost, 0) - COALESCE(NEW.design_price, 0)
            )
        ELSE COALESCE(NEW.cost, 0)
    END;

    SELECT id
    INTO v_changed_by
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    PERFORM public.sync_single_order_obligation(
        NEW.id,
        'external_lab',
        CASE
            WHEN NEW.supplier_id IS NOT NULL AND v_supplier_amount > 0
                THEN NEW.supplier_id
            ELSE NULL
        END,
        'payable',
        'external_lab_ready',
        NEW.status,
        COALESCE(
            NEW.actual_delivery_date,
            NEW.delivery_date,
            NEW.created_at::DATE,
            CURRENT_DATE
        ),
        CASE
            WHEN NEW.supplier_id IS NOT NULL AND v_supplier_amount > 0
                THEN v_supplier_amount
            ELSE NULL
        END,
        'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'productionStatus', NEW.production_status,
            'deliveryType', NEW.delivery_type,
            'normalExternalLabPayable', true,
            'preservedIssueStatePriceCorrection', true
        ),
        v_changed_by,
        FALSE
    );

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_sync_preserved_external_lab_price_change
ON public.orders;
CREATE TRIGGER trigger_sync_preserved_external_lab_price_change
AFTER UPDATE OF
    cost,
    manual_cost,
    supplier_id,
    workflow_type,
    design_price,
    designer_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_preserved_external_lab_price_change();
REVOKE ALL ON FUNCTION public.sync_preserved_external_lab_price_change()
FROM PUBLIC, anon, authenticated;
-- Repair the known returned Harmony Lab order through the same atomic
-- obligation replacement path. This voids the stale 740 payable, creates the
-- corrected 850 payable, and transfers active allocations if any.
DO $repair$
DECLARE
    v_order public.orders%ROWTYPE;
    v_obligation public.financial_obligations%ROWTYPE;
    v_is_salaried_designer BOOLEAN := FALSE;
    v_expected_amount NUMERIC(12, 2);
    v_changed_by UUID;
BEGIN
    SELECT *
    INTO v_order
    FROM public.orders
    WHERE case_id = '2005-260706-511'
    FOR UPDATE;

    -- The repaired case belongs to the reviewed production dataset and is not
    -- present when migrations bootstrap a fresh local/test database.
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT *
    INTO STRICT v_obligation
    FROM public.financial_obligations
    WHERE order_id = v_order.id
      AND entity_type = 'external_lab'
      AND direction = 'payable'
      AND trigger_type = 'external_lab_ready'
      AND source = 'order'
      AND status <> 'void'
    FOR UPDATE;

    IF v_order.designer_id IS NOT NULL THEN
        SELECT COALESCE(
            (custom_permissions->>'designer_fixed_salary')::BOOLEAN,
            FALSE
        )
        INTO v_is_salaried_designer
        FROM public.users
        WHERE id = v_order.designer_id;
    END IF;

    v_expected_amount := CASE
        WHEN v_order.manual_cost IS NOT NULL THEN v_order.manual_cost
        WHEN v_order.workflow_type = 'split' AND NOT v_is_salaried_designer
            THEN GREATEST(
                0,
                COALESCE(v_order.cost, 0) - COALESCE(v_order.design_price, 0)
            )
        ELSE COALESCE(v_order.cost, 0)
    END;

    IF NOT v_is_salaried_designer
       OR v_order.cost <> 850
       OR v_expected_amount <> 850 THEN
        RAISE EXCEPTION
            'Returned Harmony repair guard failed: issue=%, salaried=%, cost=%, obligation=%, expected=%',
            v_order.issue_state,
            v_is_salaried_designer,
            v_order.cost,
            v_obligation.net_amount,
            v_expected_amount;
    END IF;

    IF v_obligation.net_amount <> v_expected_amount THEN
        IF v_order.issue_state <> 'returned'
           OR v_obligation.net_amount <> 740 THEN
            RAISE EXCEPTION
                'Returned Harmony repair source guard failed: issue=%, obligation=%',
                v_order.issue_state,
                v_obligation.net_amount;
        END IF;

        SELECT id
        INTO v_changed_by
        FROM public.users
        WHERE auth_id = auth.uid()
        LIMIT 1;

        PERFORM public.sync_single_order_obligation(
            v_order.id,
            'external_lab',
            v_order.supplier_id,
            'payable',
            'external_lab_ready',
            v_order.status,
            COALESCE(
                v_order.actual_delivery_date,
                v_order.delivery_date,
                v_order.created_at::DATE,
                CURRENT_DATE
            ),
            v_expected_amount,
            'order',
            jsonb_build_object(
                'caseId', v_order.case_id,
                'productionStatus', v_order.production_status,
                'deliveryType', v_order.delivery_type,
                'normalExternalLabPayable', true,
                'returnedPriceCorrection', true
            ),
            v_changed_by,
            FALSE
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.financial_obligations obligation
        WHERE obligation.order_id = v_order.id
          AND obligation.entity_type = 'external_lab'
          AND obligation.direction = 'payable'
          AND obligation.trigger_type = 'external_lab_ready'
          AND obligation.source = 'order'
          AND obligation.status <> 'void'
          AND obligation.net_amount = 850
    ) THEN
        RAISE EXCEPTION
            'Returned Harmony repair verification failed for %',
            v_order.case_id;
    END IF;
END;
$repair$;
COMMENT ON FUNCTION public.sync_preserved_external_lab_price_change() IS
    'Reprices an existing external-lab payable when financial inputs change while the order is returned.';
