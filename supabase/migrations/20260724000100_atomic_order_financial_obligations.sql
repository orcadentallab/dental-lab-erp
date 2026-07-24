-- Approved financial-obligation synchronization.
-- Make order-driven financial obligations synchronous and transaction-atomic.
--
-- This trigger intentionally coexists with the current client-side shadow
-- tracking code. Its operations are idempotent: subsequent client attempts find
-- the already-created obligation, while already-voided obligations are ignored.

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS rejection_doctor_decision TEXT,
ADD COLUMN IF NOT EXISTS rejected_doctor_amount NUMERIC(12, 2),
ADD COLUMN IF NOT EXISTS rejection_financial_review_status TEXT,
ADD COLUMN IF NOT EXISTS rejected_lab_cost_status TEXT,
ADD COLUMN IF NOT EXISTS rejected_designer_cost_status TEXT;

ALTER TABLE public.orders
DROP CONSTRAINT IF EXISTS orders_rejection_doctor_decision_check,
ADD CONSTRAINT orders_rejection_doctor_decision_check CHECK (
    rejection_doctor_decision IS NULL
    OR rejection_doctor_decision IN ('decide_later', 'full_price', 'zero', 'custom_amount')
),
DROP CONSTRAINT IF EXISTS orders_rejected_doctor_amount_check,
ADD CONSTRAINT orders_rejected_doctor_amount_check CHECK (
    rejected_doctor_amount IS NULL
    OR (
        rejected_doctor_amount >= 0
        AND rejected_doctor_amount <= total_price
    )
),
DROP CONSTRAINT IF EXISTS orders_rejection_financial_review_status_check,
ADD CONSTRAINT orders_rejection_financial_review_status_check CHECK (
    rejection_financial_review_status IS NULL
    OR rejection_financial_review_status IN ('pending', 'resolved')
),
DROP CONSTRAINT IF EXISTS orders_rejected_lab_cost_status_check,
ADD CONSTRAINT orders_rejected_lab_cost_status_check CHECK (
    rejected_lab_cost_status IS NULL
    OR rejected_lab_cost_status IN ('pending', 'resolved', 'not_applicable')
),
DROP CONSTRAINT IF EXISTS orders_rejected_designer_cost_status_check,
ADD CONSTRAINT orders_rejected_designer_cost_status_check CHECK (
    rejected_designer_cost_status IS NULL
    OR rejected_designer_cost_status IN ('pending', 'resolved', 'not_applicable')
);

DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT c.conname
    INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'financial_obligations'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%trigger_type%'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.financial_obligations DROP CONSTRAINT %I',
            v_constraint_name
        );
    END IF;
END $$;

ALTER TABLE public.financial_obligations
ADD CONSTRAINT financial_obligations_trigger_type_check
CHECK (trigger_type IN (
    'doctor_delivered',
    'external_lab_ready',
    'external_lab_issue_settlement',
    'designer_approved',
    'designer_issue_settlement',
    'manual_adjustment'
));

CREATE OR REPLACE FUNCTION public.calculate_financial_obligation_due_date(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_trigger_date DATE
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_mode TEXT := 'per_order';
    v_billing_day INTEGER;
    v_due_days INTEGER := 7;
    v_next_month DATE;
    v_last_day INTEGER;
BEGIN
    SELECT billing_mode, billing_day, per_order_due_days
    INTO v_mode, v_billing_day, v_due_days
    FROM public.entity_billing_settings
    WHERE entity_type = p_entity_type
      AND entity_id = p_entity_id;

    IF NOT FOUND OR v_mode = 'per_order' THEN
        RETURN p_trigger_date + COALESCE(v_due_days, 7);
    END IF;

    v_next_month := (date_trunc('month', p_trigger_date) + INTERVAL '1 month')::DATE;
    v_last_day := EXTRACT(
        DAY FROM (v_next_month + INTERVAL '1 month - 1 day')
    )::INTEGER;

    RETURN make_date(
        EXTRACT(YEAR FROM v_next_month)::INTEGER,
        EXTRACT(MONTH FROM v_next_month)::INTEGER,
        LEAST(COALESCE(v_billing_day, 1), v_last_day)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_entity_credits_fifo(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_direction TEXT,
    p_changed_by UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_credit public.account_credits%ROWTYPE;
    v_obligation public.financial_obligations%ROWTYPE;
    v_amount NUMERIC(12, 2);
    v_allocation_id UUID;
BEGIN
    FOR v_credit IN
        SELECT *
        FROM public.account_credits
        WHERE entity_type = p_entity_type
          AND entity_id = p_entity_id
          AND status = 'active'
          AND remaining_amount > 0
          AND source_transaction_id IS NOT NULL
        ORDER BY created_at, id
        FOR UPDATE
    LOOP
        FOR v_obligation IN
            SELECT *
            FROM public.financial_obligations
            WHERE entity_type = p_entity_type
              AND entity_id = p_entity_id
              AND direction = p_direction
              AND status IN ('unpaid', 'partially_paid')
              AND remaining_amount > 0
            ORDER BY due_date, trigger_date, created_at, id
            FOR UPDATE
        LOOP
            EXIT WHEN v_credit.remaining_amount <= 0;

            v_amount := LEAST(
                v_credit.remaining_amount,
                v_obligation.remaining_amount
            );

            IF v_amount <= 0 THEN
                CONTINUE;
            END IF;

            INSERT INTO public.payment_allocations (
                payment_transaction_id,
                obligation_id,
                entity_type,
                entity_id,
                direction,
                allocated_amount,
                allocation_method,
                status,
                allocated_by,
                metadata
            )
            VALUES (
                v_credit.source_transaction_id,
                v_obligation.id,
                p_entity_type,
                p_entity_id,
                p_direction,
                v_amount,
                'credit_auto_apply',
                'active',
                p_changed_by,
                jsonb_build_object(
                    'creditId', v_credit.id,
                    'automaticFifo', true
                )
            )
            RETURNING id INTO v_allocation_id;

            UPDATE public.financial_obligations
            SET allocated_amount = allocated_amount + v_amount,
                status = CASE
                    WHEN allocated_amount + v_amount >= net_amount THEN 'paid'
                    ELSE 'partially_paid'
                END
            WHERE id = v_obligation.id;

            UPDATE public.account_credits
            SET remaining_amount = remaining_amount - v_amount,
                status = CASE
                    WHEN remaining_amount - v_amount <= 0 THEN 'used'
                    ELSE 'active'
                END
            WHERE id = v_credit.id
            RETURNING * INTO v_credit;

            INSERT INTO public.allocation_events (
                event_type,
                allocation_id,
                transaction_id,
                obligation_id,
                credit_id,
                entity_type,
                entity_id,
                amount,
                reason,
                changed_by,
                metadata
            )
            VALUES (
                'credit_applied',
                v_allocation_id,
                v_credit.source_transaction_id,
                v_obligation.id,
                v_credit.id,
                p_entity_type,
                p_entity_id,
                v_amount,
                'automatic FIFO credit application',
                p_changed_by,
                jsonb_build_object('automaticFifo', true)
            );
        END LOOP;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reallocate_voided_obligation_allocations(
    p_voided_obligation_id UUID,
    p_new_obligation_id UUID DEFAULT NULL,
    p_changed_by UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old public.financial_obligations%ROWTYPE;
    v_new public.financial_obligations%ROWTYPE;
    v_allocation public.payment_allocations%ROWTYPE;
    v_amount NUMERIC(12, 2);
    v_remaining NUMERIC(12, 2);
    v_to_allocate NUMERIC(12, 2);
    v_excess NUMERIC(12, 2);
    v_new_allocation_id UUID;
    v_credit_id UUID;
BEGIN
    SELECT *
    INTO v_old
    FROM public.financial_obligations
    WHERE id = p_voided_obligation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF p_new_obligation_id IS NOT NULL THEN
        SELECT *
        INTO v_new
        FROM public.financial_obligations
        WHERE id = p_new_obligation_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Replacement obligation % does not exist', p_new_obligation_id;
        END IF;
    END IF;

    FOR v_allocation IN
        SELECT *
        FROM public.payment_allocations
        WHERE obligation_id = p_voided_obligation_id
          AND status = 'active'
        ORDER BY allocated_at, id
        FOR UPDATE
    LOOP
        v_amount := v_allocation.allocated_amount;
        v_excess := v_amount;

        UPDATE public.payment_allocations
        SET status = 'reversed',
            reversed_by = p_changed_by,
            reversed_at = timezone('utc'::text, now()),
            reversal_reason = 'obligation_voided'
        WHERE id = v_allocation.id;

        UPDATE public.financial_obligations
        SET allocated_amount = GREATEST(0, allocated_amount - v_amount)
        WHERE id = p_voided_obligation_id;

        IF p_new_obligation_id IS NOT NULL THEN
            SELECT *
            INTO v_new
            FROM public.financial_obligations
            WHERE id = p_new_obligation_id
            FOR UPDATE;

            v_remaining := GREATEST(0, v_new.net_amount - v_new.allocated_amount);
            v_to_allocate := LEAST(v_excess, v_remaining);

            IF v_to_allocate > 0 THEN
                INSERT INTO public.payment_allocations (
                    payment_transaction_id,
                    obligation_id,
                    entity_type,
                    entity_id,
                    direction,
                    allocated_amount,
                    allocation_method,
                    status,
                    allocated_by,
                    metadata
                )
                VALUES (
                    v_allocation.payment_transaction_id,
                    p_new_obligation_id,
                    v_new.entity_type,
                    v_new.entity_id,
                    v_new.direction,
                    v_to_allocate,
                    'correction_transfer',
                    'active',
                    p_changed_by,
                    jsonb_build_object(
                        'reallocatedFrom', p_voided_obligation_id,
                        'reallocatedFromAllocationId', v_allocation.id
                    )
                )
                RETURNING id INTO v_new_allocation_id;

                UPDATE public.financial_obligations
                SET allocated_amount = allocated_amount + v_to_allocate,
                    status = CASE
                        WHEN allocated_amount + v_to_allocate >= net_amount THEN 'paid'
                        ELSE 'partially_paid'
                    END
                WHERE id = p_new_obligation_id;

                INSERT INTO public.allocation_events (
                    event_type,
                    allocation_id,
                    transaction_id,
                    obligation_id,
                    entity_type,
                    entity_id,
                    amount,
                    reason,
                    changed_by,
                    metadata
                )
                VALUES (
                    'allocation_transferred',
                    v_new_allocation_id,
                    v_allocation.payment_transaction_id,
                    p_new_obligation_id,
                    v_new.entity_type,
                    v_new.entity_id,
                    v_to_allocate,
                    'reallocated after atomic obligation replacement',
                    p_changed_by,
                    jsonb_build_object(
                        'voidedObligationId', p_voided_obligation_id,
                        'voidedAllocationId', v_allocation.id
                    )
                );

                v_excess := v_excess - v_to_allocate;
            END IF;
        END IF;

        IF v_excess > 0 THEN
            INSERT INTO public.account_credits (
                entity_type,
                entity_id,
                amount,
                remaining_amount,
                source,
                source_transaction_id,
                source_allocation_id,
                source_obligation_id,
                status,
                created_by,
                metadata
            )
            VALUES (
                v_old.entity_type,
                v_old.entity_id,
                v_excess,
                v_excess,
                'correction_excess',
                v_allocation.payment_transaction_id,
                v_allocation.id,
                p_voided_obligation_id,
                'active',
                p_changed_by,
                jsonb_build_object(
                    'voidedObligationId', p_voided_obligation_id,
                    'newObligationId', p_new_obligation_id
                )
            )
            RETURNING id INTO v_credit_id;

            INSERT INTO public.allocation_events (
                event_type,
                credit_id,
                transaction_id,
                obligation_id,
                entity_type,
                entity_id,
                amount,
                reason,
                changed_by,
                metadata
            )
            VALUES (
                'credit_created',
                v_credit_id,
                v_allocation.payment_transaction_id,
                p_voided_obligation_id,
                v_old.entity_type,
                v_old.entity_id,
                v_excess,
                'excess from atomic obligation replacement',
                p_changed_by,
                jsonb_build_object('voidedAllocationId', v_allocation.id)
            );
        END IF;
    END LOOP;

    PERFORM public.apply_entity_credits_fifo(
        v_old.entity_type,
        v_old.entity_id,
        v_old.direction,
        p_changed_by
    );
END;
$$;

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
    IF p_preserve_existing THEN
        RETURN;
    END IF;

    SELECT *
    INTO v_existing
    FROM public.financial_obligations
    WHERE order_id = p_order_id
      AND entity_type = p_entity_type
      AND direction = p_direction
      AND trigger_type = p_trigger_type
      AND source = p_source
      AND status <> 'void'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF p_entity_id IS NOT NULL
       AND p_gross_amount IS NOT NULL
       AND p_gross_amount >= 0
       AND FOUND
       AND v_existing.entity_id = p_entity_id
       AND v_existing.gross_amount = p_gross_amount THEN
        RETURN;
    END IF;

    IF FOUND THEN
        v_old_id := v_existing.id;

        UPDATE public.financial_obligations
        SET status = 'void',
            notes = 'Superseded by atomic order financial synchronization',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'voidReason', 'order_financial_state_changed',
                'voidedAt', timezone('utc'::text, now()),
                'atomicSync', true
            )
        WHERE id = v_old_id;
    END IF;

    IF p_entity_id IS NOT NULL
       AND p_gross_amount IS NOT NULL
       AND p_gross_amount >= 0 THEN
        v_due_date := public.calculate_financial_obligation_due_date(
            p_entity_type,
            p_entity_id,
            p_trigger_date
        );

        INSERT INTO public.financial_obligations (
            order_id,
            entity_type,
            entity_id,
            direction,
            trigger_type,
            trigger_status,
            trigger_date,
            due_date,
            gross_amount,
            adjustment_amount,
            net_amount,
            allocated_amount,
            status,
            source,
            metadata,
            created_by
        )
        VALUES (
            p_order_id,
            p_entity_type,
            p_entity_id,
            p_direction,
            p_trigger_type,
            p_trigger_status,
            p_trigger_date,
            v_due_date,
            p_gross_amount,
            0,
            p_gross_amount,
            0,
            'unpaid',
            p_source,
            COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
                'shadowMode', true,
                'trackingOnly', true,
                'atomicSync', true,
                'replacedObligationId', v_old_id
            ),
            p_changed_by
        )
        RETURNING id INTO v_new_id;
    END IF;

    IF v_old_id IS NOT NULL THEN
        PERFORM public.reallocate_voided_obligation_allocations(
            v_old_id,
            v_new_id,
            p_changed_by
        );
    END IF;

    IF v_new_id IS NOT NULL THEN
        PERFORM public.apply_entity_credits_fifo(
            p_entity_type,
            p_entity_id,
            p_direction,
            p_changed_by
        );
    END IF;
END;
$$;

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
    v_preserve_external_lab BOOLEAN := FALSE;
BEGIN
    SELECT id
    INTO v_changed_by
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

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

    IF NEW.designer_id IS NOT NULL THEN
        SELECT COALESCE((custom_permissions->>'designer_fixed_salary')::BOOLEAN, FALSE)
        INTO v_is_salaried_designer
        FROM public.users
        WHERE id = NEW.designer_id;
        v_is_salaried_designer := COALESCE(v_is_salaried_designer, FALSE);
    END IF;

    IF NOT v_is_deleted
       AND NOT v_restored_from_delete
       AND NEW.doctor_id IS NOT NULL
       AND (
           (
               NEW.production_status = 'final_delivered'
               AND v_issue_state NOT IN (
                   'cancelled',
                   'rejected',
                   'redo',
                   'returned',
                   'doctor_rejected',
                   'lab_rejected'
               )
           )
           OR (
               v_issue_state IN ('doctor_rejected', 'lab_rejected')
               AND NEW.rejection_doctor_decision IS NOT NULL
           )
       ) THEN
        v_doctor_id := NEW.doctor_id;
        v_doctor_amount := CASE
            WHEN v_issue_state IN ('doctor_rejected', 'lab_rejected')
                THEN COALESCE(NEW.rejected_doctor_amount, NEW.total_price, 0)
            ELSE COALESCE(NEW.total_price, 0)
        END;

        IF v_doctor_amount <= 0 THEN
            v_doctor_id := NULL;
            v_doctor_amount := NULL;
        END IF;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id,
        'doctor',
        v_doctor_id,
        'receivable',
        'doctor_delivered',
        NEW.status,
        v_trigger_date,
        v_doctor_amount,
        'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'productionStatus', NEW.production_status,
            'totalPrice', COALESCE(NEW.total_price, 0),
            'rejectionDoctorDecision', NEW.rejection_doctor_decision,
            'rejectionFinancialReviewStatus', NEW.rejection_financial_review_status
        ),
        v_changed_by,
        v_restored_from_delete
    );

    v_preserve_external_lab := v_restored_from_delete OR (
        NOT v_is_deleted
        AND v_issue_state IN (
            'returned',
            'cancelled',
            'on_hold'
        )
    );

    IF NOT v_is_deleted
       AND NOT v_restored_from_delete
       AND NOT v_preserve_external_lab
       AND v_issue_state NOT IN ('doctor_rejected', 'lab_rejected', 'redo')
       AND NEW.production_status IN ('final_ready', 'final_delivered')
       AND NEW.supplier_id IS NOT NULL THEN
        v_supplier_amount := CASE
            WHEN NEW.manual_cost IS NOT NULL THEN NEW.manual_cost
            WHEN NEW.workflow_type = 'split' AND NOT v_is_salaried_designer
                THEN GREATEST(0, COALESCE(NEW.cost, 0) - COALESCE(NEW.design_price, 0))
            ELSE COALESCE(NEW.cost, 0)
        END;

        IF v_supplier_amount > 0 THEN
            v_supplier_id := NEW.supplier_id;
        ELSE
            v_supplier_amount := NULL;
        END IF;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id,
        'external_lab',
        v_supplier_id,
        'payable',
        'external_lab_ready',
        NEW.status,
        v_trigger_date,
        v_supplier_amount,
        'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'productionStatus', NEW.production_status,
            'deliveryType', NEW.delivery_type,
            'normalExternalLabPayable', true
        ),
        v_changed_by,
        v_preserve_external_lab
    );

    IF NOT v_is_deleted
       AND NOT v_restored_from_delete
       AND v_issue_state NOT IN ('doctor_rejected', 'lab_rejected', 'redo')
       AND NEW.workflow_type = 'split'
       AND NEW.design_status = 'completed'
       AND NEW.designer_id IS NOT NULL
       AND (v_is_salaried_designer OR COALESCE(NEW.design_price, 0) > 0) THEN
        v_designer_id := NEW.designer_id;
        v_designer_amount := CASE
            WHEN v_is_salaried_designer THEN 0
            ELSE COALESCE(NEW.design_price, 0)
        END;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id,
        'designer',
        v_designer_id,
        'payable',
        'designer_approved',
        NEW.design_status,
        v_trigger_date,
        v_designer_amount,
        'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'designPrice', COALESCE(NEW.design_price, 0),
            'workflowType', NEW.workflow_type,
            'isSalariedDesigner', v_is_salaried_designer
        ),
        v_changed_by,
        v_restored_from_delete
    );

    IF NOT v_is_deleted
       AND v_issue_state IN ('doctor_rejected', 'lab_rejected', 'redo')
       AND NEW.supplier_id IS NOT NULL
       AND NEW.rejected_lab_cost_status = 'resolved'
       AND COALESCE(NEW.rejected_lab_cost, 0) > 0 THEN
        v_rejected_supplier_id := NEW.supplier_id;
        v_rejected_supplier_amount := NEW.rejected_lab_cost;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id,
        'external_lab',
        v_rejected_supplier_id,
        'payable',
        'external_lab_issue_settlement',
        NEW.status,
        v_trigger_date,
        v_rejected_supplier_amount,
        'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'issueState', v_issue_state,
            'rejectionCostStatus', NEW.rejected_lab_cost_status
        ),
        v_changed_by,
        v_restored_from_delete
    );

    IF NOT v_is_deleted
       AND v_issue_state IN ('doctor_rejected', 'lab_rejected', 'redo')
       AND NEW.designer_id IS NOT NULL
       AND NEW.rejected_designer_cost_status = 'resolved'
       AND COALESCE(NEW.rejected_designer_cost, 0) > 0 THEN
        v_rejected_designer_id := NEW.designer_id;
        v_rejected_designer_amount := NEW.rejected_designer_cost;
    END IF;

    PERFORM public.sync_single_order_obligation(
        NEW.id,
        'designer',
        v_rejected_designer_id,
        'payable',
        'designer_issue_settlement',
        NEW.status,
        v_trigger_date,
        v_rejected_designer_amount,
        'order',
        jsonb_build_object(
            'caseId', NEW.case_id,
            'issueState', v_issue_state,
            'rejectionCostStatus', NEW.rejected_designer_cost_status
        ),
        v_changed_by,
        v_restored_from_delete
    );

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_financially_active_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE(OLD.is_deleted, FALSE) = FALSE
       AND COALESCE(NEW.is_deleted, FALSE) = TRUE
       AND EXISTS (
           SELECT 1
           FROM public.financial_obligations obligation
           WHERE obligation.order_id = OLD.id
             AND obligation.status NOT IN ('void', 'written_off')
       ) THEN
        RAISE EXCEPTION
            'Financially active orders cannot be deleted; use an explicit financial cancellation';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reallocate_voided_obligation_allocations(UUID, UUID, UUID)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_entity_credits_fifo(TEXT, UUID, TEXT, UUID)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_single_order_obligation(
    UUID, TEXT, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, TEXT, JSONB, UUID, BOOLEAN
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_order_financial_obligations()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_financially_active_order_delete()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_order_financial_obligations() IS
    'Synchronizes order-driven obligations, allocation transfers, and credits in the same transaction as the order write.';
