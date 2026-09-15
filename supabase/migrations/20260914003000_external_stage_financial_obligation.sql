-- Migration: 20260914003000_external_stage_financial_obligation.sql
-- Phase D3: Link external production stage runs to financial obligations for accurate external lab payable accounting.

-- 1. Add stage_run_id column to financial_obligations if not present
ALTER TABLE public.financial_obligations
ADD COLUMN IF NOT EXISTS stage_run_id UUID REFERENCES public.production_stage_runs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_financial_obligations_stage_run_id
ON public.financial_obligations(stage_run_id);

-- 2. Widen trigger_type check constraint
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'financial_obligations'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%trigger_type%'
    ) LOOP
        EXECUTE format(
            'ALTER TABLE public.financial_obligations DROP CONSTRAINT IF EXISTS %I',
            r.conname
        );
    END LOOP;
END $$;

ALTER TABLE public.financial_obligations
ADD CONSTRAINT financial_obligations_trigger_type_check
CHECK (trigger_type IN (
    'doctor_delivered',
    'external_lab_ready',
    'external_lab_issue_settlement',
    'designer_approved',
    'designer_issue_settlement',
    'manual_adjustment',
    'external_stage_returned'
));

-- 3. Unique index per stage_run and trigger_type
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_obligation_stage_run
ON public.financial_obligations(stage_run_id, trigger_type)
WHERE stage_run_id IS NOT NULL AND status <> 'void';

-- 4. Update receive_external_work_order to insert financial obligation for the step
CREATE OR REPLACE FUNCTION public.receive_external_work_order(
    p_wo_id       UUID,
    p_returned_at TIMESTAMPTZ DEFAULT NULL,
    p_agreed_cost NUMERIC DEFAULT NULL,
    p_invoice_ref TEXT DEFAULT NULL,
    p_units_ok    INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_wo public.external_work_orders;
    v_order_id UUID;
    v_cost NUMERIC;
BEGIN
    IF NOT public.can_work_production() THEN
        RAISE EXCEPTION 'forbidden: production role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_wo FROM public.external_work_orders WHERE id = p_wo_id FOR UPDATE;
    IF v_wo.id IS NULL THEN
        RAISE EXCEPTION 'external work order % not found', p_wo_id USING ERRCODE = '22023';
    END IF;

    IF v_wo.status = 'returned' THEN
        RETURN jsonb_build_object('workOrderId', p_wo_id, 'alreadyReceived', TRUE);
    END IF;

    v_cost := COALESCE(p_agreed_cost, v_wo.agreed_cost, 0);

    UPDATE public.external_work_orders
       SET returned_at = COALESCE(p_returned_at, NOW()),
           agreed_cost = v_cost,
           invoice_ref = COALESCE(p_invoice_ref, invoice_ref),
           status      = 'returned'
     WHERE id = p_wo_id;

    -- Financial obligation for external step
    IF v_cost > 0 AND v_wo.supplier_id IS NOT NULL AND v_wo.stage_run_id IS NOT NULL THEN
        SELECT pj.order_id INTO v_order_id
        FROM public.production_stage_runs psr
        JOIN public.production_jobs pj ON pj.id = psr.job_id
        WHERE psr.id = v_wo.stage_run_id;

        IF v_order_id IS NOT NULL THEN
            INSERT INTO public.financial_obligations (
                order_id,
                stage_run_id,
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
                status,
                source,
                notes,
                metadata
            ) VALUES (
                v_order_id,
                v_wo.stage_run_id,
                'external_lab',
                v_wo.supplier_id,
                'payable',
                'external_stage_returned',
                'returned',
                CURRENT_DATE,
                CURRENT_DATE + INTERVAL '30 days',
                v_cost,
                0,
                v_cost,
                'unpaid',
                'order',
                'خطوة إنتاج خارجية منفذة',
                jsonb_build_object(
                    'work_order_id', v_wo.id,
                    'invoice_ref', COALESCE(p_invoice_ref, v_wo.invoice_ref),
                    'units', COALESCE(p_units_ok, v_wo.units)
                )
            )
            ON CONFLICT (stage_run_id, trigger_type) WHERE stage_run_id IS NOT NULL AND status <> 'void'
            DO UPDATE SET
                gross_amount = EXCLUDED.gross_amount,
                net_amount = EXCLUDED.net_amount,
                notes = EXCLUDED.notes,
                metadata = EXCLUDED.metadata;
        END IF;
    END IF;

    -- Completing the run stamps the vendor turnaround and opens the next stage.
    RETURN public.complete_stage_run(
        v_wo.stage_run_id,
        COALESCE(p_units_ok, v_wo.units),
        0, NULL, NULL, NULL);
END;
$$;
