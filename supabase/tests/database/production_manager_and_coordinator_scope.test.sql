-- Where the floor moved, and what the coordinator may not follow it into.
--
-- Guards 20260905040000_coordinator_inherits_representative.sql (step 2b) and
-- 20260905050000_production_manager_replaces_lab.sql (step 3), the last two
-- steps of docs/PRODUCTION_ROLES_PLAN_AR.md.
--
-- Step 3 is the only one that removes anything, so the assertions that matter
-- most are the negative ones, and they come in pairs -- for every "X can no
-- longer", there is a "Y now can", because a permission that vanished
-- entirely looks identical to one that moved correctly until you check the
-- other side.
--
-- Four properties:
--
--   1. 'lab' IS OFF THE FLOOR. can_work_production() sits under the RLS on
--      production_stage_runs, so it is the single point that decides whether
--      a role can move a case. Losing it is the whole point of step 3.
--   2. 'lab' KEEPS ITS OWN RECORDS. The plan's hard constraint is that
--      nothing belonging to the six external-lab rows changes meaning. The
--      entity-scoped policies were deliberately not rewritten, and this is
--      what says so: a lab still reads the obligations that are its own.
--      If this fails, the migration reached past permissions and into data.
--   3. THE COORDINATOR INHERITED THE REPRESENTATIVE. Step 2b's half.
--   4. THE COORDINATOR DID NOT INHERIT THE FLOOR. Section 4.3 gives them the
--      board to read and nothing to move. This is the boundary most likely
--      to erode later, because "they can see it" and "they can do it" look
--      alike from the UI.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(14);

-- ─── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'scope-lab@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('f1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'scope-pm@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('f1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'scope-coord@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('f1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'scope-tech@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

-- The lab user is bound to a supplier, exactly as the six real ones are.
INSERT INTO public.suppliers (id, name, phone) VALUES
    ('f3000000-0000-0000-0000-000000000001', 'Scope External Lab', '0000000000');

INSERT INTO public.users (id, auth_id, username, role, name, entity_id) VALUES
    ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
     'scope-lab', 'lab', 'External Lab User', 'f3000000-0000-0000-0000-000000000001'),
    ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002',
     'scope-pm', 'production_manager', 'Production Manager', NULL),
    ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000003',
     'scope-coord', 'coordinator', 'Coordinator', NULL),
    ('f2000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000004',
     'scope-tech', 'technician', 'Technician', NULL);

-- ─── 1. 'lab' is off the floor ───────────────────────────────────────────

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.can_work_production(), FALSE,
    'lab can no longer work production -- the role was never the floor');

SELECT throws_like(
    $$SELECT public.start_production_for_order(NULL)$$,
    '%production manager role required%',
    'lab cannot start production, and the message now names who can');

-- ─── 2. 'lab' keeps its own records ──────────────────────────────────────
-- The entity-scoped policies were left alone on purpose. This is the
-- assertion that catches step 3 if it reached past permissions into data.

-- Asserted structurally rather than by inserting an obligation: rows in
-- financial_obligations are written only by the trigger on orders, never by
-- hand (see FinancialObligationsReview), so a fixture here would be testing a
-- path that does not exist. What must hold is that step 3 left the
-- entity-scoped policy alone -- still keyed on 'lab', still scoped by which
-- supplier you are.
SELECT is(
    (SELECT count(*)::integer FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'financial_obligations'
       AND policyname = 'Labs manage own payable obligations'
       AND qual ~ '''lab''' AND qual ~ 'get_my_entity_id'),
    1,
    'the external lab keeps its own payable obligations -- identity, not authority');

SELECT is(
    (SELECT count(*)::integer FROM public.suppliers
     WHERE id = 'f3000000-0000-0000-0000-000000000001'),
    1,
    'lab still reads its own supplier row');

-- Production carries a role on services_select that the migration chain never
-- had: somebody added 'doctor' there by hand. Regenerating the policy from
-- the chain would have revoked it silently -- a doctor would open the portal
-- and find an empty catalogue, with nothing in the diff to explain why. The
-- rewrite carries it forward, and this holds that line.
SELECT is(
    (SELECT count(*)::integer FROM pg_policies
     WHERE schemaname = 'public' AND policyname = 'services_select'
       AND qual ~ '''doctor'''),
    1,
    'services_select still admits the doctor -- production had it, the chain did not');

-- ─── 3. The production manager picked the floor up ───────────────────────

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.can_work_production(), TRUE,
    'the production manager can work production');

SELECT lives_ok(
    $$SELECT count(*) FROM public.production_stage_runs$$,
    'the production manager reads stage runs');

SELECT lives_ok(
    $$SELECT public.get_production_capacity_and_bottlenecks(NULL, NULL)$$,
    'the production manager reads capacity and bottlenecks (section 4.2)');

-- Decision 2. Asserted by what the refusal is NOT: the stage name is blank,
-- so this fails validation (22023) rather than authorisation (42501). If the
-- role were still locked out we would get 42501 here instead.
SELECT throws_ok(
    $$SELECT public.create_production_stage('')$$,
    '22023',
    NULL,
    'the production manager is past the route-editing guard (decision 2)');

-- The technician is the control for step 3: it shared every one of these
-- guards with 'lab' and must not have been disturbed by the swap.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000004', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.can_work_production(), TRUE,
    'the technician still works production -- step 3 swapped one name, not two');

-- ─── 4. The coordinator: representative yes, floor no ────────────────────

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000003', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.can_work_production(), FALSE,
    'the coordinator cannot move a stage run -- they relay work, not do it');

SELECT lives_ok(
    $$SELECT count(*) FROM public.production_stage_runs$$,
    'the coordinator still READS the board -- knowing where a case is, is the job');

SELECT lives_ok(
    $$SELECT count(*) FROM public.doctors$$,
    'the coordinator inherited the representative''s doctors (step 2b)');

SELECT lives_ok(
    $$SELECT public.get_todays_follow_ups()$$,
    'the coordinator inherited the representative''s follow-up queue (step 2b)');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
