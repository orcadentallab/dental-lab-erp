-- Migration: 20260827005000_cutover_baseline_and_cost_reader_guard.sql
-- Description: Plan section 5.2 -- "تقارير موجودة هتبقى غلط بصمت بعد الـ Cutover"
--
-- WHY THIS EXISTS
--   Every cost report in this system today reads orders.cost, which means "what
--   the outside lab charged us". After the cutover that number stops being the
--   cost of anything: the work happens here, and the real cost is materials plus
--   labour plus overhead. Nothing breaks, nothing errors -- the reports just
--   quietly start answering a different question with the same confident number,
--   and a month-over-month chart drawn across that line compares two different
--   definitions of "cost" as if they were one series.
--
--   The plan calls this item mandatory. It needs three things; this migration
--   provides the two that belong in the database:
--     1. A stated cutover boundary every report can ask about.
--     2. A financial snapshot frozen before it, so the old world stays legible.
--   The third -- the warning on any comparison crossing the line -- lives in
--   src/components/reports/CutoverComparisonNotice.tsx, and the inventory of
--   every cost reader is in docs/COST_READERS_INVENTORY_AR.md.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   It does not touch financial_obligations, orders.cost, or any existing
--   report. It records when the line was crossed and what the numbers looked
--   like just before it.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. The boundary
-- ─────────────────────────────────────────────────────────────────────────
-- production_v1 flipping to 'on' is the moment cost changes meaning. Recording
-- it once, automatically, is the only way a report can later ask "is this
-- period before or after?" without somebody having to remember the date.

CREATE OR REPLACE FUNCTION public.trg_stamp_production_cutover()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.key = 'production_v1'
       AND lower(COALESCE(NEW.value, '')) = 'on'
       AND lower(COALESCE(OLD.value, '')) <> 'on' THEN
        INSERT INTO public.app_settings (key, value)
        VALUES ('production_v1_cutover_at', NOW()::text)
        -- First crossing only. Flipping the flag off and on again during a
        -- rollback must not move the boundary under reports already drawn.
        ON CONFLICT (key) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_stamp_cutover ON public.app_settings;
CREATE TRIGGER trg_app_settings_stamp_cutover
    AFTER UPDATE OF value ON public.app_settings
    FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_production_cutover();

REVOKE ALL ON FUNCTION public.trg_stamp_production_cutover() FROM PUBLIC, anon;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Asking about the boundary
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_cutover_boundary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_at TIMESTAMPTZ;
    v_on BOOLEAN;
BEGIN
    IF public.get_my_role() IS NULL THEN
        RAISE EXCEPTION 'forbidden: authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT value::timestamptz INTO v_at
      FROM public.app_settings WHERE key = 'production_v1_cutover_at';

    v_on := public.workflow_flag_enabled('production_v1');

    RETURN jsonb_build_object(
        -- NULL until the lab actually opens. A report with a NULL boundary has
        -- nothing to warn about: every period it can draw is on the old side.
        'cutover_at', v_at,
        'is_production_v1', v_on,
        'meaning_before', 'التكلفة = فاتورة المعمل الخارجي (orders.cost)',
        'meaning_after',  'التكلفة = خامات + مصنعية + أوفرهيد (get_order_cost_breakdown)'
    );
END;
$$;

COMMENT ON FUNCTION public.get_cutover_boundary() IS
'When cost changed meaning. Any report comparing periods across cutover_at is comparing two different definitions and must say so (plan 5.2).';

REVOKE ALL ON FUNCTION public.get_cutover_boundary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cutover_boundary() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. The baseline snapshot
-- ─────────────────────────────────────────────────────────────────────────
-- A frozen picture of the outsourced era, captured before the flag flips. Once
-- the lab opens, no query can reconstruct these totals the way they read at the
-- time, because the definition underneath them will have moved.

CREATE TABLE IF NOT EXISTS public.cutover_financial_baseline (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    captured_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_start       DATE NOT NULL,
    period_end         DATE NOT NULL,
    orders_count       INTEGER NOT NULL,
    units_count        INTEGER NOT NULL,
    total_revenue      NUMERIC(14,2) NOT NULL,
    total_cost         NUMERIC(14,2) NOT NULL,
    avg_cost_per_unit  NUMERIC(12,2),
    avg_price_per_unit NUMERIC(12,2),
    by_family          JSONB NOT NULL DEFAULT '[]'::jsonb,
    by_supplier        JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes              TEXT,
    captured_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT baseline_period_sane CHECK (period_end >= period_start)
);

ALTER TABLE public.cutover_financial_baseline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance can read cutover baseline" ON public.cutover_financial_baseline;
CREATE POLICY "Finance can read cutover baseline" ON public.cutover_financial_baseline
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'accountant', 'lab'));

-- Read-only through PostgREST. A baseline that can be edited is not a baseline.
GRANT SELECT ON public.cutover_financial_baseline TO authenticated;


CREATE OR REPLACE FUNCTION public.capture_cutover_baseline(
    p_period_start DATE,
    p_period_end   DATE,
    p_notes        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user UUID;
    v_row  public.cutover_financial_baseline%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'accountant') THEN
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
            COALESCE(o.manual_cost, o.cost, 0) AS cost,
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
$$;

COMMENT ON FUNCTION public.capture_cutover_baseline(DATE, DATE, TEXT) IS
'Freezes the outsourced-era financial picture for a period (plan 5.2). Reads orders only; writes nothing back. Run before flipping production_v1.';

REVOKE ALL ON FUNCTION public.capture_cutover_baseline(DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.capture_cutover_baseline(DATE, DATE, TEXT) TO authenticated;

COMMIT;
