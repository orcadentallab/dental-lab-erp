-- Production stage catalogue and per-service route maps.
-- Internal lab plan, phase 0, item 2. See docs/INTERNAL_LAB_PLAN_AR.md 4.1-4.2.
--
-- WHAT THIS SOLVES
--   Today an order has one supplier and one opaque `in_production` status.
--   The internal lab needs each SERVICE to carry its own list of stages, and
--   that list has to be editable from the UI rather than compiled in: milling
--   is outsourced "for now", stages will be added, and a service that does not
--   need a printed cast has to be able to say so.
--
-- THE COMPOSITION RULE — DEFAULT IN, EXPLICIT OUT
--   production_stages.scope drives everything:
--     global   -> applies to EVERY route automatically (QC, cast print,
--                 packaging). You never add these per service.
--     optional -> only present when a route asks for it (staining).
--   A route then records only its EXCEPTIONS in production_route_stages:
--     mode = 'excluded' -> drop a global stage from this service
--     mode = 'included' -> add an optional stage to this service
--     mode = 'override' -> keep membership, change execution/timing/ordering
--   So a brand new service is already correct with zero rows: it inherits the
--   whole global chain. That is the difference between configuring exceptions
--   and re-entering the same nine stages for every service.
--
-- ROUTE RESOLUTION, in order:
--   orders.route_override_id -> services.route_id -> the fallback route.
--   A service with no map resolves to the fallback, which is the fully
--   outsourced single-stage route -- i.e. exactly today's behaviour. Nothing
--   changes for existing data until a route is deliberately assigned.
--
-- NOTHING IS WIRED UP YET. The feature flag `production_v1` ships OFF and no
-- application code reads these tables. This migration only makes the shape
-- exist so the job/stage-run migration can build on it.

BEGIN;

INSERT INTO public.app_settings (key, value)
VALUES ('production_v1', 'off')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Stage catalogue — every stage the lab can perform, named once
-- ─────────────────────────────────────────────────────────────────────────
--
-- `code` intentionally reuses the vocabulary already in
-- src/constants/issueCauses.ts (RESPONSIBLE_STAGE): design, milling, finish,
-- glaze, qc, logistics, external_lab. Keeping the strings identical means the
-- existing issue-cause data joins straight onto stage runs instead of needing
-- a translation table that would rot.

CREATE TABLE IF NOT EXISTS public.production_stages (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                      TEXT NOT NULL UNIQUE,
    name_ar                   TEXT NOT NULL,
    sequence                  INTEGER NOT NULL,
    scope                     TEXT NOT NULL DEFAULT 'optional'
                              CHECK (scope IN ('global', 'optional')),
    default_execution         TEXT NOT NULL DEFAULT 'internal'
                              CHECK (default_execution IN ('internal', 'external')),
    default_supplier_id       UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    is_qc_gate                BOOLEAN NOT NULL DEFAULT FALSE,
    -- A furnace load or a printer plate runs many cases at once. Costing must
    -- charge the RUN once and split it, never charge every case the full 90
    -- minutes -- see plan 4.3 "batch trap".
    is_batch_stage            BOOLEAN NOT NULL DEFAULT FALSE,
    -- Data this stage cannot start without (shade, design file, tooth numbers).
    -- Checked at INTAKE so the rep fixes it, not at the bench (plan 7.5).
    required_fields           JSONB NOT NULL DEFAULT '[]'::jsonb,
    standard_minutes_per_unit NUMERIC(10, 2),
    standard_cost_per_unit    NUMERIC(10, 2),
    daily_capacity_units      INTEGER,
    is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_production_stages_required_fields_is_array
        CHECK (jsonb_typeof(required_fields) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_production_stages_sequence
    ON public.production_stages (sequence) WHERE is_active;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Routes — one per service family
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.production_routes (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_ar                TEXT NOT NULL,
    version                INTEGER NOT NULL DEFAULT 1,
    -- The one route used when a service has no map of its own. Exactly one.
    is_fallback            BOOLEAN NOT NULL DEFAULT FALSE,
    -- Escape hatch for a route that is NOT the normal internal chain -- the
    -- fully outsourced route being the case that needs it. Without this, the
    -- fallback route would inherit all nine global stages and describe an
    -- in-house process for a case that never enters the building.
    ignores_global_stages  BOOLEAN NOT NULL DEFAULT FALSE,
    notes                  TEXT,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_routes_single_fallback
    ON public.production_routes (is_fallback) WHERE is_fallback;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Route exceptions — the control surface behind /production/routes
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.production_route_stages (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id                  UUID NOT NULL REFERENCES public.production_routes(id) ON DELETE CASCADE,
    stage_id                  UUID NOT NULL REFERENCES public.production_stages(id) ON DELETE CASCADE,
    mode                      TEXT NOT NULL DEFAULT 'included'
                              CHECK (mode IN ('included', 'excluded', 'override')),
    seq_override              INTEGER,
    -- Stages sharing a parallel_group run at the same time (model prep
    -- alongside milling). NULL means sequential.
    parallel_group            INTEGER,
    -- Applies only when the order matches, by JSONB containment:
    --   {"delivery_type": "TryIn"} / {"is_redo": true}
    condition                 JSONB,
    execution_override        TEXT CHECK (execution_override IN ('internal', 'external')),
    supplier_override         UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    standard_minutes_per_unit NUMERIC(10, 2),
    standard_cost_per_unit    NUMERIC(10, 2),
    advance_mode              TEXT CHECK (advance_mode IN ('auto', 'manual', 'qc_gate')),
    -- Where a failure sends the case back to: glaze fails -> staining,
    -- finish fails -> milling. This is the "move it from stage to stage"
    -- control, expressed once per route instead of hard-coded.
    on_fail_goto_stage_id     UUID REFERENCES public.production_stages(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_production_route_stages UNIQUE (route_id, stage_id),
    CONSTRAINT chk_route_stage_condition_is_object
        CHECK (condition IS NULL OR jsonb_typeof(condition) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_production_route_stages_route
    ON public.production_route_stages (route_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Wiring the route onto services and orders
-- ─────────────────────────────────────────────────────────────────────────
-- Both nullable with no default: no table rewrite, and NULL keeps every
-- existing row on today's behaviour via the fallback route.

ALTER TABLE public.services
    ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.production_routes(id) ON DELETE SET NULL;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS route_override_id UUID REFERENCES public.production_routes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_services_route ON public.services (route_id) WHERE route_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_production_stages_updated_at ON public.production_stages;
CREATE TRIGGER update_production_stages_updated_at BEFORE UPDATE ON public.production_stages
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_production_routes_updated_at ON public.production_routes;
CREATE TRIGGER update_production_routes_updated_at BEFORE UPDATE ON public.production_routes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_production_route_stages_updated_at ON public.production_route_stages;
CREATE TRIGGER update_production_route_stages_updated_at BEFORE UPDATE ON public.production_route_stages
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. get_effective_route_stages() — the composition rule, in one place
-- ─────────────────────────────────────────────────────────────────────────
--
-- Returns the ordered chain a case will actually walk. Every consumer (the
-- route editor preview, job materialisation, the intake readiness check, the
-- delivery estimate) calls this, so "what stages does this service have" has
-- exactly one answer.

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
    required_fields           JSONB
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
        -- A QC gate never advances on its own: someone has to pass or fail it.
        COALESCE(rs.advance_mode,
                 CASE WHEN s.is_qc_gate THEN 'qc_gate' ELSE 'auto' END) AS advance_mode,
        rs.on_fail_goto_stage_id,
        COALESCE(rs.standard_minutes_per_unit, s.standard_minutes_per_unit),
        COALESCE(rs.standard_cost_per_unit,    s.standard_cost_per_unit),
        s.required_fields
    FROM public.production_stages s
    CROSS JOIN (SELECT r.id, r.ignores_global_stages
                  FROM public.production_routes r
                 WHERE r.id = p_route_id AND r.is_active) route
    LEFT JOIN public.production_route_stages rs
           ON rs.route_id = route.id AND rs.stage_id = s.id
    WHERE s.is_active
      AND CASE
            -- A route that opts out of the global chain carries only what it
            -- explicitly lists.
            WHEN route.ignores_global_stages
                THEN rs.id IS NOT NULL AND rs.mode <> 'excluded'
            -- Global stages are in unless explicitly removed.
            WHEN s.scope = 'global'
                THEN rs.id IS NULL OR rs.mode <> 'excluded'
            -- Optional stages are out unless explicitly added.
            ELSE rs.id IS NOT NULL AND rs.mode <> 'excluded'
          END
      -- A conditional stage applies only when the order matches it.
      AND (rs.condition IS NULL OR COALESCE(p_context, '{}'::jsonb) @> rs.condition)
    -- s.code breaks ties so two stages sharing a sequence never swap order
    -- between calls; a chain that reshuffles would make cycle times unreadable.
    ORDER BY COALESCE(rs.seq_override, s.sequence), s.code;
$$;

COMMENT ON FUNCTION public.get_effective_route_stages(UUID, JSONB) IS
'Ordered stage chain for a route: global stages minus exclusions, plus opted-in optional stages, with per-route overrides applied. The single source of truth for "what stages does this service have".';

-- Resolves order -> service -> fallback, in that order.
--
-- The service lookup joins order_items.product_type to services.name because
-- order_items carries no service_id; 075_sync_service_names.sql exists for the
-- same reason. A renamed service silently stops matching here, which is why
-- the chain ends at the fallback rather than at NULL -- a mismatch degrades to
-- today's outsourced behaviour instead of leaving a case with no route at all.
CREATE OR REPLACE FUNCTION public.resolve_route_for_order(
    p_order_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        o.route_override_id,
        (SELECT sv.route_id
           FROM public.order_items oi
           JOIN public.services sv ON sv.name = oi.product_type
          WHERE oi.order_id = o.id AND sv.route_id IS NOT NULL
          ORDER BY sv.sort_order NULLS LAST, sv.name
          LIMIT 1),
        (SELECT r.id FROM public.production_routes r
          WHERE r.is_fallback AND r.is_active LIMIT 1))
    FROM public.orders o
    WHERE o.id = p_order_id;
$$;

COMMENT ON FUNCTION public.resolve_route_for_order(UUID) IS
'Route for an order: explicit override, else the first mapped service on it, else the fallback. Legacy orders resolve to the fallback so nothing changes until a route is assigned. Multi-service orders split into one job per route in the job migration; this returns the primary only.';

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RLS — everyone reads the chain, only admin edits it
-- ─────────────────────────────────────────────────────────────────────────
-- The technician's task card has to show which stage comes next, so read is
-- open to any signed-in user. Editing a route changes how every future case
-- is built, so it is admin-only.

ALTER TABLE public.production_stages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_routes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_route_stages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['production_stages', 'production_routes',
                             'production_route_stages']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'read_' || t, t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.get_my_role() IS NOT NULL)',
            'read_' || t, t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admin_manage_' || t, t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.get_my_role() = ''admin'') WITH CHECK (public.get_my_role() = ''admin'')',
            'admin_manage_' || t, t);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_route_stages(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_route_stages(UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_route_for_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_route_for_order(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Seed — the stage vocabulary, and two routes
-- ─────────────────────────────────────────────────────────────────────────
--
-- milling and sintering default to EXTERNAL because that is the arrangement
-- on opening day. When they move in-house it is one dropdown, not a migration.
--
-- Which services are internal is NOT guessed here: no service is assigned a
-- route, so every existing order keeps resolving to the fully outsourced
-- fallback until routes are assigned deliberately in the UI.

INSERT INTO public.production_stages
    (code, name_ar, sequence, scope, default_execution, is_qc_gate, is_batch_stage, required_fields)
VALUES
    ('design',        'التصميم',           10,  'global',   'internal', FALSE, FALSE, '["shade","teeth_numbers"]'::jsonb),
    ('cast_print',    'طباعة الكاست',       20,  'global',   'internal', FALSE, TRUE,  '[]'::jsonb),
    ('milling',       'الفرز',              30,  'global',   'external', FALSE, FALSE, '["design_url"]'::jsonb),
    ('sintering',     'السنترة',            40,  'global',   'external', FALSE, TRUE,  '[]'::jsonb),
    ('finish',        'التشطيب',            50,  'global',   'internal', FALSE, FALSE, '[]'::jsonb),
    ('staining',      'الستين',             60,  'optional', 'internal', FALSE, FALSE, '["shade"]'::jsonb),
    ('glaze',         'الجلاز',             70,  'global',   'internal', FALSE, TRUE,  '[]'::jsonb),
    ('qc',            'مراجعة الجودة',       80,  'global',   'internal', TRUE,  FALSE, '[]'::jsonb),
    ('packaging',     'التغليف',            90,  'global',   'internal', FALSE, FALSE, '[]'::jsonb),
    ('shipping',      'الشحن',              100, 'global',   'external', FALSE, FALSE, '[]'::jsonb),
    -- The whole case leaves the building: today's arrangement, kept as one
    -- stage so legacy orders have a real chain instead of a special case.
    ('external_full', 'حالة كاملة خارجية',   200, 'optional', 'external', FALSE, FALSE, '[]'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.production_routes (name_ar, is_fallback, ignores_global_stages, notes)
SELECT 'حالة كاملة لمعمل خارجي', TRUE, TRUE,
       'المسار الافتراضي لأي خدمة لسه متحددلهاش خريطة — نفس الوضع الحالي بالظبط.'
 WHERE NOT EXISTS (SELECT 1 FROM public.production_routes WHERE is_fallback);

INSERT INTO public.production_route_stages (route_id, stage_id, mode)
SELECT r.id, s.id, 'included'
  FROM public.production_routes r
  CROSS JOIN public.production_stages s
 WHERE r.is_fallback AND s.code = 'external_full'
   AND NOT EXISTS (SELECT 1 FROM public.production_route_stages x
                    WHERE x.route_id = r.id AND x.stage_id = s.id);

INSERT INTO public.production_routes (name_ar, is_fallback, ignores_global_stages, notes)
SELECT 'المسار الداخلي الافتراضي', FALSE, FALSE,
       'كل المراحل العامة. اربطه بالخدمات من صفحة الخدمات، وشيل أو ضيف المراحل حسب كل خدمة.'
 WHERE NOT EXISTS (SELECT 1 FROM public.production_routes WHERE name_ar = 'المسار الداخلي الافتراضي');

COMMIT;
