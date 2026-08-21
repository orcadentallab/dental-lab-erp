-- Production route composition: default in, explicit out.
--
-- Guards 20260821001000_production_stage_catalog_and_routes.sql.
--
-- The rule being protected: a service inherits every GLOBAL stage with no
-- configuration at all, and records only its exceptions. If that inverts --
-- if a route ever has to list its stages -- then adding a stage to the lab
-- means editing every service by hand, and services will silently diverge.
--
-- The other rule: an unmapped service resolves to the fully outsourced
-- fallback, which is exactly today's behaviour. Assigning routes has to be a
-- deliberate act, never something that happens to existing orders by default.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(16);

-- ─── Fixtures ────────────────────────────────────────────────────────────
-- Own routes, so editing the seeded ones in production cannot break this.

INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES
    ('d1000000-0000-0000-0000-000000000001', 'Route test — plain', FALSE, FALSE),
    ('d1000000-0000-0000-0000-000000000002', 'Route test — no cast', FALSE, FALSE),
    ('d1000000-0000-0000-0000-000000000003', 'Route test — opts out', FALSE, TRUE);

-- ─── 1-3. The seeded catalogue ───────────────────────────────────────────

-- Unconditional globals only. doctor_review is also global but carries
-- {"delivery_type":"TryIn"}, so it is present in every route yet active only
-- on try-ins -- counting it here would misstate what a normal case walks.
SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stages
      WHERE scope = 'global' AND is_active AND default_condition IS NULL),
    9,
    'nine stages apply unconditionally to every service');

-- Milling and sintering are outsourced on opening day. This is the setting
-- that flips to internal later with no migration.
SELECT is(
    (SELECT default_execution FROM public.production_stages WHERE code = 'milling'),
    'external',
    'milling ships as an outsourced stage');

-- The codes have to stay identical to RESPONSIBLE_STAGE in
-- src/constants/issueCauses.ts, or issue causes stop joining onto stage runs.
SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stages
      WHERE code IN ('design', 'milling', 'finish', 'glaze', 'qc')),
    5,
    'stage codes reuse the existing issue-cause vocabulary');

-- ─── 4-6. A route with no rows already works ─────────────────────────────

SELECT is(
    (SELECT COUNT(*)::int FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000001')),
    9,
    'a route with zero configuration inherits the whole global chain');

SELECT is(
    (SELECT array_agg(stage_code ORDER BY seq)::text
       FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000001')),
    '{design,cast_print,milling,sintering,finish,glaze,qc,packaging,shipping}',
    'and in the right order, staining excluded because it is optional');

SELECT is(
    (SELECT advance_mode FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000001')
      WHERE stage_code = 'qc'),
    'qc_gate',
    'a QC stage never advances on its own');

-- ─── 7-8. Excluding one global stage: the "no printed cast" service ──────

INSERT INTO public.production_route_stages (route_id, stage_id, mode)
SELECT 'd1000000-0000-0000-0000-000000000002', s.id, 'excluded'
  FROM public.production_stages s WHERE s.code = 'cast_print';

SELECT is(
    (SELECT array_agg(stage_code ORDER BY seq)::text
       FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000002')),
    '{design,milling,sintering,finish,glaze,qc,packaging,shipping}',
    'one excluded row drops cast printing and leaves the rest untouched');

SELECT is(
    (SELECT COUNT(*)::int FROM public.production_route_stages
      WHERE route_id = 'd1000000-0000-0000-0000-000000000002'),
    1,
    'expressing that took exactly one row, not eight inclusions');

-- ─── 9-11. Opting an optional stage in, and overriding it ────────────────

INSERT INTO public.production_route_stages (route_id, stage_id, mode)
SELECT 'd1000000-0000-0000-0000-000000000001', s.id, 'included'
  FROM public.production_stages s WHERE s.code = 'staining';

SELECT is(
    (SELECT array_agg(stage_code ORDER BY seq)::text
       FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000001')),
    '{design,cast_print,milling,sintering,finish,staining,glaze,qc,packaging,shipping}',
    'an optional stage slots into its catalogue position when opted in');

-- Bringing milling in-house for ONE service: a dropdown, not a migration.
INSERT INTO public.production_route_stages (route_id, stage_id, mode, execution_override)
SELECT 'd1000000-0000-0000-0000-000000000002', s.id, 'override', 'internal'
  FROM public.production_stages s WHERE s.code = 'milling';

SELECT is(
    (SELECT execution FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000002')
      WHERE stage_code = 'milling'),
    'internal',
    'a route can run a normally-outsourced stage in-house');

SELECT is(
    (SELECT execution FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000001')
      WHERE stage_code = 'milling'),
    'external',
    'and that override does not leak into any other service');

-- ─── 12-13. Conditional stages ───────────────────────────────────────────

INSERT INTO public.production_route_stages (route_id, stage_id, mode, condition)
SELECT 'd1000000-0000-0000-0000-000000000001', s.id, 'override',
       '{"delivery_type": "TryIn"}'::jsonb
  FROM public.production_stages s WHERE s.code = 'packaging';

SELECT ok(
    NOT EXISTS (SELECT 1 FROM public.get_effective_route_stages(
                    'd1000000-0000-0000-0000-000000000001', '{}'::jsonb)
                 WHERE stage_code = 'packaging'),
    'a conditional stage is absent when the order does not match');

SELECT ok(
    EXISTS (SELECT 1 FROM public.get_effective_route_stages(
                'd1000000-0000-0000-0000-000000000001',
                '{"delivery_type": "TryIn", "is_redo": false}'::jsonb)
             WHERE stage_code = 'packaging'),
    'and present when it does, ignoring the extra context keys');

-- ─── 14. A route may opt out of the global chain entirely ────────────────

INSERT INTO public.production_route_stages (route_id, stage_id, mode)
SELECT 'd1000000-0000-0000-0000-000000000003', s.id, 'included'
  FROM public.production_stages s WHERE s.code = 'external_full';

SELECT is(
    (SELECT array_agg(stage_code ORDER BY seq)::text
       FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000003')),
    '{external_full}',
    'a route that opts out carries only what it lists');

-- ─── 15-16. Legacy orders keep today's behaviour ─────────────────────────

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('d2000000-0000-0000-0000-000000000001', 'Route test doctor',
        '01000000000', 'Test address', 'DBROUTE', 'Test representative');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    'd3000000-0000-0000-0000-000000000001', 'ROUTE-LEGACY-1',
    'd2000000-0000-0000-0000-000000000001', 'Legacy patient', '[]',
    500, 'A1', 'New Case', CURRENT_DATE, 200, 'not_started', 'none');

-- No service is mapped to a route by the migration, on purpose. An existing
-- order therefore still describes a case that leaves the building whole.
SELECT is(
    (SELECT is_fallback FROM public.production_routes
      WHERE id = public.resolve_route_for_order('d3000000-0000-0000-0000-000000000001')),
    TRUE,
    'an order with no mapped service resolves to the outsourced fallback');

UPDATE public.orders
   SET route_override_id = 'd1000000-0000-0000-0000-000000000002'
 WHERE id = 'd3000000-0000-0000-0000-000000000001';

SELECT is(
    public.resolve_route_for_order('d3000000-0000-0000-0000-000000000001'),
    'd1000000-0000-0000-0000-000000000002'::uuid,
    'an explicit override on the order wins over everything else');

SELECT * FROM finish();
ROLLBACK;
