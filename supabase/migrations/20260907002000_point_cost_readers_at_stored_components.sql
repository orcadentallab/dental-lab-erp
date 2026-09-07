-- Phase 2: point the cost readers at the stored components.
--
-- Phase 1 (20260907000000) added lab_cost and designer_cost and moved no
-- numbers.  This phase spends that: the four readers that were re-deriving the
-- milling cost with COALESCE(manual_cost, cost) now read lab_cost instead.
--
-- That expression returned the milling cost when an admin had overridden it and
-- the whole case cost when they had not, so the same column meant two different
-- things depending on a fact stored in a different row.  Four functions got it
-- wrong; six other copies of the derivation got it right.  The stored column
-- ends the argument.
--
-- WHAT CHANGES, PER FUNCTION
-- --------------------------
-- build_order_accounting_snapshot
--     labCost     COALESCE(manual_cost, cost)                -> lab_cost
--     designCost  COALESCE(manual_design_price, design_price) -> designer_cost
--     The snapshot's two cost lines now sum to the case cost.  They did not
--     before: a split case stored labCost = 450 AND designCost = 50 against a
--     cost of 450, counting the design price twice inside one snapshot.
--     designer_cost is 0 for a salaried designer, which is what is actually
--     owed; design_price stays on the order as the reference figure.
--
-- capture_cutover_baseline
--     cost  COALESCE(manual_cost, cost) -> cost
--     This one wants the TOTAL case cost for a margin baseline, not the
--     vendor's share, so it must NOT read lab_cost.  Reading manual_cost first
--     silently dropped the design price from the baseline of every case that
--     had a manual milling price.
--
-- get_internal_vs_external_benchmark
--     vendor_cost  COALESCE(manual_cost, cost) -> lab_cost
--     The whole report compares an in-house cost against the vendor's invoice.
--     The vendor never invoiced the design fee.
--
-- get_order_cost_breakdown
--     external_cost  COALESCE(manual_cost, cost) -> lab_cost
--     total_cost     now adds designer_cost in both branches
--     plus a new designer_cost key in the returned object.
--     The outsourced branch set total_cost := external_cost, so for a case with
--     a manual milling price the designer fee was missing from total_cost and
--     gross_profit was overstated by exactly that much.
--
--     Adding designer_cost to the INTERNAL branch total could in principle
--     double-count, if a labour rate were ever configured for a design stage
--     run by a per-piece designer.  That cannot happen today: public.labor_rates
--     is empty, and no order is simultaneously internally produced, split, and
--     assigned to a per-piece designer.  A per-piece designer is paid through a
--     financial obligation, not through stage labour, so the two should stay
--     separate; if a design-stage labour rate is ever added, revisit this line.
--
-- WHAT IS DELIBERATELY LEFT ALONE
-- -------------------------------
-- The six readers that already derive the milling cost correctly
-- (sync_order_financial_obligations, sync_preserved_external_lab_price_change,
-- get_doctor_service_profitability, get_analytics_summary_privileged_20260801
-- which carries the derivation twice, and getLabCostMetadata in TS) return
-- values identical to lab_cost.  Rewriting them here would be pure churn
-- against the obligation generators, which is where the money is.  They are
-- simplified in phase 3, when the write direction flips.

CREATE OR REPLACE FUNCTION public.build_order_accounting_snapshot(p_order public.orders)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'status', p_order.status,
        'saleAmount', CASE
            WHEN p_order.status IN ('Cancelled', 'Lab Rejected') THEN 0
            WHEN p_order.status IN ('Doctor Rejected', 'Rejected')
                THEN COALESCE(p_order.rejected_doctor_amount, p_order.total_price, 0)
            ELSE COALESCE(p_order.total_price, 0)
        END,
        'labCost', CASE
            WHEN p_order.status IN ('Cancelled', 'Lab Rejected') THEN 0
            WHEN p_order.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(p_order.rejected_lab_cost, 0)
            ELSE COALESCE(p_order.lab_cost, 0)
        END,
        'designCost', CASE
            WHEN p_order.status IN ('Cancelled', 'Lab Rejected') THEN 0
            WHEN p_order.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(p_order.rejected_designer_cost, 0)
            ELSE COALESCE(p_order.designer_cost, 0)
        END,
        'discount', CASE WHEN p_order.status IN ('Cancelled', 'Lab Rejected') THEN 0 ELSE COALESCE(p_order.discount, 0) END,
        'doctorId', p_order.doctor_id,
        'supplierId', p_order.supplier_id,
        'designerId', p_order.designer_id
    );
$$;

CREATE OR REPLACE FUNCTION public.capture_cutover_baseline(p_period_start date, p_period_end date, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user UUID;
    v_row  public.cutover_financial_baseline%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'التقاط خط الأساس للأدمن والمحاسب فقط' USING ERRCODE = '42501';
    END IF;

    IF p_period_end < p_period_start THEN
        RAISE EXCEPTION 'نهاية الفترة قبل بدايتها';
    END IF;

    SELECT id INTO v_user FROM public.users WHERE auth_id = auth.uid() LIMIT 1;

    WITH scoped AS (
        SELECT
            o.id,
            COALESCE(o.total_price, 0) AS price,
            COALESCE(o.cost, 0) AS cost,
            COALESCE((SELECT SUM(GREATEST(COALESCE(oi.count, 1), 1))
                        FROM public.order_items oi WHERE oi.order_id = o.id), 1) AS units,
            o.supplier_id,
            COALESCE(sf.name_ar, sf.name_en, 'غير مصنّف') AS family_name
        FROM public.orders o
        LEFT JOIN LATERAL (
            SELECT s.family_id
              FROM public.order_items oi
              JOIN public.services s ON s.name = oi.product_type
             WHERE oi.order_id = o.id AND s.family_id IS NOT NULL
             LIMIT 1
        ) si ON true
        LEFT JOIN public.service_families sf ON sf.id = si.family_id
        WHERE COALESCE(o.is_deleted, false) = false
          AND o.created_at::date BETWEEN p_period_start AND p_period_end
          -- Never worked, never billed (plan 3).
          AND o.status NOT IN ('Cancelled', 'Lab Rejected')
          AND COALESCE(o.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected')
    ),
    totals AS (
        SELECT COUNT(*)::int AS orders_count,
               COALESCE(SUM(units), 0)::int AS units_count,
               COALESCE(SUM(price), 0) AS revenue,
               COALESCE(SUM(cost), 0)  AS cost
          FROM scoped
    ),
    fam AS (
        SELECT COALESCE(jsonb_agg(f), '[]'::jsonb) AS j FROM (
            SELECT family_name,
                   COUNT(*)::int AS orders,
                   SUM(units)::int AS units,
                   ROUND(SUM(cost), 2) AS cost,
                   ROUND(SUM(price), 2) AS revenue
              FROM scoped GROUP BY family_name ORDER BY SUM(price) DESC
        ) f
    ),
    sup AS (
        SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) AS j FROM (
            SELECT COALESCE(su.name, 'بدون مورد') AS supplier_name,
                   COUNT(*)::int AS orders,
                   SUM(sc.units)::int AS units,
                   ROUND(SUM(sc.cost), 2) AS cost
              FROM scoped sc
              LEFT JOIN public.suppliers su ON su.id = sc.supplier_id
             GROUP BY su.name ORDER BY SUM(sc.cost) DESC
        ) s
    )
    INSERT INTO public.cutover_financial_baseline (
        period_start, period_end, orders_count, units_count,
        total_revenue, total_cost, avg_cost_per_unit, avg_price_per_unit,
        by_family, by_supplier, notes, captured_by
    )
    SELECT
        p_period_start, p_period_end, t.orders_count, t.units_count,
        t.revenue, t.cost,
        ROUND(t.cost    / GREATEST(t.units_count, 1), 2),
        ROUND(t.revenue / GREATEST(t.units_count, 1), 2),
        fam.j, sup.j, p_notes, v_user
    FROM totals t, fam, sup
    RETURNING * INTO v_row;

    RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_internal_vs_external_benchmark(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_benchmark JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'production_manager') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, coordinator, or production manager role required' USING ERRCODE = '42501';
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
            COALESCE(o.lab_cost, 0) AS vendor_cost,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_order_cost_breakdown(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_order RECORD;
    v_materials_cost NUMERIC(10,2) := 0;
    v_labor_cost NUMERIC(10,2) := 0;
    v_external_cost NUMERIC(10,2) := 0;
    v_designer_cost NUMERIC(10,2) := 0;
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
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'production_manager') THEN
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
            'designer_cost', 0,
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
            'designer_cost', 0,
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
        v_designer_cost := COALESCE(v_order.designer_cost, 0);
        v_total_cost := v_materials_cost + v_labor_cost + v_external_cost
                        + v_overhead_cost + v_designer_cost;
    ELSE
        -- Outsourced case: the vendor's agreed cost is the cost, and it keeps
        -- flowing through orders.cost exactly as it does today. Nothing here
        -- writes it back.
        v_external_cost   := COALESCE(v_order.lab_cost, 0);
        v_designer_cost   := COALESCE(v_order.designer_cost, 0);
        v_total_cost      := v_external_cost + v_designer_cost;
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
        'designer_cost', v_designer_cost,
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
$function$;
-- ---------------------------------------------------------------------------
-- Restate the stored accounting snapshots that are still in sync with their
-- order.
--
-- A stored snapshot records the numbers as they stood at registration.  Where
-- the snapshot still agrees with the row under the OLD formula, nothing has
-- moved since it was written, so replacing it with the new formula restates the
-- same case rather than rewriting history -- and it removes the internal
-- contradiction described at the top of this file.
--
-- Where it does NOT agree, the order genuinely changed after registration and
-- the snapshot is a real historical record.  Those are left exactly as they are.
--
-- Rejected, cancelled and lab-rejected snapshots are untouched in every case:
-- they are built from rejected_lab_cost / rejected_designer_cost, which this
-- migration does not alter.
--
-- Triggers are suppressed for the same reason as in phase 1: accounting_snapshot
-- and accounting_previous_snapshot are already on the ignore list of
-- capture_accounting_review_change_v2, but reopen_registered_order_for_accounting
-- and the obligation sync must not see a write at all.
-- ---------------------------------------------------------------------------

SET LOCAL session_replication_role = replica;

-- SET LOCAL is a no-op outside a transaction block: Postgres warns and leaves
-- the setting alone.  If the deploy path runs this file statement-by-statement
-- instead of as one transaction, the 25 triggers on public.orders would fire
-- for the backfill below -- re-opening every registered order for accounting
-- review and churning obligations.  Fail loudly here instead of quietly doing
-- the damage.
DO $guard$
BEGIN
    IF current_setting('session_replication_role') <> 'replica' THEN
        RAISE EXCEPTION
            'session_replication_role is %, not replica: this migration must run inside a single transaction. Deploy it with a transactional runner (supabase db push) rather than statement-by-statement.',
            current_setting('session_replication_role');
    END IF;
END;
$guard$;

UPDATE public.orders o
   SET accounting_snapshot = o.accounting_snapshot
        || jsonb_build_object('labCost', o.lab_cost, 'designCost', o.designer_cost)
 WHERE o.accounting_snapshot IS NOT NULL
   AND o.accounting_snapshot->>'status' NOT IN
       ('Cancelled', 'Lab Rejected', 'Doctor Rejected', 'Rejected')
   AND (o.accounting_snapshot->>'labCost')::numeric
       = COALESCE(o.manual_cost, o.cost, 0)
   AND (o.accounting_snapshot->>'designCost')::numeric
       = COALESCE(o.manual_design_price, o.design_price, 0)
   AND (o.lab_cost <> (o.accounting_snapshot->>'labCost')::numeric
     OR o.designer_cost <> (o.accounting_snapshot->>'designCost')::numeric);

UPDATE public.orders o
   SET accounting_previous_snapshot = o.accounting_previous_snapshot
        || jsonb_build_object('labCost', o.lab_cost, 'designCost', o.designer_cost)
 WHERE o.accounting_previous_snapshot IS NOT NULL
   AND o.accounting_previous_snapshot->>'status' NOT IN
       ('Cancelled', 'Lab Rejected', 'Doctor Rejected', 'Rejected')
   AND (o.accounting_previous_snapshot->>'labCost')::numeric
       = COALESCE(o.manual_cost, o.cost, 0)
   AND (o.accounting_previous_snapshot->>'designCost')::numeric
       = COALESCE(o.manual_design_price, o.design_price, 0)
   AND (o.lab_cost <> (o.accounting_previous_snapshot->>'labCost')::numeric
     OR o.designer_cost <> (o.accounting_previous_snapshot->>'designCost')::numeric);

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $do$
DECLARE
    v_broken     INTEGER;
    v_restated   INTEGER;
    v_left_alone INTEGER;
BEGIN
    -- Phase 1's invariant must still hold; nothing here writes cost.
    SELECT COUNT(*) INTO v_broken
      FROM public.orders
     WHERE COALESCE(cost, 0) <> lab_cost + designer_cost;

    IF v_broken > 0 THEN
        RAISE EXCEPTION 'cost = lab_cost + designer_cost broke on % row(s)', v_broken;
    END IF;

    -- A restated snapshot must have had BOTH lines restated, never one.
    SELECT COUNT(*) INTO v_broken
      FROM public.orders
     WHERE accounting_snapshot IS NOT NULL
       AND accounting_snapshot->>'status' NOT IN
           ('Cancelled', 'Lab Rejected', 'Doctor Rejected', 'Rejected')
       AND (accounting_snapshot->>'labCost')::numeric = lab_cost
       AND (accounting_snapshot->>'designCost')::numeric <> designer_cost;

    IF v_broken > 0 THEN
        RAISE EXCEPTION 'accounting_snapshot half-restated on % row(s)', v_broken;
    END IF;

    SELECT COUNT(*) INTO v_restated
      FROM public.orders
     WHERE accounting_snapshot IS NOT NULL
       AND (accounting_snapshot->>'labCost')::numeric = lab_cost;

    SELECT COUNT(*) INTO v_left_alone
      FROM public.orders
     WHERE accounting_snapshot IS NOT NULL
       AND (accounting_snapshot->>'labCost')::numeric <> lab_cost;

    RAISE NOTICE 'snapshots consistent with their order: %', v_restated;
    RAISE NOTICE 'snapshots left as historical record: %', v_left_alone;
END;
$do$;
