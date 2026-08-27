-- Migration: 20260827006000_operational_warnings.sql
-- Description: Give the deliberately-swallowed background failures somewhere to
--              be seen.
--
-- WHY THIS EXISTS
--   Two triggers swallow their exceptions on purpose, and both are right to:
--     * trg_sync_production_from_order                  (20260827000000)
--     * trg_attribute_material_usage_on_stage_complete  (20260827001000)
--   Both hang off a statement somebody is running for a real reason -- saving an
--   order, finishing a case. An exception in a measurement subsystem must not
--   stop the lab taking work.
--
--   But RAISE WARNING goes to the Postgres log, and nobody reads the Postgres
--   log. So a bug in either one is invisible: the number quietly stops being
--   collected and the first sign is a report that looks thin months later.
--   Swallowing the exception is correct; swallowing it silently is not.
--
--   This gives them a table. The swallow keeps the lab running; the row makes
--   the failure findable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.system_warnings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source      TEXT NOT NULL,
    ref_id      UUID,
    message     TEXT NOT NULL,
    sqlstate    TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_system_warnings_open
    ON public.system_warnings (occurred_at DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_system_warnings_source
    ON public.system_warnings (source, occurred_at DESC);

COMMENT ON TABLE public.system_warnings IS
'Background failures that were deliberately swallowed so they could not abort a user statement. A row here means a measurement did not happen -- not that anything the user did failed.';

ALTER TABLE public.system_warnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read system warnings" ON public.system_warnings;
CREATE POLICY "Admins read system warnings" ON public.system_warnings
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab'));

-- Written only by the logger below, which is SECURITY DEFINER.
GRANT SELECT ON public.system_warnings TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- The logger
-- ─────────────────────────────────────────────────────────────────────────
-- Called from inside exception handlers, so it must never raise: a logger that
-- can throw would resurrect exactly the aborted-statement problem the swallow
-- exists to prevent.
CREATE OR REPLACE FUNCTION public.log_system_warning(
    p_source   TEXT,
    p_ref_id   UUID,
    p_message  TEXT,
    p_sqlstate TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.system_warnings (source, ref_id, message, sqlstate)
    VALUES (p_source, p_ref_id, left(COALESCE(p_message, ''), 4000), p_sqlstate);
EXCEPTION WHEN OTHERS THEN
    -- Last resort only. If even this fails the log line is all that is left,
    -- but the caller still returns cleanly.
    RAISE WARNING 'log_system_warning failed for %/%: %', p_source, p_ref_id, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.log_system_warning(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;


-- ─────────────────────────────────────────────────────────────────────────
-- Wire the two existing swallows into it
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_sync_production_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- apply_production_status_from_stages writes production_status once the
    -- cutover flag is on, which would re-enter this trigger. One level of
    -- nesting is the real edit; anything deeper is the echo.
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;

    -- DELIBERATE SWALLOW. This is a measurement subsystem behind a flag that is
    -- off: nothing any user sees depends on it. An exception here would abort
    -- the enclosing statement, which is somebody saving an order -- so a bug in
    -- the reconciler would stop the lab taking cases. The failure is recorded in
    -- system_warnings so it is findable, instead of only reaching a log nobody
    -- reads.
    BEGIN
        PERFORM public.sync_production_from_order(NEW.id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync_production_from_order(%) failed: %', NEW.id, SQLERRM;
        PERFORM public.log_system_warning(
            'sync_production_from_order', NEW.id, SQLERRM, SQLSTATE);
    END;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sync_production_from_order() FROM PUBLIC, anon;


-- The material attribution swallow gets the same treatment. The body is
-- unchanged apart from the logging calls; see 20260827001000 for the reasoning.
CREATE OR REPLACE FUNCTION public.trg_attribute_material_usage_on_stage_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stage_id UUID := NEW.stage_id;
    v_passed_units NUMERIC := COALESCE(NEW.units_passed, NEW.units_in, 1);
    v_binding RECORD;
    v_open_batch RECORD;
BEGIN
    -- Nothing to attribute until the lab is actually consuming its own stock.
    IF NOT EXISTS (SELECT 1 FROM public.stage_material_bindings WHERE stage_id = v_stage_id) THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done' OR OLD.completed_at IS NULL) THEN
        FOR v_binding IN
            SELECT b.material_id, b.consumption_mode, b.qty_per_unit, b.is_required
              FROM public.stage_material_bindings b
             WHERE b.stage_id = v_stage_id
        LOOP
            SELECT mb.id, mb.qty_remaining
              INTO v_open_batch
              FROM public.material_batches mb
             WHERE mb.material_id = v_binding.material_id
               AND mb.status = 'open'
             ORDER BY mb.opened_at ASC
             LIMIT 1;

            IF FOUND THEN
                INSERT INTO public.material_batch_usage (
                    batch_id, stage_run_id, units_attributed, attributed_at
                ) VALUES (
                    v_open_batch.id, NEW.id, v_passed_units, NOW()
                )
                ON CONFLICT (batch_id, stage_run_id) DO UPDATE
                    SET units_attributed = EXCLUDED.units_attributed,
                        attributed_at = NOW();

                -- The movement is the only write: trg_material_movements_rebalance
                -- recomputes qty_remaining from it.
                IF v_binding.consumption_mode = 'per_unit_qty' AND COALESCE(v_binding.qty_per_unit, 0) > 0 THEN
                    DECLARE
                        v_deduct_qty NUMERIC := v_passed_units * v_binding.qty_per_unit;
                    BEGIN
                        INSERT INTO public.material_movements (
                            batch_id, warehouse_id, movement_type, qty, stage_run_id, notes, created_by
                        ) VALUES (
                            v_open_batch.id,
                            (SELECT warehouse_id FROM public.material_batches WHERE id = v_open_batch.id),
                            'consume', -v_deduct_qty, NEW.id, 'استهلاك تلقائي لأمر التشغيل', auth.uid()
                        );

                        UPDATE public.material_batches
                           SET status      = CASE WHEN qty_remaining <= 0 THEN 'depleted' ELSE status END,
                               depleted_at = CASE WHEN qty_remaining <= 0 THEN COALESCE(depleted_at, NOW()) ELSE depleted_at END,
                               depleted_by = CASE WHEN qty_remaining <= 0 THEN COALESCE(depleted_by, auth.uid()) ELSE depleted_by END,
                               updated_at  = NOW()
                         WHERE id = v_open_batch.id;
                    END;
                END IF;

            -- A required material with no open batch is the "الخامة خلصت" case:
            -- the crown was made out of something nobody recorded, so its
            -- material cost will be missing and the stock never moved. Silence
            -- here would show up much later as a crown that cost nothing.
            ELSIF v_binding.is_required THEN
                PERFORM public.log_system_warning(
                    'material_attribution_no_open_batch', NEW.id,
                    format('مرحلة خلصت ومفيش لوت مفتوح لخامة مطلوبة (material_id=%s)', v_binding.material_id),
                    NULL);
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    -- DELIBERATE SWALLOW: material bookkeeping must never block a technician
    -- finishing a case. Recorded so the gap is findable.
    RAISE WARNING 'material attribution for stage_run % failed: %', NEW.id, SQLERRM;
    PERFORM public.log_system_warning(
        'material_attribution', NEW.id, SQLERRM, SQLSTATE);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_attribute_material_usage_on_stage_complete() FROM PUBLIC, anon;


-- ─────────────────────────────────────────────────────────────────────────
-- Reading them
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_open_system_warnings(p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows JSONB;
    v_total INTEGER;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'lab') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*) INTO v_total
      FROM public.system_warnings WHERE acknowledged_at IS NULL;

    SELECT COALESCE(jsonb_agg(w), '[]'::jsonb) INTO v_rows FROM (
        SELECT source, ref_id, message, sqlstate, occurred_at
          FROM public.system_warnings
         WHERE acknowledged_at IS NULL
         ORDER BY occurred_at DESC
         LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    ) w;

    RETURN jsonb_build_object('open_count', v_total, 'warnings', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_open_system_warnings(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_system_warnings(INTEGER) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- orders.items: marked deprecated, in the one place nobody can miss it
-- ─────────────────────────────────────────────────────────────────────────
-- 0460_normalize_schema moved line items into order_items and left this column
-- behind. It is populated on 417 of 1166 live orders, so reading it looks like
-- it works and quietly returns one unit for the other two thirds. It has
-- already caused two wrong-number bugs in the costing work (unit counts and the
-- service-family join). The comment is here so the next person querying it sees
-- the warning in the schema itself rather than finding out from a report.
COMMENT ON COLUMN public.orders.items IS
'DEPRECATED -- pre-0460_normalize_schema line items. Populated on well under half the order base; reading it silently under-counts. Use public.order_items (product_type, count, price) instead. Kept only so historical rows are not destroyed.';

COMMIT;
