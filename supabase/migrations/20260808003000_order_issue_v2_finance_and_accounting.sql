-- V2 financial owner consolidation and accounting change trail.
-- Apply only after inspecting the live definitions with the preflight queries
-- below. The feature flags remain OFF until reconciliation succeeds.

BEGIN;

DO $$
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_finance_v2') THEN
        IF EXISTS (SELECT 1 FROM public.orders)
           OR EXISTS (SELECT 1 FROM public.financial_obligations)
           OR EXISTS (SELECT 1 FROM public.transactions) THEN
            RAISE EXCEPTION 'Arm workflow_finance_v2=on only after reviewed reconciliation, then rerun this migration';
        END IF;

        -- A brand-new database has no historical ledger to reconcile, so it
        -- can safely bootstrap Finance V2 before installing its sole writer.
        UPDATE public.app_settings
        SET value = 'on', updated_at = timezone('utc', now())
        WHERE key = 'workflow_finance_v2';
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.financial_obligations
        WHERE status NOT IN ('void', 'written_off')
        GROUP BY order_id, entity_type, direction, trigger_type, source
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Active obligation business-key duplicates must be reconciled before Finance V2';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_obligation_active_business_key
ON public.financial_obligations(order_id, entity_type, direction, trigger_type, source)
WHERE status NOT IN ('void', 'written_off');

CREATE OR REPLACE FUNCTION public.sync_single_order_obligation(
    p_order_id UUID,
    p_entity_type TEXT,
    p_entity_id UUID,
    p_direction TEXT,
    p_trigger_type TEXT,
    p_trigger_status TEXT,
    p_trigger_date DATE,
    p_gross_amount NUMERIC,
    p_source TEXT,
    p_metadata JSONB,
    p_changed_by UUID,
    p_preserve_existing BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing public.financial_obligations%ROWTYPE;
    v_old_id UUID;
    v_new_id UUID;
    v_due_date DATE;
BEGIN
    IF p_preserve_existing THEN RETURN; END IF;

    SELECT * INTO v_existing
    FROM public.financial_obligations
    WHERE order_id = p_order_id
      AND entity_type = p_entity_type
      AND direction = p_direction
      AND trigger_type = p_trigger_type
      AND source = p_source
      AND status NOT IN ('void', 'written_off')
    FOR UPDATE;

    IF FOUND AND p_entity_id IS NOT NULL AND p_gross_amount IS NOT NULL
       AND p_gross_amount >= 0 AND v_existing.entity_id = p_entity_id
       AND v_existing.gross_amount = p_gross_amount
       AND v_existing.trigger_status IS NOT DISTINCT FROM p_trigger_status THEN
        RETURN;
    END IF;

    IF FOUND THEN
        v_old_id := v_existing.id;
        UPDATE public.financial_obligations
        SET status = 'void',
            notes = 'Superseded by atomic order financial synchronization V2',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'voidReason', 'order_financial_state_changed',
                'voidedAt', timezone('utc', now()), 'workflowVersion', 2
            )
        WHERE id = v_old_id;
    END IF;

    IF p_entity_id IS NOT NULL AND p_gross_amount IS NOT NULL AND p_gross_amount >= 0 THEN
        v_due_date := public.calculate_financial_obligation_due_date(p_entity_type, p_entity_id, p_trigger_date);
        INSERT INTO public.financial_obligations(
            order_id, entity_type, entity_id, direction, trigger_type,
            trigger_status, trigger_date, due_date, gross_amount,
            adjustment_amount, net_amount, allocated_amount, status,
            source, metadata, created_by
        ) VALUES (
            p_order_id, p_entity_type, p_entity_id, p_direction, p_trigger_type,
            p_trigger_status, p_trigger_date, v_due_date, p_gross_amount,
            0, p_gross_amount, 0, 'unpaid', p_source,
            COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
                'atomicSync', TRUE, 'workflowVersion', 2, 'replacedObligationId', v_old_id
            ), p_changed_by
        ) RETURNING id INTO v_new_id;
    END IF;

    IF v_old_id IS NOT NULL THEN
        PERFORM public.reallocate_voided_obligation_allocations(v_old_id, v_new_id, p_changed_by);
    END IF;
    IF v_new_id IS NOT NULL THEN
        PERFORM public.apply_entity_credits_fifo(p_entity_type, p_entity_id, p_direction, p_changed_by);
    END IF;
END;
$$;

-- The single financial owner. RPCs only mutate orders; this trigger function
-- reconciles all order-driven obligations in the same PostgreSQL transaction.
CREATE OR REPLACE FUNCTION public.sync_order_financial_obligations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changed_by UUID;
    v_trigger_date DATE;
    v_issue_state TEXT;
    v_is_deleted BOOLEAN;
    v_restored_from_delete BOOLEAN := FALSE;
    v_is_salaried_designer BOOLEAN := FALSE;
    v_doctor_id UUID;
    v_doctor_amount NUMERIC;
    v_supplier_id UUID;
    v_supplier_amount NUMERIC;
    v_designer_id UUID;
    v_designer_amount NUMERIC;
    v_rejected_supplier_id UUID;
    v_rejected_supplier_amount NUMERIC;
    v_rejected_designer_id UUID;
    v_rejected_designer_amount NUMERIC;
    v_preserve_doctor BOOLEAN := FALSE;
    v_preserve_external_lab BOOLEAN := FALSE;
    v_preserve_designer BOOLEAN := FALSE;
BEGIN
    SELECT id INTO v_changed_by
    FROM public.users WHERE auth_id = auth.uid() LIMIT 1;

    v_trigger_date := COALESCE(
        NEW.actual_delivery_date,
        NEW.delivery_date,
        NEW.created_at::DATE,
        CURRENT_DATE
    );
    v_issue_state := COALESCE(NEW.issue_state, 'none');
    v_is_deleted := COALESCE(NEW.is_deleted, FALSE);
    IF TG_OP = 'UPDATE' THEN
        v_restored_from_delete := COALESCE(OLD.is_deleted, FALSE) AND NOT v_is_deleted;
    END IF;
    v_preserve_doctor := v_restored_from_delete OR (NOT v_is_deleted AND v_issue_state = 'returned');
    v_preserve_designer := v_restored_from_delete OR (NOT v_is_deleted AND v_issue_state = 'returned');

    IF NEW.designer_id IS NOT NULL THEN
        SELECT COALESCE((custom_permissions->>'designer_fixed_salary')::BOOLEAN, FALSE)
        INTO v_is_salaried_designer
        FROM public.users WHERE id = NEW.designer_id;
        v_is_salaried_designer := COALESCE(v_is_salaried_designer, FALSE);
    END IF;

    -- A pending doctor decision keeps the lab protected with a full-price
    -- provisional receivable. Final accounting remains blocked until resolved.
    IF NOT v_is_deleted AND NOT v_restored_from_delete AND NEW.doctor_id IS NOT NULL AND (
        (
            NEW.production_status = 'final_delivered'
            AND v_issue_state = 'none'
        ) OR (
            v_issue_state IN ('doctor_rejected', 'redo')
            AND NEW.rejection_doctor_decision IN (
                'decide_later', 'full_price', 'zero', 'custom_amount'
            )
        )
    ) THEN
        v_doctor_amount := CASE
            WHEN v_issue_state IN ('doctor_rejected', 'redo')
                AND NEW.rejection_doctor_decision = 'decide_later'
                THEN COALESCE(NEW.rejected_doctor_amount, NEW.total_price, 0)
            WHEN v_issue_state IN ('doctor_rejected', 'redo') THEN NEW.rejected_doctor_amount
            ELSE COALESCE(NEW.total_price, 0)
        END;
        IF COALESCE(v_doctor_amount, 0) > 0 THEN
            v_doctor_id := NEW.doctor_id;
        ELSE
            v_doctor_amount := NULL;
        END IF;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'doctor', v_doctor_id, 'receivable', 'doctor_delivered',
        COALESCE(NEW.issue_state, NEW.production_status), v_trigger_date,
        v_doctor_amount, 'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'productionStatus', NEW.production_status,
            'issueState', v_issue_state,
            'totalPrice', COALESCE(NEW.total_price, 0),
            'rejectionDoctorDecision', NEW.rejection_doctor_decision,
            'rejectionFinancialReviewStatus', NEW.rejection_financial_review_status
        ),
        v_changed_by, v_preserve_doctor
    );

    -- Returned orders preserve the already-earned normal supplier payable.
    -- Cancelled/Lab Rejected orders do not preserve anything.
    v_preserve_external_lab := v_restored_from_delete OR (
        NOT v_is_deleted AND v_issue_state = 'returned'
    );

    IF NOT v_is_deleted AND NOT v_restored_from_delete
       AND NOT v_preserve_external_lab
       AND v_issue_state = 'none'
       AND NEW.production_status IN ('final_ready', 'final_delivered')
       AND NEW.supplier_id IS NOT NULL THEN
        v_supplier_amount := CASE
            WHEN NEW.manual_cost IS NOT NULL THEN NEW.manual_cost
            WHEN NEW.workflow_type = 'split' AND NOT v_is_salaried_designer
                THEN GREATEST(
                    0,
                    COALESCE(NEW.cost, 0)
                    - COALESCE(NEW.manual_design_price, NEW.design_price, 0)
                )
            ELSE COALESCE(NEW.cost, 0)
        END;
        IF v_supplier_amount > 0 THEN
            v_supplier_id := NEW.supplier_id;
        ELSE
            v_supplier_amount := NULL;
        END IF;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'external_lab', v_supplier_id, 'payable', 'external_lab_ready',
        COALESCE(NEW.issue_state, NEW.production_status), v_trigger_date,
        v_supplier_amount, 'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'productionStatus', NEW.production_status,
            'issueState', v_issue_state,
            'deliveryType', NEW.delivery_type,
            'normalExternalLabPayable', TRUE
        ),
        v_changed_by, v_preserve_external_lab
    );

    IF NOT v_is_deleted AND NOT v_restored_from_delete
       AND v_issue_state = 'none'
       AND NEW.workflow_type = 'split'
       AND NEW.design_status = 'completed'
       AND NEW.designer_id IS NOT NULL
       AND (
            v_is_salaried_designer
            OR COALESCE(NEW.manual_design_price, NEW.design_price, 0) > 0
       ) THEN
        v_designer_id := NEW.designer_id;
        v_designer_amount := CASE
            WHEN v_is_salaried_designer THEN 0
            ELSE COALESCE(NEW.manual_design_price, NEW.design_price, 0)
        END;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'designer', v_designer_id, 'payable', 'designer_approved',
        NEW.design_status, v_trigger_date, v_designer_amount, 'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'designPrice', COALESCE(NEW.design_price, 0),
            'manualDesignPrice', NEW.manual_design_price,
            'effectiveDesignPrice', COALESCE(NEW.manual_design_price, NEW.design_price, 0),
            'workflowType', NEW.workflow_type,
            'isSalariedDesigner', v_is_salaried_designer
        ),
        v_changed_by, v_preserve_designer
    );

    IF NOT v_is_deleted
       AND v_issue_state IN ('doctor_rejected', 'redo')
       AND NEW.supplier_id IS NOT NULL
       AND NEW.rejected_lab_cost_status = 'resolved'
       AND COALESCE(NEW.rejected_lab_cost, 0) > 0 THEN
        v_rejected_supplier_id := NEW.supplier_id;
        v_rejected_supplier_amount := NEW.rejected_lab_cost;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'external_lab', v_rejected_supplier_id, 'payable',
        'external_lab_issue_settlement', v_issue_state, v_trigger_date,
        v_rejected_supplier_amount, 'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'issueState', v_issue_state,
            'rejectionCostStatus', NEW.rejected_lab_cost_status
        ),
        v_changed_by, v_restored_from_delete
    );

    IF NOT v_is_deleted
       AND v_issue_state IN ('doctor_rejected', 'redo')
       AND NEW.designer_id IS NOT NULL
       AND NEW.rejected_designer_cost_status = 'resolved'
       AND COALESCE(NEW.rejected_designer_cost, 0) > 0 THEN
        v_rejected_designer_id := NEW.designer_id;
        v_rejected_designer_amount := NEW.rejected_designer_cost;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'designer', v_rejected_designer_id, 'payable',
        'designer_issue_settlement', v_issue_state, v_trigger_date,
        v_rejected_designer_amount, 'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'issueState', v_issue_state,
            'rejectionCostStatus', NEW.rejected_designer_cost_status
        ),
        v_changed_by, v_restored_from_delete
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_order_financial_obligations ON public.orders;
CREATE TRIGGER trigger_sync_order_financial_obligations
AFTER INSERT OR UPDATE OF
    production_status, issue_state, doctor_id, supplier_id, designer_id,
    total_price, cost, manual_cost, design_price, manual_design_price,
    workflow_type, design_status, delivery_date, actual_delivery_date,
    rejected_lab_cost, rejected_designer_cost, rejection_doctor_decision,
    rejected_doctor_amount, rejection_financial_review_status,
    rejected_lab_cost_status, rejected_designer_cost_status, is_deleted
ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_order_financial_obligations();

-- Remove the second financial writer. The canonical function above now voids
-- zero-impact obligations by passing null entities/amounts to the idempotent
-- single-obligation synchronizer.
DROP TRIGGER IF EXISTS zz_trigger_enforce_zero_order_financials ON public.orders;

CREATE OR REPLACE FUNCTION public.assert_zero_issue_has_no_active_obligations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.issue_state IN ('cancelled', 'lab_rejected') AND EXISTS (
        SELECT 1 FROM public.financial_obligations obligation
        WHERE obligation.order_id = NEW.id
          AND obligation.status NOT IN ('void', 'written_off')
          AND COALESCE(obligation.net_amount, 0) <> 0
    ) THEN
        RAISE EXCEPTION 'Zero-impact issue still has an active financial obligation';
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS constraint_zero_issue_has_no_active_obligations ON public.orders;
CREATE CONSTRAINT TRIGGER constraint_zero_issue_has_no_active_obligations
AFTER INSERT OR UPDATE OF issue_state ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_zero_issue_has_no_active_obligations();

CREATE OR REPLACE FUNCTION public.guard_accounting_registration_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_finance_v2') THEN RETURN NEW; END IF;
    IF NEW.is_registered = TRUE AND OLD.is_registered IS DISTINCT FROM TRUE
       AND NEW.issue_state IN ('doctor_rejected', 'redo')
       AND (
           NEW.rejection_financial_review_status IS DISTINCT FROM 'resolved'
           OR NEW.rejected_lab_cost_status NOT IN ('resolved', 'not_applicable')
           OR NEW.rejected_designer_cost_status NOT IN ('resolved', 'not_applicable')
       ) THEN
        RAISE EXCEPTION 'Accounting registration is blocked until all financial decisions are resolved';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzy_guard_accounting_registration_v2 ON public.orders;
CREATE TRIGGER zzy_guard_accounting_registration_v2
BEFORE UPDATE OF is_registered ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_registration_v2();

-- Accounting trail: one pending queue item, many immutable change rows.
CREATE OR REPLACE FUNCTION public.capture_accounting_review_change_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cycle UUID;
    v_sequence INTEGER;
    v_changed_by UUID;
    v_before JSONB;
    v_after JSONB;
    v_changed_fields JSONB;
    v_ignored TEXT[] := ARRAY[
        'updated_at', 'comments', 'accounting_review_cycle_id',
        'needs_accounting_reregistration', 'is_registered',
        'accounting_snapshot', 'accounting_previous_snapshot',
        'accounting_registered_at', 'accounting_reviewed_by',
        'accounting_last_review_type'
    ];
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_accounting_audit_v2') THEN
        RETURN NEW;
    END IF;

    IF NEW.is_registered = TRUE AND OLD.is_registered = FALSE THEN
        UPDATE public.accounting_review_changes
        SET reviewed_at = timezone('utc', now()), reviewed_by = public.get_my_user_id()
        WHERE review_cycle_id = OLD.accounting_review_cycle_id AND reviewed_at IS NULL;
        NEW.accounting_review_cycle_id := NULL;
        RETURN NEW;
    END IF;

    IF OLD.accounting_snapshot IS NULL THEN
        RETURN NEW;
    END IF;

    v_before := to_jsonb(OLD) - v_ignored;
    v_after := to_jsonb(NEW) - v_ignored;
    SELECT COALESCE(jsonb_object_agg(key, jsonb_build_object('old', v_before->key, 'new', v_after->key)), '{}'::jsonb)
    INTO v_changed_fields
    FROM jsonb_object_keys(v_before || v_after) AS key
    WHERE v_before->key IS DISTINCT FROM v_after->key;

    IF v_changed_fields = '{}'::jsonb THEN
        RETURN NEW;
    END IF;

    v_cycle := COALESCE(OLD.accounting_review_cycle_id, gen_random_uuid());
    NEW.accounting_review_cycle_id := v_cycle;
    NEW.needs_accounting_reregistration := TRUE;
    NEW.is_registered := FALSE;
    SELECT id INTO v_changed_by FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
    SELECT COALESCE(MAX(sequence_no), 0) + 1 INTO v_sequence
    FROM public.accounting_review_changes WHERE review_cycle_id = v_cycle;

    INSERT INTO public.accounting_review_changes(
        order_id, review_cycle_id, sequence_no, changed_by, event_type,
        before_snapshot, after_snapshot, changed_fields
    ) VALUES (
        NEW.id, v_cycle, v_sequence, v_changed_by, 'order_business_change',
        v_before, v_after, v_changed_fields
    );
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zzz_capture_accounting_review_change_v2 ON public.orders;
CREATE TRIGGER zzz_capture_accounting_review_change_v2
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.capture_accounting_review_change_v2();

COMMIT;

-- REQUIRED PREFLIGHT (run before this migration in production):
-- SELECT pg_get_functiondef('public.sync_order_financial_obligations()'::regprocedure);
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
-- WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal ORDER BY tgname;
--
-- REQUIRED POSTFLIGHT:
-- SELECT pg_get_functiondef('public.sync_order_financial_obligations()'::regprocedure);
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
-- WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal ORDER BY tgname;
-- Confirm exactly one financial writer named trigger_sync_order_financial_obligations,
-- manual_design_price in both trigger and function, and no is_archived in the
-- financial trigger column list.
