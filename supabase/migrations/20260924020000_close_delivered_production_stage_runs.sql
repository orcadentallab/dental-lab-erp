-- ============================================================================
-- Migration: 20260924020000_close_delivered_production_stage_runs.sql
-- Description:
--   1. Ensures sync_production_from_order recognises orders marked as 'Delivered'
--      or 'Completed' and closes any remaining stage runs and production jobs.
--   2. Updates trg_order_drives_production to trigger on changes to `status` as
--      well as `production_status`.
--   3. Closes all orphaned open stage runs and production jobs for already-delivered,
--      completed, or deleted orders.
-- ============================================================================

BEGIN;

-- 1. sync_production_from_order with legacy status check for Delivered / Completed
CREATE OR REPLACE FUNCTION public.sync_production_from_order(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    o          public.orders;
    v_job      UUID;
    v_since    TIMESTAMPTZ;
    v_status   TEXT;
    v_target   INTEGER;
    v_now      TIMESTAMPTZ := NOW();
    v_design   INTEGER;
    v_ext1     INTEGER;
    v_ext2     INTEGER;
    v_doctor   INTEGER;
    v_ship     INTEGER;
    v_last     INTEGER;
    v_fallback UUID;
    v_jobs     UUID[] := ARRAY[]::UUID[];
    v_job_new  UUID;
    v_units    INTEGER;
    r          RECORD;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    IF o.id IS NULL OR COALESCE(o.is_deleted, FALSE) THEN
        -- If deleted, close any open runs
        IF o.id IS NOT NULL THEN
            UPDATE public.production_stage_runs
               SET status = 'skipped'
             WHERE job_id IN (SELECT id FROM public.production_jobs WHERE order_id = p_order_id AND NOT is_backfilled)
               AND status IN ('pending', 'ready', 'in_progress', 'waiting_external');

            UPDATE public.production_jobs
               SET status = 'cancelled', completed_at = COALESCE(completed_at, v_now)
             WHERE order_id = p_order_id AND NOT is_backfilled AND status <> 'done';
        END IF;
        RETURN NULL;
    END IF;

    SELECT id INTO v_job
      FROM public.production_jobs
     WHERE order_id = p_order_id AND NOT is_backfilled
     ORDER BY round_no
     LIMIT 1;

    -- Cancelled and lab-rejected cases were never worked.
    IF COALESCE(o.issue_state, 'none') IN ('cancelled', 'lab_rejected') OR o.status IN ('Cancelled', 'Lab Rejected') THEN
        IF v_job IS NOT NULL THEN
            UPDATE public.production_stage_runs
               SET status = 'skipped'
             WHERE job_id IN (SELECT id FROM public.production_jobs WHERE order_id = p_order_id AND NOT is_backfilled)
               AND status IN ('pending', 'ready', 'in_progress', 'waiting_external');

            UPDATE public.production_jobs
               SET status = 'cancelled', completed_at = COALESCE(completed_at, v_now)
             WHERE order_id = p_order_id AND NOT is_backfilled AND status <> 'done';
        END IF;
        RETURN v_job;
    END IF;

    -- Normalize status: if order is Delivered or Completed, it is final_delivered
    v_status := COALESCE(o.production_status, 'not_started');
    IF o.status IN ('Delivered', 'Completed') THEN
        v_status := 'final_delivered';
    END IF;

    IF v_job IS NULL THEN
        SELECT value::timestamptz INTO v_since
          FROM public.app_settings WHERE key = 'production_autostart_since';

        IF v_since IS NULL
           OR o.created_at < v_since
           OR v_status NOT IN ('not_started', 'designing', 'in_production') THEN
            RETURN NULL;
        END IF;

        -- Phase W Layer 0 Z8: Group items by service route
        SELECT id INTO v_fallback FROM public.production_routes
         WHERE is_fallback AND is_active LIMIT 1;

        FOR r IN
            SELECT COALESCE(sv.route_id, v_fallback) AS route_id,
                   SUM(COALESCE(oi.count, 1))::int   AS units,
                   array_agg(oi.id)                  AS item_ids
              FROM public.order_items oi
              LEFT JOIN public.services sv ON sv.name = oi.product_type
             WHERE oi.order_id = p_order_id
             GROUP BY COALESCE(sv.route_id, v_fallback)
        LOOP
            IF r.route_id IS NOT NULL THEN
                v_units := GREATEST(r.units, 1);
                v_job_new := public.materialize_job_from_route(
                    p_order_id, r.route_id, v_units,
                    1 + COALESCE(array_length(v_jobs, 1), 0));

                DELETE FROM public.production_job_items
                 WHERE job_id = v_job_new AND NOT (order_item_id = ANY (r.item_ids));

                v_jobs := v_jobs || v_job_new;
            END IF;
        END LOOP;

        IF COALESCE(array_length(v_jobs, 1), 0) = 0 THEN
            v_job := public.materialize_job_from_route(p_order_id, NULL, NULL, 1);
        ELSE
            v_job := v_jobs[1];
        END IF;
    END IF;

    -- Where each landmark sits on this case's chain
    SELECT MIN(r.seq) FILTER (WHERE s.code = 'design'),
           MIN(r.seq) FILTER (WHERE s.code = 'external_full'),
           MAX(r.seq) FILTER (WHERE s.code = 'external_full'),
           MIN(r.seq) FILTER (WHERE s.code = 'doctor_review'),
           MIN(r.seq) FILTER (WHERE s.code = 'shipping'),
           MAX(r.seq)
      INTO v_design, v_ext1, v_ext2, v_doctor, v_ship, v_last
      FROM public.production_stage_runs r
      JOIN public.production_stages s ON s.id = r.stage_id
     WHERE r.job_id = v_job;

    v_target := CASE v_status
        WHEN 'not_started'     THEN COALESCE(v_design, v_ext1)
        WHEN 'designing'       THEN COALESCE(v_design, v_ext1)
        WHEN 'in_production'   THEN COALESCE(v_ext1, v_design)
        WHEN 'try_in_ready'    THEN COALESCE(v_doctor, v_ext1)
        WHEN 'waiting_doctor'  THEN COALESCE(v_doctor, v_ext1)
        WHEN 'finalization'    THEN COALESCE(v_ext2, v_ext1)
        WHEN 'final_ready'     THEN COALESCE(v_ship, v_last)
        WHEN 'final_delivered' THEN NULL
        ELSE COALESCE(v_ext1, v_design)
    END;

    IF v_status = 'final_delivered' THEN
        UPDATE public.production_stage_runs
           SET status = 'done', completed_at = COALESCE(completed_at, v_now)
         WHERE job_id IN (SELECT id FROM public.production_jobs WHERE order_id = p_order_id AND NOT is_backfilled)
           AND status IN ('pending', 'ready', 'in_progress', 'waiting_external');

        UPDATE public.production_jobs
           SET status = 'done', completed_at = COALESCE(completed_at, v_now)
         WHERE order_id = p_order_id AND NOT is_backfilled AND status <> 'done';
    ELSIF v_target IS NOT NULL THEN
        UPDATE public.production_stage_runs
           SET status = 'done', completed_at = COALESCE(completed_at, v_now)
         WHERE job_id = v_job AND seq < v_target
           AND status IN ('pending', 'ready');

        UPDATE public.production_stage_runs
           SET status = CASE WHEN execution = 'external' THEN 'waiting_external' ELSE 'ready' END
         WHERE job_id = v_job AND seq = v_target
           AND status = 'pending';
    END IF;

    RETURN v_job;
END;
$$;

-- 2. Update trigger to include `status`
DROP TRIGGER IF EXISTS trg_order_drives_production ON public.orders;
CREATE TRIGGER trg_order_drives_production
    AFTER INSERT OR UPDATE OF status, production_status, issue_state, design_submitted_at,
                              delivery_type, workflow_type, is_deleted
    ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.trg_sync_production_from_order();

-- 3. Cleanup existing orphaned runs for already delivered/completed or deleted orders
UPDATE public.production_stage_runs psr
   SET status = 'done', completed_at = COALESCE(psr.completed_at, NOW())
  FROM public.production_jobs pj
  JOIN public.orders o ON o.id = pj.order_id
 WHERE psr.job_id = pj.id
   AND psr.status IN ('pending', 'ready', 'in_progress', 'waiting_external')
   AND (
       o.status IN ('Delivered', 'Completed')
       OR o.production_status = 'final_delivered'
       OR COALESCE(o.is_deleted, FALSE) = TRUE
   );

UPDATE public.production_jobs pj
   SET status = 'done', completed_at = COALESCE(pj.completed_at, NOW())
  FROM public.orders o
 WHERE o.id = pj.order_id
   AND pj.status <> 'done'
   AND (
       o.status IN ('Delivered', 'Completed')
       OR o.production_status = 'final_delivered'
       OR COALESCE(o.is_deleted, FALSE) = TRUE
   );

-- 4. Backfill supplier_id on external stage runs from the order
UPDATE public.production_stage_runs psr
   SET supplier_id = o.supplier_id
  FROM public.production_jobs pj
  JOIN public.orders o ON o.id = pj.order_id
 WHERE psr.job_id = pj.id
   AND psr.execution = 'external'
   AND psr.supplier_id IS NULL
   AND o.supplier_id IS NOT NULL;

COMMIT;
