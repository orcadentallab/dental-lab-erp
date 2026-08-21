-- Conditional global stages, so "at the doctor" works for internal try-ins too.
--
-- THE BUG THIS FIXES
--   20260821003000 added doctor_review as an OPTIONAL stage, which means it
--   only appears on a route somebody explicitly added it to. That is fine for
--   the historical backfill, and wrong for everything after it: the internal
--   lab will send try-ins to doctors too. The first time a doctor held a case
--   for a week, that week would have landed on whichever stage came next and
--   reported a phantom bottleneck in finishing -- blaming a technician for a
--   week he never had the case.
--
--   Making it plainly global is also wrong: a final-delivery case never goes
--   to the doctor mid-production, so every non-try-in route would carry a
--   stage that never happens.
--
-- THE FIX: a global stage may carry its own condition.
--   production_stages.default_condition lets the catalogue say "this applies
--   everywhere, but only when the case looks like this". doctor_review becomes
--   global with {"delivery_type": "TryIn"} -- present in every route, active
--   only on try-ins, and nobody has to remember to add it per service.
--
--   A route-level condition still overrides the catalogue default, so a
--   service with an unusual rule can still say so.

BEGIN;

ALTER TABLE public.production_stages
    ADD COLUMN IF NOT EXISTS default_condition JSONB;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'chk_production_stages_default_condition_is_object') THEN
        ALTER TABLE public.production_stages
            ADD CONSTRAINT chk_production_stages_default_condition_is_object
            CHECK (default_condition IS NULL OR jsonb_typeof(default_condition) = 'object');
    END IF;
END;
$$;

COMMENT ON COLUMN public.production_stages.default_condition IS
'Applies this stage only to matching orders, by JSONB containment against the job context. Lets a stage be global (never forgotten) yet conditional (never spurious).';

UPDATE public.production_stages
   SET scope             = 'global',
       default_condition = '{"delivery_type": "TryIn"}'::jsonb
 WHERE code = 'doctor_review';

-- ─────────────────────────────────────────────────────────────────────────
-- Recreate the composition function with the catalogue-level condition, and
-- return the effective condition so the route editor can label a stage as
-- conditional instead of leaving it looking unconditional.
-- ─────────────────────────────────────────────────────────────────────────

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
    SELECT
        COALESCE(rs.seq_override, s.sequence)                   AS seq,
        s.id                                                    AS stage_id,
        s.code                                                  AS stage_code,
        s.name_ar,
        COALESCE(rs.execution_override, s.default_execution)    AS execution,
        COALESCE(rs.supplier_override, s.default_supplier_id)   AS supplier_id,
        s.is_qc_gate,
        s.is_batch_stage,
        rs.parallel_group,
        COALESCE(rs.advance_mode,
                 CASE WHEN s.is_qc_gate THEN 'qc_gate' ELSE 'auto' END) AS advance_mode,
        rs.on_fail_goto_stage_id,
        COALESCE(rs.standard_minutes_per_unit, s.standard_minutes_per_unit),
        COALESCE(rs.standard_cost_per_unit,    s.standard_cost_per_unit),
        s.required_fields,
        COALESCE(rs.condition, s.default_condition)             AS applies_when
    FROM public.production_stages s
    CROSS JOIN (SELECT r.id, r.ignores_global_stages
                  FROM public.production_routes r
                 WHERE r.id = p_route_id AND r.is_active) route
    LEFT JOIN public.production_route_stages rs
           ON rs.route_id = route.id AND rs.stage_id = s.id
    WHERE s.is_active
      AND CASE
            WHEN route.ignores_global_stages
                THEN rs.id IS NOT NULL AND rs.mode <> 'excluded'
            WHEN s.scope = 'global'
                THEN rs.id IS NULL OR rs.mode <> 'excluded'
            ELSE rs.id IS NOT NULL AND rs.mode <> 'excluded'
          END
      -- Route-level condition wins over the catalogue default.
      AND (COALESCE(rs.condition, s.default_condition) IS NULL
           OR COALESCE(p_context, '{}'::jsonb) @> COALESCE(rs.condition, s.default_condition))
    ORDER BY COALESCE(rs.seq_override, s.sequence), s.code;
$$;

COMMENT ON FUNCTION public.get_effective_route_stages(UUID, JSONB) IS
'Ordered stage chain for a route: global stages minus exclusions, plus opted-in optional stages, filtered by catalogue and route conditions. applies_when is the condition in force, so the editor can show a stage as conditional rather than absent.';

REVOKE ALL ON FUNCTION public.get_effective_route_stages(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_route_stages(UUID, JSONB) TO authenticated;

COMMIT;
