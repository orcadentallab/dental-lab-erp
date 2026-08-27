-- Phase 5: True Crown Cost, Cost of Quality, Material Efficiency & Overhead Allocation
-- Migration: 20260827003000_production_costing_and_profitability.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. Labor Rates Table (Piece-rate / Standard hourly labor per stage)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.labor_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES public.production_stages(id) ON DELETE CASCADE,
    rate_per_unit NUMERIC(10,2) NOT NULL CHECK (rate_per_unit >= 0),
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_labor_rates_lookup 
ON public.labor_rates (stage_id, employee_id, effective_from DESC);

-- Unique index ensuring one active rate per (employee/null, stage, effective_from)
CREATE UNIQUE INDEX IF NOT EXISTS uq_labor_rates_stage_employee_date 
ON public.labor_rates (
    stage_id, 
    COALESCE(employee_id, '00000000-0000-0000-0000-000000000000'::uuid), 
    effective_from
);

ALTER TABLE public.labor_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "labor_rates_read" ON public.labor_rates
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'accountant'));

CREATE POLICY "labor_rates_write" ON public.labor_rates
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('admin', 'accountant'))
    WITH CHECK (public.get_my_role() IN ('admin', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_rates TO authenticated;


--------------------------------------------------------------------------------
-- 2. Overhead Allocation Runs (Monthly frozen overhead pools)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.overhead_allocation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_month DATE NOT NULL UNIQUE,
    total_overhead NUMERIC(12,2) NOT NULL CHECK (total_overhead >= 0),
    total_units INTEGER NOT NULL CHECK (total_units > 0),
    rate_per_unit NUMERIC(10,2) GENERATED ALWAYS AS (ROUND(total_overhead / total_units, 2)) STORED,
    frozen_at TIMESTAMPTZ DEFAULT now(),
    notes TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overhead_period ON public.overhead_allocation_runs (period_month DESC);

ALTER TABLE public.overhead_allocation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "overhead_runs_read" ON public.overhead_allocation_runs
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'accountant'));

-- Deliberately NO direct write policy and no INSERT/UPDATE/DELETE grant. A
-- frozen period is the denominator under every historical cost report; if it
-- could be rewritten straight through PostgREST, the freeze guard in the RPC
-- below would be decoration. freeze_overhead_allocation is SECURITY DEFINER and
-- is the only way in.
GRANT SELECT ON public.overhead_allocation_runs TO authenticated;


--------------------------------------------------------------------------------
-- 3. Atomic RPC: Freeze Monthly Overhead Allocation
--------------------------------------------------------------------------------
-- ANALYTICAL NUMBER ONLY -- plan section 3.
-- Overhead is an internal cost. It is a reporting figure and a salary/expense
-- line; it must never become a financial_obligation. Recording it as both an
-- obligation and a payroll expense would double-count the P&L, which is the
-- single most dangerous mistake available in this cutover.
--
-- "Frozen" has to mean frozen. An overwritten period silently restates every
-- cost report that already used it, so a second freeze of the same month is
-- refused unless the caller says out loud that it is refreezing.
CREATE OR REPLACE FUNCTION public.freeze_overhead_allocation(
    p_period_month DATE,
    p_total_overhead NUMERIC,
    p_total_units INTEGER,
    p_notes TEXT DEFAULT NULL,
    p_refreeze BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT;
    v_norm_period DATE;
    v_user_id UUID;
    v_run RECORD;
    v_existing public.overhead_allocation_runs%ROWTYPE;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Forbidden: only admin or accountant can record overhead allocation'
            USING ERRCODE = '42501';
    END IF;

    IF p_total_overhead < 0 THEN
        RAISE EXCEPTION 'Total overhead cannot be negative' USING ERRCODE = '22003';
    END IF;

    IF p_total_units <= 0 THEN
        RAISE EXCEPTION 'Total units must be greater than zero' USING ERRCODE = '22003';
    END IF;

    v_norm_period := date_trunc('month', p_period_month)::date;

    SELECT * INTO v_existing
      FROM public.overhead_allocation_runs
     WHERE period_month = v_norm_period;

    IF FOUND AND NOT COALESCE(p_refreeze, FALSE) THEN
        RAISE EXCEPTION
            'الشهر % متقفل بالفعل بمعدل %/وحدة منذ %. إعادة التجميد بتغيّر كل تقارير التكلفة التاريخية — ابعت p_refreeze => true لو ده مقصود',
            to_char(v_norm_period, 'YYYY-MM'), v_existing.rate_per_unit, v_existing.frozen_at
            USING ERRCODE = '55006';
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;

    INSERT INTO public.overhead_allocation_runs (
        period_month,
        total_overhead,
        total_units,
        notes,
        created_by,
        frozen_at
    )
    VALUES (
        v_norm_period,
        p_total_overhead,
        p_total_units,
        p_notes,
        v_user_id,
        now()
    )
    ON CONFLICT (period_month) DO UPDATE
    SET total_overhead = EXCLUDED.total_overhead,
        total_units    = EXCLUDED.total_units,
        notes          = EXCLUDED.notes,
        frozen_at      = now()
    RETURNING * INTO v_run;

    RETURN jsonb_build_object(
        'id', v_run.id,
        'period_month', v_run.period_month,
        'total_overhead', v_run.total_overhead,
        'total_units', v_run.total_units,
        'rate_per_unit', v_run.rate_per_unit,
        'frozen_at', v_run.frozen_at,
        'was_refreeze', (v_existing.id IS NOT NULL)
    );
END;
$$;


--------------------------------------------------------------------------------
-- 4. Atomic RPC: Detailed Unit Cost Breakdown for an Order
--------------------------------------------------------------------------------
-- ANALYTICAL NUMBER ONLY -- plan section 3.
-- Internal cost (labour, materials, overhead) is an EXPENSE via transactions
-- and payroll. It must never be written to financial_obligations, and it must
-- never be written back to orders.cost. This function only reads. Booking the
-- same internal cost as both an obligation and a salary would double-count the
-- P&L -- the worst mistake available in this cutover.
CREATE OR REPLACE FUNCTION public.get_order_cost_breakdown(
    p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT;
    v_order RECORD;
    v_materials_cost NUMERIC(10,2) := 0;
    v_labor_cost NUMERIC(10,2) := 0;
    v_external_cost NUMERIC(10,2) := 0;
    v_overhead_cost NUMERIC(10,2) := 0;
    v_overhead_rate NUMERIC(10,2) := 0;
    v_overhead_status TEXT := 'not_allocated';
    v_total_units INTEGER := 1;
    v_order_month DATE;
    v_has_internal_runs BOOLEAN := false;
    v_material_details JSONB := '[]'::jsonb;
    v_labor_details JSONB := '[]'::jsonb;
    v_external_details JSONB := '[]'::jsonb;
    v_total_cost NUMERIC(10,2) := 0;
    v_is_billable BOOLEAN := TRUE;
    v_total_price NUMERIC(12,2) := 0;
    v_estimated_materials BOOLEAN := FALSE;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'lab') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order.id IS NULL THEN
        RETURN jsonb_build_object(
            'order_id', p_order_id,
            'case_id', null,
            'total_cost', 0,
            'cost_per_unit', 0,
            'materials_cost', 0,
            'labor_cost', 0,
            'external_cost', 0,
            'overhead_cost', 0
        );
    END IF;

    -- Units come from order_items, the normalised table every other part of the
    -- system uses (0460_normalize_schema). orders.items is the pre-normalisation
    -- JSONB column and is populated on well under half the live order base --
    -- reading it returned 1 unit for most orders and quietly corrupted
    -- cost_per_unit, overhead_cost and margin_percent.
    SELECT COALESCE(SUM(GREATEST(COALESCE(oi.count, 1), 1)), 0)
      INTO v_total_units
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id;

    IF v_total_units IS NULL OR v_total_units <= 0 THEN
        v_total_units := 1;
    END IF;

    v_order_month := date_trunc('month', COALESCE(v_order.delivery_date, v_order.created_at::date))::date;

    -- A cancelled or lab-rejected case was never worked: zero cost AND zero
    -- revenue, everywhere. orders.cost keeps a stale estimate on these rows, so
    -- reading it raw would invent a loss on a case that cost nothing.
    v_is_billable := COALESCE(v_order.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected')
                     AND COALESCE(v_order.status, '') NOT IN ('Cancelled', 'Lab Rejected');

    IF NOT v_is_billable THEN
        RETURN jsonb_build_object(
            'order_id', p_order_id,
            'case_id', v_order.case_id,
            'is_internal_production', FALSE,
            'is_billable', FALSE,
            'zero_reason', 'cancelled_or_lab_rejected',
            'total_units', v_total_units,
            'total_price', 0,
            'materials_cost', 0,
            'labor_cost', 0,
            'external_cost', 0,
            'overhead_cost', 0,
            'overhead_rate_applied', 0,
            'overhead_status', 'not_applicable',
            'total_cost', 0,
            'cost_per_unit', 0,
            'gross_profit', 0,
            'margin_percent', 0,
            'details', jsonb_build_object(
                'materials', '[]'::jsonb, 'labor', '[]'::jsonb, 'external', '[]'::jsonb)
        );
    END IF;

    v_total_price := COALESCE(v_order.total_price, 0);

    -- "Internal" means somebody in this building actually worked a step -- not
    -- merely that a job row exists. Since 20260827000000 every order gets a
    -- stage chain automatically, so testing for the existence of stage runs
    -- classified ordinary outsourced cases as internal, dropped orders.cost,
    -- and reported them at zero cost and 100% margin.
    --
    -- is_backfilled is the other half of that test, and it is not optional.
    -- 20260821003000 reconstructed a chain for 1152 historical orders, 277 of
    -- which carry a completed internal design stage. Those cases were milled
    -- outside; their real cost is the vendor invoice. driven_by alone does not
    -- exclude them -- the column is new and every pre-existing row inherits its
    -- 'my_tasks' default -- so without this they would read as in-house work
    -- done at no cost.
    SELECT EXISTS (
        SELECT 1
          FROM public.production_jobs pj
          JOIN public.production_stage_runs psr ON psr.job_id = pj.id
         WHERE pj.order_id = p_order_id
           AND NOT pj.is_backfilled
           AND psr.execution = 'internal'
           AND psr.driven_by <> 'order_status'
           AND psr.status = 'done'
    ) INTO v_has_internal_runs;

    IF v_has_internal_runs THEN
        -- 1. Direct Materials: Measured usage from material_batch_usage + material_batches
        -- Two clearly separated numbers, exactly as plan 4.7 requires:
        --   actual    = unit_cost / units actually attributed, once the disc is
        --               depleted and the truth is known.
        --   estimated = unit_cost / expected_units_per_batch, while it is open.
        -- When a material has no expected yield recorded, there is no third
        -- option: the cost is NULL and the caller must show "not costed yet".
        -- The previous fallback divided by a hard-coded 15 -- an invented
        -- denominator producing an invented cost, which plan 4.7 forbids.
        SELECT
            COALESCE(SUM(
                CASE
                    WHEN mb.status = 'depleted' THEN
                        ROUND((mb.unit_cost / GREATEST(
                            (SELECT SUM(units_attributed) FROM public.material_batch_usage WHERE batch_id = mb.id),
                            1
                        )) * mbu.units_attributed, 2)
                    WHEN COALESCE(m.expected_units_per_batch, 0) > 0 THEN
                        ROUND((mb.unit_cost / m.expected_units_per_batch) * mbu.units_attributed, 2)
                    ELSE 0
                END
            ), 0),
            COALESCE(jsonb_agg(
                jsonb_build_object(
                    'material_name', m.name_ar,
                    'batch_code', mb.batch_code,
                    'units_attributed', mbu.units_attributed,
                    'is_estimated', (mb.status <> 'depleted'),
                    'is_uncosted', (mb.status <> 'depleted'
                                    AND COALESCE(m.expected_units_per_batch, 0) <= 0),
                    'cost', CASE
                        WHEN mb.status = 'depleted' THEN
                            ROUND((mb.unit_cost / GREATEST(
                                (SELECT SUM(units_attributed) FROM public.material_batch_usage WHERE batch_id = mb.id),
                                1
                            )) * mbu.units_attributed, 2)
                        WHEN COALESCE(m.expected_units_per_batch, 0) > 0 THEN
                            ROUND((mb.unit_cost / m.expected_units_per_batch) * mbu.units_attributed, 2)
                        ELSE NULL
                    END
                )
            ), '[]'::jsonb),
            COALESCE(bool_or(mb.status <> 'depleted'), FALSE)
        INTO v_materials_cost, v_material_details, v_estimated_materials
        FROM public.production_jobs pj
        JOIN public.production_stage_runs psr ON psr.job_id = pj.id
        JOIN public.material_batch_usage mbu ON mbu.stage_run_id = psr.id
        JOIN public.material_batches mb ON mb.id = mbu.batch_id
        JOIN public.materials m ON m.id = mb.material_id
        WHERE pj.order_id = p_order_id;

        -- 2. Direct Labor: Stage runs + labor_rates or standard stage cost
        -- Piece rate is paid on units produced. A run that passed zero units
        -- produced nothing, so it is charged nothing; GREATEST(units,1) used to
        -- invoice a unit of labour for a batch that entirely failed. The waste
        -- itself is reported by get_cost_of_quality_report, where it belongs.
        SELECT
            COALESCE(SUM(
                COALESCE(lr.rate_per_unit, 0) * COALESCE(psr.units_passed, 0)
            ), 0),
            COALESCE(jsonb_agg(
                jsonb_build_object(
                    'stage_name', st.name_ar,
                    'assignee_id', psr.assignee_id,
                    'units_passed', psr.units_passed,
                    'rate_per_unit', COALESCE(lr.rate_per_unit, 0),
                    'has_rate', (lr.rate_per_unit IS NOT NULL),
                    'cost', COALESCE(lr.rate_per_unit, 0) * COALESCE(psr.units_passed, 0)
                )
            ), '[]'::jsonb)
        INTO v_labor_cost, v_labor_details
        FROM public.production_jobs pj
        JOIN public.production_stage_runs psr ON psr.job_id = pj.id
        JOIN public.production_stages st ON st.id = psr.stage_id
        LEFT JOIN LATERAL (
            SELECT rate_per_unit
            FROM public.labor_rates
            WHERE stage_id = psr.stage_id
              AND (employee_id = psr.assignee_id OR employee_id IS NULL)
              AND effective_from <= COALESCE(psr.completed_at::date, CURRENT_DATE)
            ORDER BY (employee_id IS NOT NULL) DESC, effective_from DESC
            LIMIT 1
        ) lr ON true
        WHERE pj.order_id = p_order_id
          AND psr.execution = 'internal'
          AND psr.status = 'done';

        -- 3. External Work: Outsource stages on this job
        SELECT 
            COALESCE(SUM(agreed_cost), 0),
            COALESCE(jsonb_agg(
                jsonb_build_object(
                    'stage_name', st.name_ar,
                    'supplier_name', sup.name,
                    'agreed_cost', ewo.agreed_cost,
                    'status', ewo.status
                )
            ), '[]'::jsonb)
        INTO v_external_cost, v_external_details
        FROM public.production_jobs pj
        JOIN public.production_stage_runs psr ON psr.job_id = pj.id
        JOIN public.production_stages st ON st.id = psr.stage_id
        JOIN public.external_work_orders ewo ON ewo.stage_run_id = psr.id
        LEFT JOIN public.suppliers sup ON sup.id = ewo.supplier_id
        WHERE pj.order_id = p_order_id;

        -- 4. Allocated overhead: the order's OWN month, or nothing.
        -- Borrowing the nearest earlier month silently charged January's rate to
        -- an unallocated March and produced a confident number nobody had
        -- frozen. An unallocated month reports zero overhead and says so, so the
        -- report can show "الأوفرهيد لسه متوزعش للشهر ده" instead of a fiction.
        SELECT rate_per_unit
          INTO v_overhead_rate
          FROM public.overhead_allocation_runs
         WHERE period_month = v_order_month;

        IF v_overhead_rate IS NULL THEN
            v_overhead_rate   := 0;
            v_overhead_status := 'not_allocated';
        ELSE
            v_overhead_status := 'allocated';
        END IF;

        v_overhead_cost := ROUND(v_overhead_rate * v_total_units, 2);
        v_total_cost := v_materials_cost + v_labor_cost + v_external_cost + v_overhead_cost;
    ELSE
        -- Outsourced case: the vendor's agreed cost is the cost, and it keeps
        -- flowing through orders.cost exactly as it does today. Nothing here
        -- writes it back.
        v_external_cost   := COALESCE(v_order.manual_cost, v_order.cost, 0);
        v_total_cost      := v_external_cost;
        v_overhead_status := 'not_applicable';
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'case_id', v_order.case_id,
        'is_internal_production', v_has_internal_runs,
        'is_billable', TRUE,
        'total_units', v_total_units,
        'total_price', v_total_price,
        'materials_cost', v_materials_cost,
        'materials_are_estimated', v_estimated_materials,
        'labor_cost', v_labor_cost,
        'external_cost', v_external_cost,
        'overhead_cost', v_overhead_cost,
        'overhead_rate_applied', v_overhead_rate,
        'overhead_status', v_overhead_status,
        'total_cost', v_total_cost,
        'cost_per_unit', ROUND(v_total_cost / v_total_units, 2),
        'gross_profit', ROUND(v_total_price - v_total_cost, 2),
        'margin_percent', CASE
            WHEN v_total_price > 0 THEN
                ROUND(((v_total_price - v_total_cost) / v_total_price) * 100, 1)
            ELSE 0
        END,
        'details', jsonb_build_object(
            'materials', v_material_details,
            'labor', v_labor_details,
            'external', v_external_details
        )
    );
END;
$$;

COMMENT ON FUNCTION public.get_order_cost_breakdown(UUID) IS
'ANALYTICAL ONLY (plan section 3): read-only unit cost. Never writes financial_obligations or orders.cost. Returns zero cost AND zero revenue for cancelled/lab-rejected cases. Units come from order_items, never from the legacy orders.items JSONB.';


--------------------------------------------------------------------------------
-- 5. Atomic RPC: Cost of Quality Report (Internal Rework vs External Remakes)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cost_of_quality_report(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_internal_reworks JSONB;
    v_external_issues JSONB;
    v_internal_summary JSONB;
    v_external_summary JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'lab') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, or lab role required' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '30 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    -- Internal Quality: Rework stage runs caught before delivery
    WITH internal_runs AS (
        SELECT 
            psr.id,
            st.name_ar AS stage_name,
            st.id AS stage_id,
            COALESCE(psr.failure_cause_code, 'internal_qc_fail') AS cause_code,
            COALESCE(u.name, 'غير محدد') AS technician_name,
            COALESCE(psr.units_failed, 1) AS units_failed,
            psr.completed_at,
            COALESCE(lr.rate_per_unit, 0) AS estimated_labor_cost
        FROM public.production_stage_runs psr
        JOIN public.production_stages st ON st.id = psr.stage_id
        LEFT JOIN public.users u ON u.id = psr.assignee_id
        -- Same rate resolution as get_order_cost_breakdown: the rate that was in
        -- force for THAT technician on THAT day. Taking the newest rate of any
        -- employee valued last year's scrap at this year's price.
        LEFT JOIN LATERAL (
            SELECT rate_per_unit
            FROM public.labor_rates
            WHERE stage_id = psr.stage_id
              AND (employee_id = psr.assignee_id OR employee_id IS NULL)
              AND effective_from <= COALESCE(psr.completed_at::date, CURRENT_DATE)
            ORDER BY (employee_id IS NOT NULL) DESC, effective_from DESC
            LIMIT 1
        ) lr ON true
        WHERE psr.rework_of IS NOT NULL
          AND psr.completed_at::date >= v_start
          AND psr.completed_at::date <= v_end
    ),
    internal_grouped AS (
        SELECT 
            stage_name,
            cause_code,
            technician_name,
            COUNT(*) AS incidents_count,
            SUM(units_failed) AS total_units_failed,
            SUM(estimated_labor_cost * units_failed) AS total_labor_loss
        FROM internal_runs
        GROUP BY stage_name, cause_code, technician_name
    )
    SELECT 
        COALESCE(jsonb_agg(row_to_json(internal_grouped)), '[]'::jsonb),
        jsonb_build_object(
            'total_incidents', COALESCE(SUM(incidents_count), 0),
            'total_units_failed', COALESCE(SUM(total_units_failed), 0),
            'total_estimated_labor_loss', COALESCE(SUM(total_labor_loss), 0)
        )
    INTO v_internal_reworks, v_internal_summary
    FROM internal_grouped;

    -- External Quality: Orders with issues returned from doctors / clinics
    WITH external_issues AS (
        SELECT
            oi.id,
            oi.order_id,
            COALESCE(oi.issue_type, 'issue') AS issue_type,
            COALESCE(oi.cause_category, 'unknown') AS cause_code,
            COALESCE(d.name, 'طبيب غير محدد') AS doctor_name,
            COALESCE(o.case_id, '—') AS case_id,
            -- Zero revenue on a case that was cancelled or lab-rejected: it was
            -- never worked and never billed, so it cannot be "affected revenue".
            CASE WHEN COALESCE(o.status, '') IN ('Cancelled', 'Lab Rejected')
                 THEN 0 ELSE COALESCE(o.total_price, 0) END AS order_value,
            CASE WHEN COALESCE(o.status, '') IN ('Cancelled', 'Lab Rejected')
                 THEN 0 ELSE COALESCE(o.rejected_lab_cost, 0) END AS lab_rejection_cost,
            -- One order carries its price once. The flag lands on the order's
            -- earliest issue in the window, so the totals are exact and the
            -- revenue is attributed to the cause that started the trouble.
            (ROW_NUMBER() OVER (PARTITION BY oi.order_id ORDER BY oi.created_at, oi.id) = 1)
                AS is_first_issue_of_order
        FROM public.order_issues oi
        JOIN public.orders o ON o.id = oi.order_id
        LEFT JOIN public.doctors d ON d.id = o.doctor_id
        WHERE oi.created_at::date >= v_start
          AND oi.created_at::date <= v_end
          AND COALESCE(oi.is_voided, false) = false
    ),
    -- An order with three issues is ONE affected order carrying ONE price.
    -- Summing order_value per issue counted the same revenue three times and
    -- inflated "cost of quality" by the rate of repeat problems -- the very
    -- thing the report exists to measure.
    external_grouped AS (
        SELECT
            issue_type,
            cause_code,
            COUNT(*) AS incidents_count,
            COUNT(DISTINCT order_id) AS affected_orders,
            SUM(order_value) FILTER (WHERE is_first_issue_of_order) AS affected_revenue,
            SUM(lab_rejection_cost) FILTER (WHERE is_first_issue_of_order) AS financial_loss
        FROM external_issues
        GROUP BY issue_type, cause_code
    )
    SELECT
        COALESCE(jsonb_agg(row_to_json(external_grouped)), '[]'::jsonb),
        jsonb_build_object(
            'total_issues_count', COALESCE(SUM(incidents_count), 0),
            'total_affected_orders', COALESCE(SUM(affected_orders), 0),
            'total_affected_revenue', COALESCE(SUM(affected_revenue), 0),
            'total_financial_loss', COALESCE(SUM(financial_loss), 0)
        )
    INTO v_external_issues, v_external_summary
    FROM external_grouped;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'internal_quality', jsonb_build_object(
            'summary', COALESCE(v_internal_summary, '{}'::jsonb),
            'breakdown', v_internal_reworks
        ),
        'external_quality', jsonb_build_object(
            'summary', COALESCE(v_external_summary, '{}'::jsonb),
            'breakdown', v_external_issues
        )
    );
END;
$$;


--------------------------------------------------------------------------------
-- 6. Atomic RPC: Internal vs External Production Benchmark
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_internal_vs_external_benchmark(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_benchmark JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'lab') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, or lab role required' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '90 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    -- The whole point of this report is to compare TWO DIFFERENT cost numbers
    -- for the same service. Reading COALESCE(manual_cost, cost) on both sides
    -- put the vendor's invoice in the "internal" column too, so the report
    -- compared a number with itself. The internal side is now built from the
    -- real components -- materials + labour + overhead -- and the external side
    -- keeps the vendor's recorded cost.
    WITH order_metrics AS (
        SELECT
            o.id AS order_id,
            COALESCE(sf.name_ar, sf.name_en, 'غير مصنّف') AS family_name,
            -- Internal means somebody here worked a step. Since 20260827000000
            -- every order carries a stage chain, so the mere existence of runs
            -- (or of a design step, which is internal on every route) would
            -- label the entire order base "internal".
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM public.production_jobs pj
                    JOIN public.production_stage_runs psr ON psr.job_id = pj.id
                    WHERE pj.order_id = o.id
                      -- Backfilled history is reconstructed, not worked here.
                      AND NOT pj.is_backfilled
                      AND psr.execution = 'internal'
                      AND psr.driven_by <> 'order_status'
                      AND psr.status = 'done'
                ) THEN 'internal'
                ELSE 'external'
            END AS production_type,
            COALESCE(o.total_price, 0) AS price,
            COALESCE(o.manual_cost, o.cost, 0) AS vendor_cost,
            COALESCE(units.total_units, 1) AS total_units,
            -- Working minutes for the internal side, calendar days for the
            -- vendor: the lab controls its own calendar and not the vendor's
            -- (plan 6.2). Both are reported, neither is mixed into the other.
            public.working_minutes_between(o.created_at,
                COALESCE(o.actual_delivery_date::timestamptz,
                         o.delivery_date::timestamptz)) AS lead_working_minutes,
            GREATEST(
                1,
                (COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date) - o.created_at::date)
            ) AS lead_time_days,
            CASE WHEN o.issue_state IS NOT NULL AND o.issue_state != 'none' THEN 1 ELSE 0 END AS has_issue
        FROM public.orders o
        -- Family comes through the normalised order_items -> services join, the
        -- same path every other family report uses. Matching services by name
        -- against the legacy orders.items JSONB left most orders unclassified.
        LEFT JOIN LATERAL (
            SELECT s.family_id
              FROM public.order_items oi
              JOIN public.services s ON s.name = oi.product_type
             WHERE oi.order_id = o.id
               AND s.family_id IS NOT NULL
             LIMIT 1
        ) service_item ON true
        LEFT JOIN public.service_families sf ON sf.id = service_item.family_id
        LEFT JOIN LATERAL (
            SELECT SUM(GREATEST(COALESCE(oi.count, 1), 1))::int AS total_units
              FROM public.order_items oi
             WHERE oi.order_id = o.id
        ) units ON true
        WHERE COALESCE(o.is_deleted, false) = false
          AND o.created_at::date >= v_start
          AND o.created_at::date <= v_end
          -- Never worked, never billed: zero cost and zero revenue (plan 3).
          AND o.status NOT IN ('Cancelled', 'Lab Rejected')
          AND COALESCE(o.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected')
    ),
    costed AS (
        SELECT
            m.*,
            CASE
                WHEN m.production_type = 'internal'
                    THEN COALESCE((public.get_order_cost_breakdown(m.order_id) ->> 'total_cost')::numeric, 0)
                ELSE m.vendor_cost
            END AS true_cost
        FROM order_metrics m
    ),
    aggregated AS (
        SELECT
            family_name,
            production_type,
            COUNT(DISTINCT order_id) AS total_orders,
            SUM(total_units) AS total_units,
            ROUND(AVG(true_cost), 2) AS avg_cost,
            ROUND(SUM(true_cost) / GREATEST(SUM(total_units), 1), 2) AS avg_cost_per_unit,
            ROUND(AVG(price), 2) AS avg_price,
            ROUND(AVG(lead_time_days), 1) AS avg_lead_days,
            ROUND(AVG(lead_working_minutes) / 60.0, 1) AS avg_lead_working_hours,
            ROUND((SUM(has_issue)::numeric / GREATEST(COUNT(*), 1)) * 100, 1) AS issue_rate_pct
        FROM costed
        GROUP BY family_name, production_type
    )
    SELECT COALESCE(jsonb_agg(row_to_json(aggregated)), '[]'::jsonb)
    INTO v_benchmark
    FROM aggregated;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'comparison', v_benchmark
    );
END;
$$;


--------------------------------------------------------------------------------
-- 7. Atomic RPC: Technician Material & Disc Efficiency
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_technician_material_efficiency(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_results JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'lab') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, or lab role required' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '60 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    WITH usage_data AS (
        SELECT 
            u.id AS technician_id,
            COALESCE(u.name, 'غير محدد') AS technician_name,
            m.id AS material_id,
            m.name_ar AS material_name,
            m.category AS material_category,
            m.expected_units_per_batch,
            mb.id AS batch_id,
            mb.batch_code,
            mb.status AS batch_status,
            mbu.units_attributed,
            psr.units_failed
        FROM public.material_batch_usage mbu
        JOIN public.material_batches mb ON mb.id = mbu.batch_id
        JOIN public.materials m ON m.id = mb.material_id
        JOIN public.production_stage_runs psr ON psr.id = mbu.stage_run_id
        LEFT JOIN public.users u ON u.id = psr.assignee_id
        WHERE mbu.attributed_at::date >= v_start
          AND mbu.attributed_at::date <= v_end
    ),
    grouped AS (
        SELECT 
            technician_name,
            material_name,
            material_category,
            expected_units_per_batch,
            COUNT(DISTINCT batch_id) AS distinct_batches_used,
            SUM(units_attributed) AS total_units_produced,
            SUM(COALESCE(units_failed, 0)) AS total_units_scrapped,
            ROUND(
                SUM(units_attributed)::numeric / GREATEST(COUNT(DISTINCT batch_id), 1),
                1
            ) AS actual_units_per_batch,
            ROUND(
                (SUM(COALESCE(units_failed, 0))::numeric / GREATEST(SUM(units_attributed) + SUM(COALESCE(units_failed, 0)), 1)) * 100,
                1
            ) AS scrap_rate_pct
        FROM usage_data
        GROUP BY technician_name, material_name, material_category, expected_units_per_batch
    )
    SELECT COALESCE(jsonb_agg(row_to_json(grouped)), '[]'::jsonb)
    INTO v_results
    FROM grouped;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'efficiency', v_results
    );
END;
$$;


--------------------------------------------------------------------------------
-- 8. Security Definer Grants & Permissions Hardening
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.freeze_overhead_allocation(DATE, NUMERIC, INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freeze_overhead_allocation(DATE, NUMERIC, INTEGER, TEXT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.get_order_cost_breakdown(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_cost_breakdown(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_cost_of_quality_report(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cost_of_quality_report(DATE, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.get_internal_vs_external_benchmark(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_internal_vs_external_benchmark(DATE, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.get_technician_material_efficiency(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_technician_material_efficiency(DATE, DATE) TO authenticated;

-- Grant authenticated role table permissions on internal production and calendar tables (protected by RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON 
    public.work_calendars,
    public.work_shifts,
    public.work_breaks,
    public.work_exceptions,
    public.work_sessions,
    public.production_stages,
    public.production_routes,
    public.production_route_stages,
    public.production_jobs,
    public.production_job_items,
    public.production_stage_runs,
    public.external_work_orders,
    public.machines,
    public.machine_downtime,
    public.warehouses,
    public.materials,
    public.material_batches,
    public.material_movements,
    public.material_purchases,
    public.material_purchase_items,
    public.stage_material_bindings,
    public.material_batch_usage,
    public.shipments,
    public.shipment_orders,
    public.labor_rates,
    public.overhead_allocation_runs
TO authenticated;

COMMIT;
