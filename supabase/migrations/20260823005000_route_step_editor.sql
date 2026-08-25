-- The route step editor: one atomic save, and the step's identity carried
-- onto the run that gets worked.
--
-- WHY AN RPC AND NOT PLAIN TABLE WRITES
--   production_route_stages has a UNIQUE (route_id, step_no) index, and it is
--   not deferrable. Reordering steps from the client would therefore have to
--   walk through positions that collide -- moving step 3 above step 2 needs
--   both to hold 20 for an instant. The workarounds are all bad: a temporary
--   negative position leaves the route corrupt if the second request never
--   lands, and renumbering twice is 2N round trips with no transaction around
--   them. A route half-saved is a route that builds the wrong chain for every
--   case started after it, so the whole list is replaced in one statement or
--   not at all.
--
-- WHY THE WHOLE LIST IS REPLACED
--   A route IS its ordered step list since 20260823002000. 'excluded' and
--   'override' rows are leftovers of the composition model that preceded it;
--   no route in production has any (checked: every row is 'included'). Saving
--   a step list therefore states the route completely, and a diff-based save
--   would only preserve rows the editor cannot show.
--
-- WHY AN EMPTY LIST IS REFUSED
--   get_effective_route_stages falls back to the global chain when a route
--   has no steps, so a new route is never unusable. That fallback is right for
--   a route nobody has laid out yet and catastrophic for one somebody just
--   emptied: clearing the DEFAULT route would silently put every unmapped
--   order -- which today means all of them -- onto the full in-house chain,
--   for work that never enters the building. Deleting the last step is
--   refused; deleting the route is a separate, visible act.
--
-- WHY THE RUN CARRIES variant_label / name_override / allowed_roles
--   20260823002000 put them on the step so "the route step records what is
--   being printed so the technician knows which resin to load" -- but nothing
--   copied them onto the run, so the technician's card never showed them and
--   allowed_roles filtered nothing. They belong on the run for the same reason
--   execution and advance_mode already are: the run is the frozen copy of what
--   the route said at materialisation, and editing a route at 2pm must not
--   rewrite the history of a case that started at 10am.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. The chain exposes the override separately from the resolved name
-- ─────────────────────────────────────────────────────────────────────────
-- name_ar stays COALESCE(override, catalogue) for every read-only consumer.
-- name_override is the raw value, so materialisation can freeze the route's
-- decision without also freezing the catalogue name -- renaming a stage in the
-- catalogue should still reach cases already on the floor.

DROP FUNCTION IF EXISTS public.get_effective_route_stages(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.get_effective_route_stages(
    p_route_id UUID,
    p_context  JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    seq                       INTEGER,
    stage_id                  UUID,
    stage_code                TEXT,
    name_ar                   TEXT,
    name_override             TEXT,
    variant_label             TEXT,
    allowed_roles             TEXT[],
    execution                 TEXT,
    supplier_id               UUID,
    is_qc_gate                BOOLEAN,
    is_batch_stage            BOOLEAN,
    parallel_group            INTEGER,
    advance_mode              TEXT,
    on_fail_goto_stage_id     UUID,
    standard_minutes_per_unit NUMERIC,
    standard_cost_per_unit    NUMERIC,
    required_fields           JSONB,
    applies_when              JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- A row is a STEP only when mode='included'. An 'override' row exists to
    -- change how a stage behaves on this route, not to be the route.
    WITH inc AS (
        SELECT rs.stage_id, rs.step_no, rs.seq_override, rs.variant_label,
               rs.name_override, rs.allowed_roles, rs.parallel_group,
               rs.condition, rs.execution_override, rs.supplier_override,
               rs.standard_minutes_per_unit, rs.standard_cost_per_unit,
               rs.advance_mode, rs.on_fail_goto_stage_id
          FROM public.production_route_stages rs
          JOIN public.production_stages s ON s.id = rs.stage_id
          JOIN public.production_routes r ON r.id = rs.route_id
         WHERE rs.route_id = p_route_id AND r.is_active
           AND s.is_active AND rs.mode = 'included'
    ),
    ovr AS (
        SELECT rs.stage_id, rs.variant_label, rs.name_override, rs.allowed_roles,
               rs.parallel_group, rs.condition, rs.execution_override,
               rs.supplier_override, rs.standard_minutes_per_unit,
               rs.standard_cost_per_unit, rs.advance_mode, rs.on_fail_goto_stage_id
          FROM public.production_route_stages rs
         WHERE rs.route_id = p_route_id AND rs.mode = 'override'
    ),
    exc AS (
        SELECT rs.stage_id FROM public.production_route_stages rs
         WHERE rs.route_id = p_route_id AND rs.mode = 'excluded'
    ),
    fallback AS (
        SELECT s.id AS stage_id, s.sequence AS step_no, NULL::integer AS seq_override,
               NULL::text AS variant_label, NULL::text AS name_override,
               '{}'::text[] AS allowed_roles, NULL::integer AS parallel_group,
               s.default_condition AS condition, NULL::text AS execution_override,
               NULL::uuid AS supplier_override,
               NULL::numeric AS standard_minutes_per_unit,
               NULL::numeric AS standard_cost_per_unit,
               NULL::text AS advance_mode, NULL::uuid AS on_fail_goto_stage_id
          FROM public.production_stages s
         WHERE s.is_active AND s.scope = 'global'
           AND NOT EXISTS (SELECT 1 FROM inc)
    ),
    base AS (
        SELECT * FROM inc
        UNION ALL
        SELECT * FROM fallback
    )
    SELECT
        COALESCE(b.step_no, b.seq_override, s.sequence)          AS seq,
        b.stage_id,
        s.code                                                   AS stage_code,
        COALESCE(b.name_override, o.name_override, s.name_ar)    AS name_ar,
        COALESCE(b.name_override, o.name_override)               AS name_override,
        COALESCE(b.variant_label, o.variant_label)               AS variant_label,
        CASE WHEN COALESCE(array_length(b.allowed_roles, 1), 0) > 0
             THEN b.allowed_roles
             ELSE COALESCE(o.allowed_roles, '{}'::text[]) END    AS allowed_roles,
        COALESCE(b.execution_override, o.execution_override, s.default_execution) AS execution,
        COALESCE(b.supplier_override, o.supplier_override, s.default_supplier_id) AS supplier_id,
        s.is_qc_gate,
        s.is_batch_stage,
        COALESCE(b.parallel_group, o.parallel_group)             AS parallel_group,
        COALESCE(b.advance_mode, o.advance_mode,
                 CASE WHEN s.is_qc_gate THEN 'qc_gate' ELSE 'auto' END) AS advance_mode,
        COALESCE(b.on_fail_goto_stage_id, o.on_fail_goto_stage_id) AS on_fail_goto_stage_id,
        COALESCE(b.standard_minutes_per_unit, o.standard_minutes_per_unit),
        COALESCE(b.standard_cost_per_unit, o.standard_cost_per_unit),
        s.required_fields,
        COALESCE(b.condition, o.condition)                       AS applies_when
    FROM base b
    JOIN public.production_stages s ON s.id = b.stage_id
    LEFT JOIN ovr o ON o.stage_id = b.stage_id
    WHERE b.stage_id NOT IN (SELECT stage_id FROM exc)
      AND (COALESCE(b.condition, o.condition) IS NULL
           OR COALESCE(p_context, '{}'::jsonb) @> COALESCE(b.condition, o.condition))
    ORDER BY 1, s.code;
$$;

COMMENT ON FUNCTION public.get_effective_route_stages(UUID, JSONB) IS
'The ordered chain a case on this route walks. A stage may appear more than once (the try-in loop). Routes with no steps fall back to the global chain so a new route is never empty.';

REVOKE ALL ON FUNCTION public.get_effective_route_stages(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_route_stages(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. The run remembers which pass of the stage it is
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.production_stage_runs
    -- "واكس" / "بروفة" / "كاست" -- same printer, different resin.
    ADD COLUMN IF NOT EXISTS variant_label TEXT,
    -- The route's own name for this step, if it gave one.
    ADD COLUMN IF NOT EXISTS name_override TEXT,
    -- Empty means anyone who can work production. Frozen from the route so a
    -- later route edit cannot move a case out of somebody's queue mid-job.
    ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.production_stage_runs.allowed_roles IS
'Job types allowed to work this run, frozen from the route step. Empty means anyone on production.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Materialisation copies them onto the run
-- ─────────────────────────────────────────────────────────────────────────
-- Unchanged from 20260823003000 apart from the three new columns.

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
    v_route  UUID;
    v_order  public.orders;
    v_units  INTEGER;
    v_ctx    JSONB;
    v_job_id UUID;
    v_first  INTEGER;
    v_stages INTEGER := 0;
    r        RECORD;
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

    v_ctx := COALESCE(p_context, jsonb_strip_nulls(jsonb_build_object(
                 'delivery_type', v_order.delivery_type,
                 'workflow_type', v_order.workflow_type,
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

    FOR r IN SELECT * FROM public.get_effective_route_stages(v_route, v_ctx) ORDER BY seq
    LOOP
        IF v_first IS NULL THEN
            v_first := r.seq;
        END IF;

        INSERT INTO public.production_stage_runs (
            job_id, stage_id, seq, parallel_group, execution, advance_mode,
            on_fail_goto_stage_id, supplier_id, status, queued_at, units_in,
            variant_label, name_override, allowed_roles)
        VALUES (
            v_job_id, r.stage_id, r.seq, r.parallel_group, r.execution,
            r.advance_mode, r.on_fail_goto_stage_id,
            CASE WHEN r.execution = 'external' THEN r.supplier_id END,
            CASE WHEN r.seq = v_first THEN 'ready' ELSE 'pending' END,
            CASE WHEN r.seq = v_first THEN NOW() END,
            v_units,
            r.variant_label, r.name_override, COALESCE(r.allowed_roles, '{}'::text[]));

        v_stages := v_stages + 1;
    END LOOP;

    IF v_stages = 0 THEN
        RAISE EXCEPTION 'route % resolved to an empty stage chain', v_route
            USING ERRCODE = '22023';
    END IF;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) TO authenticated;

-- Rework repeats a step, so the repeat must carry that step's identity --
-- otherwise glaze failing sends the case back to finish as an unlabelled run
-- anybody may pick up, discarding exactly the control the route was configured
-- to set.
--
-- The source is the ORIGINAL run of the stage being returned TO, not the run
-- that failed. complete_stage_run inserts the rework at
-- (job, on_fail_goto_stage_id, MIN(seq) of that stage) while rework_of points
-- at the FAILING run -- a different stage with a different label. A glaze
-- failure returning to finish must say "finish", never "glaze".
--
-- A trigger rather than an edit to complete_stage_run, so that 90-line
-- transition function keeps one definition, in 20260821006000, where it reads.
CREATE OR REPLACE FUNCTION public.copy_step_identity_to_rework()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.rework_of IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(NEW.variant_label, o.variant_label),
           COALESCE(NEW.name_override, o.name_override),
           CASE WHEN COALESCE(array_length(NEW.allowed_roles, 1), 0) > 0
                THEN NEW.allowed_roles ELSE o.allowed_roles END
      INTO NEW.variant_label, NEW.name_override, NEW.allowed_roles
      FROM public.production_stage_runs o
     WHERE o.job_id = NEW.job_id
       AND o.stage_id = NEW.stage_id
       AND o.seq = NEW.seq
     -- The first pass, not an earlier rework of it: the original is the row
     -- materialisation stamped straight from the route.
     ORDER BY (o.rework_of IS NOT NULL), o.created_at
     LIMIT 1;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_copy_step_identity_to_rework ON public.production_stage_runs;
CREATE TRIGGER trg_copy_step_identity_to_rework
    BEFORE INSERT ON public.production_stage_runs
    FOR EACH ROW EXECUTE FUNCTION public.copy_step_identity_to_rework();

REVOKE ALL ON FUNCTION public.copy_step_identity_to_rework() FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. save_route_steps -- what the editor calls
-- ─────────────────────────────────────────────────────────────────────────
-- One transaction, one statement per step. Every element states the step
-- completely; position comes from array order, not from a number the user has
-- to keep consistent.
--
--   [{ "stage_id": uuid,             -- required
--      "variant_label": text|null,   -- "كاست"
--      "name_override": text|null,   -- this route's own name for the step
--      "allowed_roles": [text],      -- [] = anyone on production
--      "condition": {..}|null,       -- step applies only to matching orders
--      "execution": 'internal'|'external'|null,
--      "supplier_id": uuid|null,
--      "advance_mode": 'auto'|'manual'|'qc_gate'|null,
--      "on_fail_goto_stage_id": uuid|null,
--      "parallel_group": int|null,
--      "standard_minutes_per_unit": numeric|null,
--      "standard_cost_per_unit": numeric|null }]

CREATE OR REPLACE FUNCTION public.save_route_steps(
    p_route_id UUID,
    p_steps    JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    e        JSONB;
    n        INTEGER := 0;
    v_stage  UUID;
    v_roles  TEXT[];
    v_count  INTEGER;
BEGIN
    IF public.get_my_role() <> 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.production_routes
                    WHERE id = p_route_id AND is_active) THEN
        RAISE EXCEPTION 'route % not found or inactive', p_route_id USING ERRCODE = '22023';
    END IF;

    IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
        RAISE EXCEPTION 'steps must be a JSON array' USING ERRCODE = '22023';
    END IF;

    -- An empty route is not an empty route: it silently becomes the whole
    -- global chain. Refuse rather than let a save turn every unmapped order
    -- into an in-house case.
    IF jsonb_array_length(p_steps) = 0 THEN
        RAISE EXCEPTION 'a route must keep at least one step' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.production_route_stages WHERE route_id = p_route_id;

    FOR e IN SELECT * FROM jsonb_array_elements(p_steps)
    LOOP
        n := n + 10;
        v_stage := NULLIF(e ->> 'stage_id', '')::uuid;

        IF v_stage IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.production_stages
                WHERE id = v_stage AND is_active) THEN
            RAISE EXCEPTION 'step % refers to an unknown or inactive stage', n / 10
                USING ERRCODE = '22023';
        END IF;

        IF e ? 'condition' AND e -> 'condition' <> 'null'::jsonb
           AND jsonb_typeof(e -> 'condition') <> 'object' THEN
            RAISE EXCEPTION 'step % condition must be a JSON object', n / 10
                USING ERRCODE = '22023';
        END IF;

        v_roles := COALESCE(
            (SELECT array_agg(x) FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(e -> 'allowed_roles') = 'array'
                      THEN e -> 'allowed_roles' ELSE '[]'::jsonb END) x),
            '{}'::text[]);

        INSERT INTO public.production_route_stages
            (route_id, stage_id, mode, step_no, variant_label, name_override,
             allowed_roles, condition, execution_override, supplier_override,
             advance_mode, on_fail_goto_stage_id, parallel_group,
             standard_minutes_per_unit, standard_cost_per_unit)
        VALUES
            (p_route_id, v_stage, 'included', n,
             NULLIF(e ->> 'variant_label', ''),
             NULLIF(e ->> 'name_override', ''),
             v_roles,
             CASE WHEN e -> 'condition' IS NOT NULL
                   AND e -> 'condition' <> 'null'::jsonb
                  THEN e -> 'condition' END,
             NULLIF(e ->> 'execution', ''),
             NULLIF(e ->> 'supplier_id', '')::uuid,
             NULLIF(e ->> 'advance_mode', ''),
             NULLIF(e ->> 'on_fail_goto_stage_id', '')::uuid,
             NULLIF(e ->> 'parallel_group', '')::integer,
             NULLIF(e ->> 'standard_minutes_per_unit', '')::numeric,
             NULLIF(e ->> 'standard_cost_per_unit', '')::numeric);
    END LOOP;

    SELECT COUNT(*)::int INTO v_count
      FROM public.production_route_stages WHERE route_id = p_route_id;

    -- Bump the version so two chains can be told apart. Jobs already
    -- materialised keep their own stage_runs and are untouched by this.
    UPDATE public.production_routes
       SET version = version + 1
     WHERE id = p_route_id;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.save_route_steps(UUID, JSONB) IS
'Replaces a route step list atomically, in array order. Admin only. Refuses an empty list because an empty route silently falls back to the whole global chain.';

REVOKE ALL ON FUNCTION public.save_route_steps(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_route_steps(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Adding a stage to the catalogue without a migration
-- ─────────────────────────────────────────────────────────────────────────
-- Plan 4.1: "adding a stage must be configuration from the UI, not a
-- migration" -- the lab will add stages (3D print, orthodontics) after this
-- code ships. The code is derived, not typed: a hand-typed code colliding with
-- the RESPONSIBLE_STAGE vocabulary in src/constants/issueCauses.ts would
-- silently attach historical issue records to a brand-new stage.

CREATE OR REPLACE FUNCTION public.create_production_stage(
    p_name_ar        TEXT,
    p_description_ar TEXT DEFAULT NULL,
    p_execution      TEXT DEFAULT 'internal',
    p_driven_by      TEXT DEFAULT 'my_tasks',
    p_is_qc_gate     BOOLEAN DEFAULT FALSE,
    p_is_batch_stage BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_code TEXT;
    v_id   UUID;
    v_seq  INTEGER;
BEGIN
    IF public.get_my_role() <> 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF COALESCE(TRIM(p_name_ar), '') = '' THEN
        RAISE EXCEPTION 'stage name is required' USING ERRCODE = '22023';
    END IF;

    -- A generated, collision-proof code. Never reuses a catalogue code, so the
    -- historical issue vocabulary keeps pointing at what it always pointed at.
    v_code := left('custom_' || replace(gen_random_uuid()::text, '-', ''), 20);

    -- New stages land after everything in the catalogue. Position inside a
    -- route comes from the route's own step order, not from this number.
    SELECT COALESCE(MAX(sequence), 0) + 10 INTO v_seq FROM public.production_stages;

    INSERT INTO public.production_stages
        (code, name_ar, description_ar, sequence, scope, default_execution,
         driven_by, is_qc_gate, is_batch_stage, required_fields)
    VALUES
        (v_code, TRIM(p_name_ar), NULLIF(TRIM(COALESCE(p_description_ar, '')), ''),
         v_seq, 'optional',
         CASE WHEN p_execution = 'external' THEN 'external' ELSE 'internal' END,
         CASE WHEN p_driven_by IN ('my_tasks', 'designer_dashboard', 'external_wo')
              THEN p_driven_by ELSE 'my_tasks' END,
         COALESCE(p_is_qc_gate, FALSE), COALESCE(p_is_batch_stage, FALSE),
         '[]'::jsonb)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_production_stage(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) IS
'Adds a stage to the catalogue from the UI. Scope is always optional -- a new stage joins a route by being added to it, never by appearing in every route at once.';

REVOKE ALL ON FUNCTION public.create_production_stage(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_production_stage(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

COMMIT;
