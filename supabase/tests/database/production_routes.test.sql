-- A route is an ordered list of steps, and a stage may repeat.
--
-- Guards 20260821001000 as reshaped by 20260823002000.
--
-- The model this replaces composed a route as "all global stages, minus the
-- ones a service excludes". That could not express what the lab actually does:
--   * a try-in passes QC, packaging and shipping TWICE -- once on the way to
--     the doctor and again after it comes back;
--   * emax press has a different middle entirely (ring, press) instead of
--     milling;
--   * printing happens at different points with different resin.
-- So the rules under test now are: steps are ordered, a stage may appear more
-- than once, conditional steps appear only for matching orders, and a route
-- nobody has laid out yet still produces a usable chain.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(14);

INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES ('d1000000-0000-0000-0000-000000000001', 'Route test — steps', FALSE, FALSE),
       ('d1000000-0000-0000-0000-000000000002', 'Route test — conditional', FALSE, FALSE),
       ('d1000000-0000-0000-0000-000000000003', 'Route test — untouched', FALSE, FALSE);

-- ─── 1-3. The catalogue after the merges ─────────────────────────────────

-- One printer, one queue, one bottleneck: wax, proof and cast are the same
-- stage with different resin, not three stages.
SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stages
      WHERE code IN ('printing', 'cast_print') AND is_active),
    1,
    'printing is a single active stage, not one per resin');

-- Milling and sintering are done together by the same outside vendor.
SELECT is(
    (SELECT is_active FROM public.production_stages WHERE code = 'sintering'),
    FALSE,
    'sintering folded into milling and is no longer its own stage');

-- The issue-cause vocabulary must survive the merges, or every historical
-- problem record stops joining to a stage.
SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stages
      WHERE code IN ('design', 'milling', 'finish', 'glaze', 'qc') AND is_active),
    5,
    'the codes RESPONSIBLE_STAGE depends on are all still live');

-- ─── 4-5. A route with no steps is still usable ──────────────────────────

SELECT ok(
    (SELECT COUNT(*)::int FROM public.get_effective_route_stages(
        'd1000000-0000-0000-0000-000000000003')) > 0,
    'a route nobody has laid out yet falls back to the standard chain');

SELECT ok(
    NOT EXISTS (SELECT 1 FROM public.get_effective_route_stages(
                    'd1000000-0000-0000-0000-000000000003')
                 WHERE stage_code = 'sintering'),
    'and the fallback carries no retired stage');

-- ─── 6-9. Ordered steps, with a repeat ───────────────────────────────────
-- The try-in shape: print, QC, pack, ship, doctor, then the real production
-- pass and QC/pack/ship again.

SELECT public.seed_route_steps('d1000000-0000-0000-0000-000000000001', $json$[
    {"code":"design"},
    {"code":"printing",  "variant":"بروفة"},
    {"code":"qc"},
    {"code":"packaging"},
    {"code":"shipping"},
    {"code":"doctor_review"},
    {"code":"milling"},
    {"code":"printing",  "variant":"كاست"},
    {"code":"finish"},
    {"code":"glaze"},
    {"code":"qc"},
    {"code":"packaging"},
    {"code":"shipping"}
]$json$::jsonb);

SELECT is(
    (SELECT COUNT(*)::int FROM public.get_effective_route_stages(
        'd1000000-0000-0000-0000-000000000001')),
    13,
    'the chain is thirteen steps, repeats included');

-- The constraint the old model enforced would have made this impossible.
SELECT is(
    (SELECT COUNT(*)::int FROM public.get_effective_route_stages(
        'd1000000-0000-0000-0000-000000000001')
      WHERE stage_code = 'qc'),
    2,
    'quality review appears twice: before the doctor and after');

SELECT is(
    (SELECT array_agg(stage_code ORDER BY seq)::text
       FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000001')),
    '{design,printing,qc,packaging,shipping,doctor_review,milling,printing,finish,glaze,qc,packaging,shipping}',
    'and the order is exactly as laid out, not the catalogue order');

-- The resin is what differs between the two print passes, so the step says so.
SELECT is(
    (SELECT array_agg(variant_label ORDER BY seq)::text
       FROM public.get_effective_route_stages('d1000000-0000-0000-0000-000000000001')
      WHERE stage_code = 'printing'),
    '{بروفة,كاست}',
    'each print pass carries what it is printing, so the right resin is loaded');

-- ─── 10-12. Conditional steps ────────────────────────────────────────────

SELECT public.seed_route_steps('d1000000-0000-0000-0000-000000000002', $json$[
    {"code":"design"},
    {"code":"printing", "variant":"بروفة", "condition":{"delivery_type":"TryIn"}},
    {"code":"milling"},
    {"code":"finish"},
    {"code":"qc"}
]$json$::jsonb);

SELECT is(
    (SELECT COUNT(*)::int FROM public.get_effective_route_stages(
        'd1000000-0000-0000-0000-000000000002', '{"delivery_type":"Final"}'::jsonb)),
    4,
    'a final case skips the try-in-only step');

SELECT is(
    (SELECT COUNT(*)::int FROM public.get_effective_route_stages(
        'd1000000-0000-0000-0000-000000000002', '{"delivery_type":"TryIn"}'::jsonb)),
    5,
    'and a try-in picks it up');

-- Time at the doctor is measured on the wall clock, never on our shift
-- calendar: a dentist's opening hours are no more ours than a vendor's.
SELECT is(
    (SELECT execution FROM public.get_effective_route_stages(
        'd1000000-0000-0000-0000-000000000001')
      WHERE stage_code = 'doctor_review' LIMIT 1),
    'external',
    'the doctor step is external, so our calendar is not applied to it');

-- ─── 13-14. Legacy orders keep today's behaviour ─────────────────────────

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

SELECT is(
    (SELECT is_fallback FROM public.production_routes
      WHERE id = public.resolve_route_for_order('d3000000-0000-0000-0000-000000000001')),
    TRUE,
    'an order with no mapped service still resolves to the outsourced fallback');

UPDATE public.orders
   SET route_override_id = 'd1000000-0000-0000-0000-000000000001'
 WHERE id = 'd3000000-0000-0000-0000-000000000001';

SELECT is(
    public.resolve_route_for_order('d3000000-0000-0000-0000-000000000001'),
    'd1000000-0000-0000-0000-000000000001'::uuid,
    'an explicit override on the order wins over everything else');

SELECT * FROM finish();
ROLLBACK;
