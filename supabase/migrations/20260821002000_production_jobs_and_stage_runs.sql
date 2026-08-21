-- Production jobs, stage runs and external work orders.
-- Internal lab plan, phase 0, item 3. See docs/INTERNAL_LAB_PLAN_AR.md 4.3-4.4.
--
-- ONE JOB PER (ORDER x ROUTE), NOT ONE PER ORDER
--   An order with 3 zirconia crowns and 2 temporary PMMA units is two
--   different chains, two different durations and two different costs. Forcing
--   them into one job would average a fast service with a slow one and make
--   every cycle-time number meaningless. So the order splits into groups by
--   route, and the ORDER is only finished when its slowest job is -- which is
--   what stops an invoice going out while half the case is still on the bench.
--
-- THE ROUTE IS SNAPSHOT AT CREATION
--   materialize_job_from_route() expands the route into concrete stage_runs
--   once. Editing a route afterwards changes NEW cases only. Without that, an
--   edit at 2pm would rewrite the history of every case in flight and the
--   reports built on them would quietly become fiction.
--
-- THREE DIFFERENT DURATIONS, NEVER ONE
--   queued_at ---- started_at ---- completed_at
--        |  wait       |   touch        |
--        \____________ stage ___________/
--   touch  = hands on the case. The only number a technician is answerable
--            for, and the only one that may drive piece-rate pay.
--   wait   = sat in the queue while other cases were finished. High wait with
--            low touch means the stage is short of capacity, not slow. This
--            is the bottleneck signal.
--   stage  = what the case actually experienced; sums to cycle time.
--   Each is stored twice: `_minutes` (working time, for performance) and
--   `_elapsed_minutes` (wall clock, for what we promise the doctor).
--
-- EXTERNAL STAGES ARE NEVER PASSED THROUGH OUR CALENDAR (plan 6.2)
--   A milling house's opening hours are not ours. Applying our shifts to their
--   turnaround produces a number with no meaning. For execution='external',
--   working time IS wall-clock time, and duration_basis records that. Their
--   weekends get absorbed into the average turnaround, which is exactly the
--   figure we should be planning and quoting against.
--
-- The feature flag `production_v1` stays OFF; nothing reads these tables yet.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Jobs
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.production_jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    route_id     UUID NOT NULL REFERENCES public.production_routes(id),
    -- 1 = the original pass. 2+ = a remake after the case came back.
    round_no     INTEGER NOT NULL DEFAULT 1 CHECK (round_no >= 1),
    unit_count   INTEGER NOT NULL DEFAULT 1 CHECK (unit_count > 0),
    status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'active', 'blocked', 'done', 'cancelled')),
    priority     TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'Urgent')),
    due_at       TIMESTAMPTZ,
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_production_jobs_order_route_round UNIQUE (order_id, route_id, round_no)
);

CREATE INDEX IF NOT EXISTS idx_production_jobs_order ON public.production_jobs (order_id);
CREATE INDEX IF NOT EXISTS idx_production_jobs_open
    ON public.production_jobs (due_at) WHERE status IN ('queued', 'active', 'blocked');

-- Which of the order's lines this job covers. Without this, a two-route order
-- could not say which crowns belong to which chain.
CREATE TABLE IF NOT EXISTS public.production_job_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id        UUID NOT NULL REFERENCES public.production_jobs(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
    units         INTEGER NOT NULL DEFAULT 1 CHECK (units > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_production_job_items UNIQUE (job_id, order_item_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Stage runs — the workhorse
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.production_stage_runs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                 UUID NOT NULL REFERENCES public.production_jobs(id) ON DELETE CASCADE,
    stage_id               UUID NOT NULL REFERENCES public.production_stages(id),
    seq                    INTEGER NOT NULL,
    parallel_group         INTEGER,
    execution              TEXT NOT NULL CHECK (execution IN ('internal', 'external')),
    advance_mode           TEXT NOT NULL DEFAULT 'auto'
                           CHECK (advance_mode IN ('auto', 'manual', 'qc_gate')),
    on_fail_goto_stage_id  UUID REFERENCES public.production_stages(id),

    assignee_id            UUID REFERENCES public.users(id) ON DELETE SET NULL,
    supplier_id            UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,

    status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'ready', 'in_progress',
                                             'waiting_external', 'done', 'failed', 'skipped')),
    -- Why the case is standing still. Time lost to a dead furnace is charged
    -- to the machine, not to the technician sitting in front of it.
    blocked_reason         TEXT CHECK (blocked_reason IN ('machine_down', 'material_out',
                                                          'waiting_doctor', 'other')),

    queued_at              TIMESTAMPTZ,
    started_at             TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,

    units_in               INTEGER NOT NULL DEFAULT 0 CHECK (units_in >= 0),
    units_passed           INTEGER NOT NULL DEFAULT 0 CHECK (units_passed >= 0),
    units_failed           INTEGER NOT NULL DEFAULT 0 CHECK (units_failed >= 0),

    -- Internal rework: this run redoes an earlier one. Deliberately NOT an
    -- order_issues row -- a failure QC caught before the case ever left the
    -- building is production quality, not a problem with the order, and
    -- mixing the two would corrupt every doctor and supplier issue report
    -- that already exists (plan 5.1).
    rework_of              UUID REFERENCES public.production_stage_runs(id) ON DELETE SET NULL,
    failure_cause_code     TEXT,

    -- Runs sharing a batch went through one furnace load / printer plate.
    batch_group_id         UUID,

    -- Working time: the calendar applied (internal) or wall clock (external).
    touch_minutes          NUMERIC(12, 2),
    wait_minutes           NUMERIC(12, 2),
    stage_minutes          NUMERIC(12, 2),
    -- Wall clock, always. This is what the doctor experiences.
    touch_elapsed_minutes  NUMERIC(12, 2),
    wait_elapsed_minutes   NUMERIC(12, 2),
    stage_elapsed_minutes  NUMERIC(12, 2),
    duration_basis         TEXT CHECK (duration_basis IN ('working', 'wall_clock')),

    -- Optional manual correction for the exceptional case. The clock is the
    -- default so nobody has to type a time.
    labor_minutes          NUMERIC(12, 2),

    cost_amount            NUMERIC(12, 2),
    cost_source            TEXT CHECK (cost_source IN ('standard', 'piece_rate',
                                                       'external_invoice', 'manual')),
    notes                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_stage_run_started_after_queued
        CHECK (started_at IS NULL OR queued_at IS NULL OR started_at >= queued_at),
    CONSTRAINT chk_stage_run_completed_after_started
        CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
    CONSTRAINT chk_stage_run_units_balance
        CHECK (units_passed + units_failed <= units_in),
    -- An external run has a supplier and no technician; an internal run is the
    -- other way round. Getting this wrong is how a vendor's turnaround ends up
    -- in a technician's productivity figures.
    CONSTRAINT chk_stage_run_execution_actor
        CHECK ((execution = 'external' AND assignee_id IS NULL)
               OR (execution = 'internal' AND supplier_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_stage_runs_job ON public.production_stage_runs (job_id, seq);
CREATE INDEX IF NOT EXISTS idx_stage_runs_queue
    ON public.production_stage_runs (stage_id, status, queued_at)
    WHERE status IN ('ready', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_stage_runs_assignee
    ON public.production_stage_runs (assignee_id, completed_at DESC)
    WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stage_runs_batch
    ON public.production_stage_runs (batch_group_id) WHERE batch_group_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. External work orders — milling and sintering, per stage not per case
-- ─────────────────────────────────────────────────────────────────────────
-- The payable still lands in financial_obligations through the existing
-- pipeline; this table records the physical hand-off and the turnaround we
-- plan against.

CREATE TABLE IF NOT EXISTS public.external_work_orders (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_run_id       UUID NOT NULL UNIQUE
                       REFERENCES public.production_stage_runs(id) ON DELETE CASCADE,
    supplier_id        UUID NOT NULL REFERENCES public.suppliers(id),
    sent_at            TIMESTAMPTZ,
    expected_return_at TIMESTAMPTZ,
    returned_at        TIMESTAMPTZ,
    units              INTEGER NOT NULL DEFAULT 1 CHECK (units > 0),
    agreed_cost        NUMERIC(12, 2),
    invoice_ref        TEXT,
    status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'sent', 'returned', 'cancelled')),
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_external_wo_returned_after_sent
        CHECK (returned_at IS NULL OR sent_at IS NULL OR returned_at >= sent_at)
);

CREATE INDEX IF NOT EXISTS idx_external_wo_supplier
    ON public.external_work_orders (supplier_id, sent_at DESC);

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['production_jobs', 'production_stage_runs',
                             'external_work_orders']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'update_' || t || '_updated_at', t);
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
            'update_' || t || '_updated_at', t);
    END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Durations, kept in step with the timestamps by trigger
-- ─────────────────────────────────────────────────────────────────────────
-- A trigger rather than a helper someone must remember to call: if the
-- durations could drift from the timestamps, the reports would disagree with
-- the audit trail and there would be no way to tell which one was lying.

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
        -- Plan 6.2: the vendor's hours are not ours. Wall clock is the honest
        -- measure here, and their weekends belong inside the turnaround we
        -- quote against.
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

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stage_run_durations ON public.production_stage_runs;
CREATE TRIGGER trg_sync_stage_run_durations
    BEFORE INSERT OR UPDATE OF queued_at, started_at, completed_at, execution
    ON public.production_stage_runs
    FOR EACH ROW EXECUTE FUNCTION public.sync_stage_run_durations();

-- Batch-aware labour, computed at read time rather than stored.
--
-- A sintering furnace takes 12 cases in one 90-minute run. Charging each case
-- 90 minutes invents 18 hours of work out of 90 minutes and would wreck both
-- the unit cost and every technician comparison. The split has to follow the
-- batch's CURRENT membership, which changes as cases are added -- so it is
-- derived here instead of frozen into a column that would go stale.
CREATE OR REPLACE VIEW public.production_stage_run_costing AS
SELECT
    r.id                AS stage_run_id,
    r.job_id,
    r.stage_id,
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
    r.duration_basis,
    COALESCE(b.batch_size, 1) AS batch_size,
    -- The minutes this run may actually be charged for.
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
'Stage runs with batch-split labour. costed_touch_minutes divides a shared furnace/printer run across its cases -- never charge a batch stage its full duration per case.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. materialize_job_from_route() — expand the map into a real chain
-- ─────────────────────────────────────────────────────────────────────────
-- Called once when a case enters production. From that moment the job owns
-- its own copy of the chain and later route edits cannot reach it.

CREATE OR REPLACE FUNCTION public.materialize_job_from_route(
    p_order_id   UUID,
    p_route_id   UUID DEFAULT NULL,
    p_unit_count INTEGER DEFAULT NULL,
    p_round_no   INTEGER DEFAULT 1,
    p_context    JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_route     UUID;
    v_order     public.orders;
    v_units     INTEGER;
    v_ctx       JSONB;
    v_job_id    UUID;
    v_first     INTEGER;
    v_stages    INTEGER := 0;
    r           RECORD;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'order % not found', p_order_id USING ERRCODE = '22023';
    END IF;

    v_route := COALESCE(p_route_id, public.resolve_route_for_order(p_order_id));
    IF v_route IS NULL THEN
        RAISE EXCEPTION 'no route resolved for order % and no fallback route exists', p_order_id
            USING ERRCODE = '22023';
    END IF;

    -- Context drives conditional stages. Built from the order unless the
    -- caller supplies one (a redo pass sets is_redo explicitly).
    v_ctx := COALESCE(p_context, jsonb_strip_nulls(jsonb_build_object(
                 'delivery_type', v_order.delivery_type,
                 'is_redo',       v_order.is_redo,
                 'priority',      v_order.priority)));

    v_units := COALESCE(p_unit_count,
                        NULLIF((SELECT SUM(COALESCE(oi.count, 1))::int
                                  FROM public.order_items oi
                                 WHERE oi.order_id = p_order_id), 0),
                        1);

    INSERT INTO public.production_jobs
        (order_id, route_id, round_no, unit_count, status, priority, due_at)
    VALUES
        (p_order_id, v_route, p_round_no, v_units, 'queued',
         COALESCE(v_order.priority, 'Normal'),
         v_order.delivery_date::timestamp AT TIME ZONE 'Africa/Cairo')
    RETURNING id INTO v_job_id;

    INSERT INTO public.production_job_items (job_id, order_item_id, units)
    SELECT v_job_id, oi.id, GREATEST(COALESCE(oi.count, 1), 1)
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id;

    -- The snapshot. Everything after this reads stage_runs, never the route.
    FOR r IN SELECT * FROM public.get_effective_route_stages(v_route, v_ctx) ORDER BY seq
    LOOP
        IF v_first IS NULL THEN
            v_first := r.seq;
        END IF;

        INSERT INTO public.production_stage_runs (
            job_id, stage_id, seq, parallel_group, execution, advance_mode,
            on_fail_goto_stage_id, supplier_id, status, queued_at, units_in)
        VALUES (
            v_job_id, r.stage_id, r.seq, r.parallel_group, r.execution,
            r.advance_mode, r.on_fail_goto_stage_id,
            CASE WHEN r.execution = 'external' THEN r.supplier_id END,
            -- Only the first step is ready to be picked up; the rest wait for
            -- their predecessor. Advancing them is the phase-1 transition RPC.
            CASE WHEN r.seq = v_first THEN 'ready' ELSE 'pending' END,
            CASE WHEN r.seq = v_first THEN NOW() END,
            v_units);

        v_stages := v_stages + 1;
    END LOOP;

    IF v_stages = 0 THEN
        RAISE EXCEPTION 'route % resolved to an empty stage chain', v_route
            USING ERRCODE = '22023';
    END IF;

    RETURN v_job_id;
END;
$$;

COMMENT ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) IS
'Creates a production job and snapshots the route into concrete stage runs. Later route edits never touch an existing job.';

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────────────────
-- Read is open to any signed-in user: the technician's queue, the production
-- board and the doctor's stage display all read these. Writes are admin/lab
-- until the phase-1 transition RPCs and the technician role land -- better to
-- start closed and open deliberately than to discover an open table later.

ALTER TABLE public.production_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_job_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_stage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_work_orders  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['production_jobs', 'production_job_items',
                             'production_stage_runs', 'external_work_orders']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'read_' || t, t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.get_my_role() IS NOT NULL)',
            'read_' || t, t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'manage_' || t, t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.get_my_role() IN (''admin'', ''lab'')) WITH CHECK (public.get_my_role() IN (''admin'', ''lab''))',
            'manage_' || t, t);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) TO authenticated;

GRANT SELECT ON public.production_stage_run_costing TO authenticated;

COMMIT;
