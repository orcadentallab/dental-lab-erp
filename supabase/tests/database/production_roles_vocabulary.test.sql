-- The role vocabulary, and the promise that widening it changed nothing.
--
-- Guards 20260905010000_add_production_manager_and_coordinator_roles.sql --
-- step 1 of 3 in docs/PRODUCTION_ROLES_PLAN_AR.md.
--
-- Three things fail here in ways that would not surface until much later:
--
--   1. A ROLE THAT CANNOT BE SPELLED. Steps 2 and 3 write policies naming
--      'production_manager' and 'coordinator'. If the CHECK never accepted
--      them, those policies would be syntactically fine and permanently dead,
--      because no row could ever hold the role they test for.
--   2. A ROLE QUIETLY DROPPED. Rewriting a CHECK is a full replacement, so
--      forgetting one existing value silently makes those rows unupdatable.
--      'lab' and 'accountant' are the two at risk: the plan removes their
--      PERMISSIONS but keeps both roles -- the six external-lab rows must keep
--      validating, and 'accountant' stays as a standalone hiring option
--      (decision 5). Every existing role is asserted individually.
--   3. A STEP THAT IS NOT INERT. The whole reason this is a separate migration
--      is that it grants nothing. If anything in it started referencing the
--      new roles, the "revert step 1 freely" property is gone. The last two
--      assertions hold that line: after step 1, no policy and no function may
--      mention either new role. THESE TWO TESTS ARE EXPECTED TO FAIL WHEN
--      STEP 2 LANDS -- that is their job. Delete them there, deliberately,
--      rather than weakening them.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(12);

-- ─── Every role in the vocabulary is insertable ──────────────────────────
-- One assertion per value rather than a loop: a loop reports "some role
-- failed", and the whole point is knowing WHICH.

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-admin', 'admin', 'Vocab Admin')$$,
    'admin is still a valid role');

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-lab', 'lab', 'Vocab Lab')$$,
    'lab is retained -- the six external-lab rows must keep validating');

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-rep', 'representative', 'Vocab Rep')$$,
    'representative is still a valid role');

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-acct', 'accountant', 'Vocab Accountant')$$,
    'accountant is retained as a standalone hiring option (decision 5)');

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-designer', 'designer', 'Vocab Designer')$$,
    'designer is still a valid role');

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-doctor', 'doctor', 'Vocab Doctor')$$,
    'doctor is still a valid role');

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-tech', 'technician', 'Vocab Technician')$$,
    'technician is still a valid role');

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-pm', 'production_manager', 'Vocab Production Manager')$$,
    'production_manager is now spellable');

SELECT lives_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-coord', 'coordinator', 'Vocab Coordinator')$$,
    'coordinator is now spellable');

-- ─── The constraint still constrains ─────────────────────────────────────
-- Widening a CHECK by hand is exactly how one ends up with a column that
-- accepts anything. 23514 is check_violation.

SELECT throws_ok(
    $$INSERT INTO public.users (username, role, name)
      VALUES ('vocab-bogus', 'supervisor', 'Vocab Bogus')$$,
    '23514',
    NULL,
    'an unlisted role is still refused -- the CHECK was widened, not dropped');

-- ─── Step 1 is inert ─────────────────────────────────────────────────────
-- Nothing may grant the new roles anything yet. Step 2 makes both of these
-- fail on purpose; remove them there.

SELECT is(
    (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') || coalesce(with_check, ''))
           ~ '''(production_manager|coordinator)'''),
    0::bigint,
    'step 1 grants nothing: no RLS policy references the new roles');

SELECT is(
    (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ~ '''(production_manager|coordinator)'''),
    0::bigint,
    'step 1 grants nothing: no function references the new roles');

SELECT * FROM finish();
ROLLBACK;
