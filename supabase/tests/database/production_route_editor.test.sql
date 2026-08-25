-- The route step editor's server side.
--
-- Guards 20260823005000_route_step_editor.sql.
--
-- Five rules are protected here, each of which fails in a way nobody notices
-- until cases are already walking the wrong chain:
--
--   1. REORDERING MUST NOT COLLIDE. UNIQUE(route_id, step_no) is not
--      deferrable, so saving a reordered list one row at a time would fail
--      halfway and leave a route that builds a chain nobody configured. This
--      is the regression the whole RPC exists for.
--   2. AN EMPTY ROUTE IS REFUSED. get_effective_route_stages falls back to the
--      entire global chain when a route has no steps -- correct for a route
--      nobody has laid out, catastrophic for one somebody just emptied. On the
--      DEFAULT route it would put every unmapped order (today: all of them)
--      onto the full in-house chain, for work that never enters the building.
--   3. ONLY ADMINS EDIT ROUTES. A technician who can rewrite the route can
--      rewrite what everybody else is asked to do.
--   4. THE STEP'S IDENTITY REACHES THE RUN. variant_label and allowed_roles
--      existed on the step since 20260823002000 but nothing copied them onto
--      the run, so the technician's card never showed which resin to load and
--      the role restriction filtered nothing.
--   5. REWORK INHERITS THE STAGE IT RETURNS TO, not the stage that failed.
--      Glaze failing back to finish must say "finish".

BEGIN;

SET search_path TO public, extensions;

SELECT plan(18);

-- ─── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('a9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'route-admin@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('a9000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'route-tech@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('a8000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001',
     'route_admin', 'admin', 'Route Admin'),
    ('a8000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002',
     'route_tech', 'technician', 'Route Technician');

INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES ('a1000000-0000-0000-0000-000000000001', 'Editor test route', FALSE, FALSE);

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('a2000000-0000-0000-0000-000000000001', 'Editor test doctor',
        '01000000000', 'Test address', 'DBEDIT', 'Test representative');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, priority
) VALUES (
    'a3000000-0000-0000-0000-000000000001', 'EDIT-1',
    'a2000000-0000-0000-0000-000000000001', 'Editor patient', '[]',
    3000, 'A2', 'New Case', DATE '2026-06-10', 900, 'not_started', 'none', 'Normal');

INSERT INTO public.order_items (id, order_id, product_type, teeth_numbers, shade, price, count)
VALUES ('a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001',
        'Zirconia Crown', '["11","12"]'::jsonb, 'A2', 3000, 2);

-- Stage ids come from public.production_stages directly rather than a temp
-- view: the queries below run under SET ROLE authenticated, which owns no
-- temp objects, and production_stages is readable by any signed-in role.

-- ─── 1-2. Only an admin may rewrite a route ──────────────────────────────

SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT throws_like(
    format($$SELECT public.save_route_steps(
        'a1000000-0000-0000-0000-000000000001',
        '[{"stage_id":"%s"}]'::jsonb)$$, (SELECT id FROM public.production_stages WHERE code = 'design')),
    '%admin role required%',
    'a technician cannot rewrite a route');

SELECT throws_like(
    $$SELECT public.create_production_stage('Sneaky stage')$$,
    '%admin role required%',
    'a technician cannot add a stage to the catalogue');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

-- ─── 3-6. Saving a list: order, repeats, and the step's own fields ───────

SELECT lives_ok(
    format($$SELECT public.save_route_steps('a1000000-0000-0000-0000-000000000001', '[
        {"stage_id":"%1$s","allowed_roles":["designer"]},
        {"stage_id":"%2$s","variant_label":"بروفة","allowed_roles":["technician"]},
        {"stage_id":"%3$s","condition":{"delivery_type":"TryIn"}},
        {"stage_id":"%2$s","variant_label":"كاست","name_override":"طباعة الكاست",
         "allowed_roles":["technician"]},
        {"stage_id":"%4$s","allowed_roles":["technician"]},
        {"stage_id":"%3$s","allowed_roles":["technician"]}
    ]'::jsonb)$$,
    (SELECT id FROM public.production_stages WHERE code = 'design'),
    (SELECT id FROM public.production_stages WHERE code = 'printing'),
    (SELECT id FROM public.production_stages WHERE code = 'qc'),
    (SELECT id FROM public.production_stages WHERE code = 'finish')),
    'a six-step list with a repeated stage saves');

SELECT is(
    (SELECT array_agg(step_no ORDER BY step_no)::text
       FROM public.production_route_stages
      WHERE route_id = 'a1000000-0000-0000-0000-000000000001'),
    '{10,20,30,40,50,60}',
    'positions come from array order, in tens');

-- The repeat is the entire reason the model changed. UNIQUE(route_id,stage_id)
-- used to forbid it outright.
SELECT is(
    (SELECT COUNT(*)::int FROM public.production_route_stages rs
       JOIN public.production_stages s ON s.id = rs.stage_id
      WHERE rs.route_id = 'a1000000-0000-0000-0000-000000000001'
        AND s.code = 'printing'),
    2,
    'the same stage can occupy two positions on one route');

SELECT is(
    (SELECT array_agg(COALESCE(rs.variant_label, '-') ORDER BY rs.step_no)::text
       FROM public.production_route_stages rs
       JOIN public.production_stages s ON s.id = rs.stage_id
      WHERE rs.route_id = 'a1000000-0000-0000-0000-000000000001'
        AND s.code = 'printing'),
    '{بروفة,كاست}',
    'each pass keeps its own resin label');

-- ─── 7-8. The regression the RPC exists for: reordering ──────────────────
-- Moving the fifth step to the front shifts every position. Row by row this
-- collides on the non-deferrable unique index; in one statement it does not.

SELECT lives_ok(
    format($$SELECT public.save_route_steps('a1000000-0000-0000-0000-000000000001', '[
        {"stage_id":"%4$s","allowed_roles":["technician"]},
        {"stage_id":"%1$s","allowed_roles":["designer"]},
        {"stage_id":"%2$s","variant_label":"بروفة","allowed_roles":["technician"]},
        {"stage_id":"%3$s","condition":{"delivery_type":"TryIn"}},
        {"stage_id":"%2$s","variant_label":"كاست","name_override":"طباعة الكاست",
         "allowed_roles":["technician"]},
        {"stage_id":"%3$s","allowed_roles":["technician"]}
    ]'::jsonb)$$,
    (SELECT id FROM public.production_stages WHERE code = 'design'),
    (SELECT id FROM public.production_stages WHERE code = 'printing'),
    (SELECT id FROM public.production_stages WHERE code = 'qc'),
    (SELECT id FROM public.production_stages WHERE code = 'finish')),
    'reordering the whole list does not collide on the unique step position');

SELECT is(
    (SELECT s.code FROM public.production_route_stages rs
       JOIN public.production_stages s ON s.id = rs.stage_id
      WHERE rs.route_id = 'a1000000-0000-0000-0000-000000000001'
      ORDER BY rs.step_no LIMIT 1),
    'finish',
    'the step moved to the front is first afterwards');

-- ─── 9-11. An empty list, a bad reference, and the rollback ──────────────

SELECT throws_like(
    $$SELECT public.save_route_steps('a1000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
    '%at least one step%',
    'a route cannot be emptied, because empty silently means the global chain');

SELECT throws_like(
    $$SELECT public.save_route_steps('a1000000-0000-0000-0000-000000000001',
        '[{"stage_id":"00000000-0000-0000-0000-0000000000ff"}]'::jsonb)$$,
    '%unknown or inactive stage%',
    'a step pointing at no stage is refused');

-- The failed saves above must not have destroyed the route: the DELETE and the
-- INSERTs are one statement's worth of work, so a rejected save leaves the
-- previous list standing.
SELECT is(
    (SELECT COUNT(*)::int FROM public.production_route_stages
      WHERE route_id = 'a1000000-0000-0000-0000-000000000001'),
    6,
    'a rejected save leaves the previously saved list intact');

-- ─── 12-13. The chain reads the step back ────────────────────────────────

SELECT is(
    (SELECT name_ar FROM public.get_effective_route_stages(
        'a1000000-0000-0000-0000-000000000001', '{"delivery_type":"Final"}'::jsonb)
      WHERE variant_label = 'كاست'),
    'طباعة الكاست',
    'a step renamed on this route reports its own name, not the catalogue name');

SELECT is(
    (SELECT name_override FROM public.get_effective_route_stages(
        'a1000000-0000-0000-0000-000000000001', '{"delivery_type":"Final"}'::jsonb)
      WHERE variant_label = 'بروفة'),
    NULL,
    'a step with no rename reports a null override, so the editor shows a placeholder');

-- ─── 14-16. The step's identity reaches the run ──────────────────────────

RESET ROLE;

SELECT lives_ok(
    $$SELECT public.materialize_job_from_route(
        'a3000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001')$$,
    'a job materialises from the edited route');

SELECT is(
    (SELECT r.variant_label FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'a3000000-0000-0000-0000-000000000001'
        AND s.code = 'printing' AND r.name_override = 'طباعة الكاست'),
    'كاست',
    'the run carries which pass of the stage it is, so the technician loads the right resin');

SELECT is(
    (SELECT r.allowed_roles::text FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'a3000000-0000-0000-0000-000000000001'
        AND s.code = 'design'),
    '{designer}',
    'the run carries who may work it');

-- ─── 17. Rework inherits the stage it returns TO ─────────────────────────
-- Give finish a variant nobody else has, then insert a rework run at finish
-- that points back at the QC run which failed. It must read as finish.

UPDATE public.production_stage_runs r
   SET variant_label = 'تشطيب يدوي'
  FROM public.production_jobs j, public.production_stages s
 WHERE j.id = r.job_id AND s.id = r.stage_id
   AND j.order_id = 'a3000000-0000-0000-0000-000000000001'
   AND s.code = 'finish';

INSERT INTO public.production_stage_runs
    (job_id, stage_id, seq, execution, status, units_in, rework_of)
SELECT f.job_id, f.stage_id, f.seq, 'internal', 'ready', 1,
       (SELECT r.id FROM public.production_stage_runs r
          JOIN public.production_jobs j ON j.id = r.job_id
          JOIN public.production_stages s ON s.id = r.stage_id
         WHERE j.order_id = 'a3000000-0000-0000-0000-000000000001'
           AND s.code = 'qc'
         ORDER BY r.seq DESC LIMIT 1)
  FROM (SELECT r2.job_id, r2.stage_id, r2.seq
          FROM public.production_stage_runs r2
          JOIN public.production_jobs j2 ON j2.id = r2.job_id
          JOIN public.production_stages s2 ON s2.id = r2.stage_id
         WHERE j2.order_id = 'a3000000-0000-0000-0000-000000000001'
           AND s2.code = 'finish'
         LIMIT 1) f;

SELECT is(
    (SELECT r.variant_label FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
      WHERE r.rework_of IS NOT NULL
        AND j.order_id = 'a3000000-0000-0000-0000-000000000001'),
    'تشطيب يدوي',
    'a rework run inherits the identity of the stage it returns TO, not the one that failed');

-- ─── 18. A stage added from the UI ───────────────────────────────────────

SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
    $$SELECT public.create_production_stage(
        'طباعة موديل 3D', 'موديل الجبس المطبوع', 'internal', 'my_tasks', FALSE, TRUE)$$,
    'an admin can add a stage without a migration');

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
