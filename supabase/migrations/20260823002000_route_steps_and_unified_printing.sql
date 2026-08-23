-- Routes become ordered step lists, and printing becomes one stage.
--
-- WHY THE MODEL CHANGES
--   The first design was "global stages, minus per-service exceptions". That
--   was right while routes were small variations on one chain. The real routes
--   are not:
--     * a try-in visits QC, packaging and shipping TWICE -- once before the
--       case goes to the doctor and again when it comes back;
--     * emax press has a completely different middle (ring prep, pressing)
--       instead of milling;
--     * the order of steps differs between them.
--   Exceptions cannot express any of that, and UNIQUE(route_id, stage_id)
--   actively forbade the repeat. So a route is now what it actually is: an
--   ordered list of steps, where a stage may appear more than once.
--
-- ONE PRINTING STAGE, NOT THREE
--   Wax for pressing, the try-in proof, and the working cast all come off the
--   SAME printer; only the resin differs. Splitting them into three stages
--   would have broken two things that are already built:
--     * capacity -- one printer is one queue and one bottleneck. Three columns
--       of two cases each hides that the printer has six jobs waiting.
--     * downtime -- machines.stage_id is a single reference, so a printer
--       breakdown would be charged to one of the three and stay invisible on
--       the other two.
--   What actually differs is the resin, and stage_material_bindings already
--   carries route_id, so the same stage consumes wax on the press route and
--   model resin on the zirconia route. The route step records what is being
--   printed so the technician knows which resin to load.
--
-- CODES THAT MUST SURVIVE
--   design / milling / finish / glaze / qc are the vocabulary in
--   src/constants/issueCauses.ts (RESPONSIBLE_STAGE). Existing issue data
--   joins on them, so the merges reuse those codes rather than inventing new
--   ones: `milling` now covers milling+sintering, `glaze` covers staining+
--   glaze. Splitting them again later is a new stage plus a route edit; the
--   history stays readable either way.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. The catalogue the lab actually has
-- ─────────────────────────────────────────────────────────────────────────

-- cast_print was only ever the working model. It is now every print job.
UPDATE public.production_stages
   SET code = 'printing', name_ar = 'الطباعة', sequence = 20,
       description_ar = 'طباعة على الـ 3D — الريزن بيختلف حسب المطلوب (واكس / بروفة / كاست)'
 WHERE code = 'cast_print';

-- Milling and sintering are done together, outside, by the same vendor. They
-- separate when the machine arrives; until then one step is the honest record.
UPDATE public.production_stages
   SET name_ar = 'الميلينج والسنترينج', sequence = 30, default_execution = 'external',
       description_ar = 'الفرز والحرق — بيتعملوا سوا عند معمل خارجي حاليًا'
 WHERE code = 'milling';

UPDATE public.production_stages SET is_active = FALSE WHERE code = 'sintering';

-- Staining and glazing are one bench operation here.
UPDATE public.production_stages
   SET name_ar = 'الستين والجليز', sequence = 60,
       description_ar = 'ضبط اللون والجليز والحرقة الأخيرة'
 WHERE code = 'glaze';

UPDATE public.production_stages SET is_active = FALSE WHERE code = 'staining';

UPDATE public.production_stages
   SET name_ar = 'الفينش', sequence = 50, description_ar = 'تشطيب وتجهيز الوحدة قبل اللون'
 WHERE code = 'finish';

UPDATE public.production_stages
   SET name_ar = 'مراجعة الجودة', sequence = 70,
       description_ar = 'مراجعة الحالة قبل ما تخرج — بوابة نجاح أو رسوب'
 WHERE code = 'qc';

UPDATE public.production_stages
   SET name_ar = 'التغليف', sequence = 80, description_ar = 'تغليف الحالة وتجهيزها للتسليم'
 WHERE code = 'packaging';

UPDATE public.production_stages
   SET name_ar = 'طلب الشحن', sequence = 90,
       description_ar = 'طلب شركة الشحن وتسليم الحالة للطبيب'
 WHERE code = 'shipping';

UPDATE public.production_stages
   SET name_ar = 'التصميم', sequence = 10,
       description_ar = 'المصمم بيعمل ملف التصميم على الكمبيوتر'
 WHERE code = 'design';

UPDATE public.production_stages
   SET name_ar = 'عند الطبيب (تراي إن)', sequence = 100,
       description_ar = 'الحالة عند الطبيب للتجربة — الوقت ده مش محسوب علينا'
 WHERE code = 'doctor_review';

UPDATE public.production_stages
   SET name_ar = 'حالة كاملة عند معمل خارجي', sequence = 200,
       description_ar = 'الحالة بتخرج بالكامل لمعمل خارجي — الوضع القديم'
 WHERE code = 'external_full';

-- The emax press middle, which has no equivalent in the CAD chain.
INSERT INTO public.production_stages
    (code, name_ar, description_ar, sequence, scope, default_execution,
     is_qc_gate, is_batch_stage, required_fields)
VALUES
    ('ring_prep', 'تجهيز الرينج وحرقها',
     'تجهيز الرينج حول الواكس وحرقها في الفرن', 35, 'optional', 'internal',
     FALSE, TRUE, '[]'::jsonb),
    ('pressing', 'البريسينج',
     'ضغط الإيماكس في الفرن بعد حرق الرينج', 40, 'optional', 'internal',
     FALSE, TRUE, '[]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. A route is an ordered list of steps
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.production_route_stages
    -- Explicit position. The same stage at two positions is the whole point.
    ADD COLUMN IF NOT EXISTS step_no INTEGER,
    -- What this particular pass is for: "واكس", "كاست", "بروفة".
    -- Shown on the technician's card so they load the right resin.
    ADD COLUMN IF NOT EXISTS variant_label TEXT,
    -- Rename a stage for this route only, without touching the catalogue.
    ADD COLUMN IF NOT EXISTS name_override TEXT,
    -- Who may work this step. Empty means anyone who can work production.
    ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] NOT NULL DEFAULT '{}'::text[];

-- The constraint that forbade the try-in loop.
ALTER TABLE public.production_route_stages
    DROP CONSTRAINT IF EXISTS uq_production_route_stages;

-- Existing rows predate step_no; seed it from the catalogue order so nothing
-- loses its place.
UPDATE public.production_route_stages rs
   SET step_no = s.sequence
  FROM public.production_stages s
 WHERE s.id = rs.stage_id AND rs.step_no IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_step_no
    ON public.production_route_stages (route_id, step_no);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. The chain, read straight off the steps
-- ─────────────────────────────────────────────────────────────────────────
-- Far simpler than the composition rule it replaces, and it can express a
-- repeat. A route with no steps still falls back to the global chain so a
-- freshly created route is never an empty, unusable one.

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
    -- A row is a STEP only when mode='included'. That distinction matters: an
    -- 'override' row exists to change how a stage behaves on this route (send
    -- milling in-house, change where a failure returns to). Treating one of
    -- those as the route's entire step list would silently reduce a nine-step
    -- chain to one, and the case would look finished after a single tap.
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
    -- Only used when a route has not been laid out yet, so a new route is
    -- never an empty, unusable one.
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
      -- A step you listed explicitly is in the route. The catalogue's own
      -- condition is a default for the fallback chain, not a veto over a
      -- decision somebody already made on this route.
      AND (COALESCE(b.condition, o.condition) IS NULL
           OR COALESCE(p_context, '{}'::jsonb) @> COALESCE(b.condition, o.condition))
    ORDER BY 1, s.code;
$$;

COMMENT ON FUNCTION public.get_effective_route_stages(UUID, JSONB) IS
'The ordered chain a case on this route walks. A stage may appear more than once (the try-in loop). Routes with no steps fall back to the global chain so a new route is never empty.';

REVOKE ALL ON FUNCTION public.get_effective_route_stages(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_route_stages(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. The three real routes
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_route_steps(
    p_route_id UUID,
    p_steps    JSONB   -- [{code, variant, condition, roles}]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    e JSONB;
    n INTEGER := 0;
BEGIN
    DELETE FROM public.production_route_stages WHERE route_id = p_route_id;

    FOR e IN SELECT * FROM jsonb_array_elements(p_steps)
    LOOP
        n := n + 10;
        INSERT INTO public.production_route_stages
            (route_id, stage_id, mode, step_no, variant_label, condition, allowed_roles)
        SELECT p_route_id, s.id, 'included', n,
               e ->> 'variant',
               CASE WHEN e ? 'condition' THEN e -> 'condition' END,
               COALESCE(
                   (SELECT array_agg(x) FROM jsonb_array_elements_text(e -> 'roles') x),
                   '{}'::text[])
          FROM public.production_stages s
         WHERE s.code = e ->> 'code';
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_route_steps(UUID, JSONB) FROM PUBLIC, anon;

DO $$
DECLARE
    v_zircon UUID;
    v_press  UUID;
BEGIN
    -- Zirconia / emax CAD, with the try-in detour built in as conditional
    -- steps. A final-delivery case simply skips them.
    SELECT id INTO v_zircon FROM public.production_routes
     WHERE name_ar = 'المسار الداخلي الافتراضي';

    IF v_zircon IS NOT NULL THEN
        UPDATE public.production_routes
           SET name_ar = 'زيركونيا / إيماكس CAD',
               notes = 'المسار الأساسي. خطوات التراي إن بتظهر بس لو الحالة تراي إن.'
         WHERE id = v_zircon;

        PERFORM public.seed_route_steps(v_zircon, $json$[
            {"code":"design",         "roles":["designer","admin"]},

            {"code":"printing",       "variant":"بروفة وكاست",
             "condition":{"delivery_type":"TryIn"}, "roles":["technician","admin"]},
            {"code":"qc",             "condition":{"delivery_type":"TryIn"}},
            {"code":"packaging",      "condition":{"delivery_type":"TryIn"}},
            {"code":"shipping",       "condition":{"delivery_type":"TryIn"}},
            {"code":"doctor_review",  "condition":{"delivery_type":"TryIn"}},

            {"code":"milling",        "roles":[]},
            {"code":"printing",       "variant":"كاست",
             "condition":{"delivery_type":"Final"}, "roles":["technician","admin"]},
            {"code":"finish",         "roles":["technician","admin"]},
            {"code":"glaze",          "roles":["technician","admin"]},
            {"code":"qc",             "roles":["technician","admin"]},
            {"code":"packaging",      "roles":["technician","admin"]},
            {"code":"shipping",       "roles":["technician","admin"]}
        ]$json$::jsonb);
    END IF;

    -- emax press: printing, then the ring and the press, then the shared tail.
    INSERT INTO public.production_routes (name_ar, is_fallback, ignores_global_stages, notes)
    SELECT 'إيماكس بريس', FALSE, FALSE,
           'الطباعة بريزن الواكس، وبعدها الرينج والبريسينج بدل الميلينج.'
     WHERE NOT EXISTS (SELECT 1 FROM public.production_routes WHERE name_ar = 'إيماكس بريس');

    SELECT id INTO v_press FROM public.production_routes WHERE name_ar = 'إيماكس بريس';

    IF v_press IS NOT NULL THEN
        PERFORM public.seed_route_steps(v_press, $json$[
            {"code":"design",     "roles":["designer","admin"]},
            {"code":"printing",   "variant":"واكس وكاست", "roles":["technician","admin"]},
            {"code":"ring_prep",  "roles":["technician","admin"]},
            {"code":"pressing",   "roles":["technician","admin"]},
            {"code":"finish",     "roles":["technician","admin"]},
            {"code":"glaze",      "roles":["technician","admin"]},
            {"code":"qc",         "roles":["technician","admin"]},
            {"code":"packaging",  "roles":["technician","admin"]},
            {"code":"shipping",   "roles":["technician","admin"]}
        ]$json$::jsonb);
    END IF;
END;
$$;

COMMIT;
