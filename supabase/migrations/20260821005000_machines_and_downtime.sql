-- Machines, downtime, and charging lost time to the fault instead of the stage.
--
-- THE PROBLEM
--   The sintering furnace dies at 10:00 and is fixed at 15:00. Every case
--   waiting on it accrues five hours. With no notion of downtime those five
--   hours land on the STAGE -- so the bottleneck report names sintering as
--   slow, the technician standing next to a dead furnace looks unproductive,
--   and the actual cause (a broken machine) is invisible in every report.
--
-- THE RULE
--   Time lost to a fault is charged to the FAULT, not to the stage that was
--   standing still because of it. Each run keeps its gross figures untouched
--   -- the case really did sit there, and the doctor really did wait -- and
--   gains blocked_minutes, so the reports can show:
--     gross   what the case experienced          (the doctor's truth)
--     net     gross - blocked                    (the stage's truth)
--     blocked rolled up per machine and fault    (the maintenance truth)
--   Deleting the time instead of moving it would hide a real delay from the
--   doctor; leaving it on the stage would blame the wrong thing. It has to be
--   attributed, not erased.
--
-- WHEN DOES A FAULT COUNT AGAINST A RUN?
--   Only when the stage was genuinely halted:
--     * the run names the broken machine, OR
--     * the stage has exactly ONE active machine and that machine was down --
--       one mill out of three does not stop the milling stage, but the only
--       furnace being dead does stop sintering.
--   Anything looser would let an idle spare machine's maintenance quietly
--   erase real queue time.
--
-- External runs are never adjusted: a vendor's broken machine is inside the
-- turnaround we are paying them for.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Machines
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.machines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                   TEXT NOT NULL UNIQUE,
    name_ar                TEXT NOT NULL,
    stage_id               UUID REFERENCES public.production_stages(id) ON DELETE SET NULL,
    -- fixed_assets already carries the money side (purchase value, depreciation).
    -- This is the operational side; they are deliberately separate records.
    fixed_asset_id         UUID REFERENCES public.fixed_assets(id) ON DELETE SET NULL,
    status                 TEXT NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running', 'down', 'maintenance', 'retired')),
    capacity_units_per_run INTEGER,
    purchase_date          DATE,
    warranty_until         DATE,
    notes                  TEXT,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_machines_stage
    ON public.machines (stage_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.machine_downtime (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id  UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL,
    -- NULL means still down. Reports must show that as "ongoing", never as
    -- zero -- a fault nobody closed is the worst kind to hide.
    ended_at    TIMESTAMPTZ,
    reason      TEXT NOT NULL DEFAULT 'breakdown'
                CHECK (reason IN ('breakdown', 'maintenance', 'power', 'other')),
    notes       TEXT,
    reported_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    -- Repair and parts. Feeds overhead, never a per-order obligation.
    cost_amount NUMERIC(12, 2),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_machine_downtime_order
        CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_machine_downtime_window
    ON public.machine_downtime (machine_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_downtime_one_open
    ON public.machine_downtime (machine_id) WHERE ended_at IS NULL;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['machines', 'machine_downtime'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'update_' || t || '_updated_at', t);
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
            'update_' || t || '_updated_at', t);
    END LOOP;
END;
$$;

ALTER TABLE public.production_stage_runs
    ADD COLUMN IF NOT EXISTS machine_id      UUID REFERENCES public.machines(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS blocked_minutes NUMERIC(12, 2);

COMMENT ON COLUMN public.production_stage_runs.blocked_minutes IS
'Working minutes inside this run lost to machine downtime. Charged to the fault, not to the stage or the technician. Gross figures stay untouched.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. How much of a run was lost to a dead machine
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.stage_run_blocked_minutes(
    p_stage_id   UUID,
    p_machine_id UUID,
    p_from       TIMESTAMPTZ,
    p_to         TIMESTAMPTZ,
    p_execution  TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total NUMERIC := 0;
    d       RECORD;
BEGIN
    -- A vendor's broken machine is inside the turnaround we pay for.
    IF p_execution = 'external' OR p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RETURN 0;
    END IF;

    FOR d IN
        SELECT dt.started_at, COALESCE(dt.ended_at, NOW()) AS ended_at
          FROM public.machine_downtime dt
          JOIN public.machines m ON m.id = dt.machine_id
         WHERE (
                 -- the run names the machine that broke
                 (p_machine_id IS NOT NULL AND dt.machine_id = p_machine_id)
                 -- or the stage had a single active machine, so it truly halted
                 OR (p_machine_id IS NULL
                     AND m.stage_id = p_stage_id
                     AND m.is_active
                     AND (SELECT COUNT(*) FROM public.machines m2
                           WHERE m2.stage_id = p_stage_id AND m2.is_active
                             AND m2.status <> 'retired') = 1)
               )
           AND dt.started_at < p_to
           AND COALESCE(dt.ended_at, NOW()) > p_from
    LOOP
        -- Overlap measured on the working calendar: an overnight breakdown
        -- costs us only the working hours it actually consumed.
        v_total := v_total + COALESCE(
            public.working_minutes_between(
                GREATEST(d.started_at, p_from),
                LEAST(d.ended_at, p_to)), 0);
    END LOOP;

    RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.stage_run_blocked_minutes(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) IS
'Working minutes of a run lost to machine downtime. Counts only when the run names the broken machine, or when the stage had one machine and it was down.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Fold it into the duration trigger
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_stage_run_durations()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.wait_elapsed_minutes := CASE
        WHEN NEW.queued_at IS NULL OR NEW.started_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (NEW.started_at - NEW.queued_at)) / 60.0 END;

    NEW.touch_elapsed_minutes := CASE
        WHEN NEW.started_at IS NULL OR NEW.completed_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) / 60.0 END;

    NEW.stage_elapsed_minutes := CASE
        WHEN NEW.queued_at IS NULL OR NEW.completed_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (NEW.completed_at - NEW.queued_at)) / 60.0 END;

    IF NEW.execution = 'external' THEN
        NEW.duration_basis := 'wall_clock';
        NEW.wait_minutes   := NEW.wait_elapsed_minutes;
        NEW.touch_minutes  := NEW.touch_elapsed_minutes;
        NEW.stage_minutes  := NEW.stage_elapsed_minutes;
    ELSE
        NEW.duration_basis := 'working';
        NEW.wait_minutes   := public.working_minutes_between(NEW.queued_at, NEW.started_at);
        NEW.touch_minutes  := public.working_minutes_between(NEW.started_at, NEW.completed_at);
        NEW.stage_minutes  := public.working_minutes_between(NEW.queued_at, NEW.completed_at);
    END IF;

    NEW.blocked_minutes := public.stage_run_blocked_minutes(
        NEW.stage_id, NEW.machine_id, NEW.queued_at,
        COALESCE(NEW.completed_at, NEW.started_at), NEW.execution);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stage_run_durations ON public.production_stage_runs;
CREATE TRIGGER trg_sync_stage_run_durations
    BEFORE INSERT OR UPDATE OF queued_at, started_at, completed_at, execution, machine_id
    ON public.production_stage_runs
    FOR EACH ROW EXECUTE FUNCTION public.sync_stage_run_durations();

-- A fault is almost always logged AFTER the cases it delayed have moved on,
-- so recording one has to reach back and re-attribute the affected runs.
-- Without this, downtime entered at the end of the day would change nothing.
CREATE OR REPLACE FUNCTION public.reattribute_downtime_to_runs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_machine UUID;
    v_from    TIMESTAMPTZ;
    v_to      TIMESTAMPTZ;
    v_stage   UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_machine := OLD.machine_id;
        v_from    := OLD.started_at;
        v_to      := COALESCE(OLD.ended_at, NOW());
    ELSIF TG_OP = 'INSERT' THEN
        v_machine := NEW.machine_id;
        v_from    := NEW.started_at;
        v_to      := COALESCE(NEW.ended_at, NOW());
    ELSE
        v_machine := NEW.machine_id;
        v_from    := LEAST(OLD.started_at, NEW.started_at);
        v_to      := GREATEST(COALESCE(OLD.ended_at, NOW()), COALESCE(NEW.ended_at, NOW()));
    END IF;

    SELECT stage_id INTO v_stage FROM public.machines WHERE id = v_machine;

    UPDATE public.production_stage_runs r
       SET blocked_minutes = public.stage_run_blocked_minutes(
               r.stage_id, r.machine_id, r.queued_at,
               COALESCE(r.completed_at, r.started_at), r.execution)
     WHERE r.execution = 'internal'
       AND (r.machine_id = v_machine OR (r.machine_id IS NULL AND r.stage_id = v_stage))
       AND r.queued_at IS NOT NULL
       AND r.queued_at < v_to
       AND COALESCE(r.completed_at, r.started_at, NOW()) > v_from;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reattribute_downtime ON public.machine_downtime;
CREATE TRIGGER trg_reattribute_downtime
    AFTER INSERT OR UPDATE OR DELETE ON public.machine_downtime
    FOR EACH ROW EXECUTE FUNCTION public.reattribute_downtime_to_runs();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Gross, net and blocked side by side
-- ─────────────────────────────────────────────────────────────────────────

-- Dropped rather than replaced: CREATE OR REPLACE VIEW cannot insert a column
-- into the middle of an existing definition.
DROP VIEW IF EXISTS public.production_stage_run_costing;

CREATE VIEW public.production_stage_run_costing AS
SELECT
    r.id                AS stage_run_id,
    r.job_id,
    r.stage_id,
    r.machine_id,
    r.assignee_id,
    r.supplier_id,
    r.execution,
    r.batch_group_id,
    r.units_in,
    r.units_passed,
    r.units_failed,
    r.touch_minutes,
    r.wait_minutes,
    r.stage_minutes,
    r.stage_elapsed_minutes,
    COALESCE(r.blocked_minutes, 0)                                   AS blocked_minutes,
    -- What the stage is answerable for, once a dead machine is taken out.
    GREATEST(COALESCE(r.wait_minutes, 0)  - COALESCE(r.blocked_minutes, 0), 0) AS wait_minutes_net,
    GREATEST(COALESCE(r.stage_minutes, 0) - COALESCE(r.blocked_minutes, 0), 0) AS stage_minutes_net,
    r.duration_basis,
    COALESCE(b.batch_size, 1) AS batch_size,
    COALESCE(r.labor_minutes, r.touch_minutes) / COALESCE(b.batch_size, 1)
                        AS costed_touch_minutes
FROM public.production_stage_runs r
LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS batch_size
      FROM public.production_stage_runs sib
     WHERE r.batch_group_id IS NOT NULL
       AND sib.batch_group_id = r.batch_group_id
) b ON TRUE;

COMMENT ON VIEW public.production_stage_run_costing IS
'Stage runs with batch-split labour and downtime removed. Use *_net to judge a stage or a technician; use the gross columns for what the case and the doctor actually experienced.';

-- The maintenance truth: what each fault cost in halted production.
CREATE OR REPLACE VIEW public.machine_downtime_impact AS
SELECT
    m.id                                   AS machine_id,
    m.code,
    m.name_ar,
    m.stage_id,
    COUNT(dt.id)                           AS downtime_events,
    COUNT(dt.id) FILTER (WHERE dt.ended_at IS NULL) AS still_down,
    SUM(COALESCE(dt.cost_amount, 0))       AS repair_cost,
    -- Working hours lost, summed from what the runs actually absorbed rather
    -- than from the raw fault length: a breakdown overnight costs nothing.
    COALESCE((SELECT SUM(r.blocked_minutes)
                FROM public.production_stage_runs r
               WHERE r.machine_id = m.id), 0) AS blocked_minutes_on_named_runs
FROM public.machines m
LEFT JOIN public.machine_downtime dt ON dt.machine_id = m.id
GROUP BY m.id, m.code, m.name_ar, m.stage_id;

COMMENT ON VIEW public.machine_downtime_impact IS
'Per-machine fault count, repair cost and production time lost. This is where halted-stage time is charged, instead of onto the stage or the technician.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RLS and grants
-- ─────────────────────────────────────────────────────────────────────────
-- A technician has to be able to say "the furnace is dead" the moment it
-- happens, so lab may write downtime. Machine records themselves are admin.

ALTER TABLE public.machines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_downtime ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_machines ON public.machines;
CREATE POLICY read_machines ON public.machines
    FOR SELECT TO authenticated USING (public.get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS admin_manage_machines ON public.machines;
CREATE POLICY admin_manage_machines ON public.machines
    FOR ALL TO authenticated
    USING (public.get_my_role() = 'admin')
    WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS read_machine_downtime ON public.machine_downtime;
CREATE POLICY read_machine_downtime ON public.machine_downtime
    FOR SELECT TO authenticated USING (public.get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS lab_manage_machine_downtime ON public.machine_downtime;
CREATE POLICY lab_manage_machine_downtime ON public.machine_downtime
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab'))
    WITH CHECK (public.get_my_role() IN ('admin', 'lab'));

REVOKE ALL ON FUNCTION public.stage_run_blocked_minutes(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_run_blocked_minutes(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.reattribute_downtime_to_runs() FROM PUBLIC, anon;

GRANT SELECT ON public.production_stage_run_costing TO authenticated;
GRANT SELECT ON public.machine_downtime_impact TO authenticated;

COMMIT;
