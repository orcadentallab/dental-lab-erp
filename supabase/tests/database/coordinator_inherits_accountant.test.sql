-- The coordinator inherits the accountant, and nothing else moves.
--
-- Guards 20260905030000_coordinator_inherits_accountant.sql -- step 2a of 3
-- in docs/PRODUCTION_ROLES_PLAN_AR.md (decision 3).
--
-- That migration is 2700 lines of regenerated function and policy bodies in
-- which 13 guard lines changed. Reading it proves very little; the risk is
-- not in the lines that changed but in what the regeneration might have
-- disturbed on the way past. So this file asserts the three properties that
-- matter, none of which is visible by reading the diff:
--
--   1. THE COORDINATOR ARRIVED. A role that is spellable but reaches nothing
--      is the failure mode step 1 was written to avoid, and it would look
--      identical to success in the migration output.
--   2. THE ACCOUNTANT DID NOT MOVE. Decision 5 keeps 'accountant' as a live
--      role with Emad on it. The rewrite touched every policy that mentions
--      it, so "additive" is a claim about 54 policies that has to be checked,
--      not assumed. Emad losing finance access is the expensive regression.
--   3. THE LIMITS HELD. Decision 3 draws one hard line: the coordinator
--      inherits the accountant's reach but NOT DELETE on transactions,
--      doctors or suppliers, which stay admin-only. Those three policies were
--      not regenerated, so a failure here means something widened them by
--      accident.
--
-- Production reach is deliberately NOT asserted here. The coordinator gets
-- read-only production and shared shipping in step 3; asserting it now would
-- bake in today's absence as if it were the design.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(14);

-- ─── Fixtures ────────────────────────────────────────────────────────────
-- One coordinator, one accountant, one representative. The accountant is the
-- control: every coordinator assertion below has a matching one for them, so
-- a failure says which of the two roles broke.

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'coord@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'coord-acct@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('c1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'coord-rep@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
     'coord', 'coordinator', 'The Coordinator'),
    ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002',
     'coord-acct', 'accountant', 'The Accountant'),
    ('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003',
     'coord-rep', 'representative', 'The Representative');

-- One row per protected table. Without these the DELETE assertions below
-- would pass against empty tables no matter what the policies said, which is
-- the quiet way a permission test stops testing anything.
INSERT INTO public.suppliers (id, name, phone) VALUES
    ('c3000000-0000-0000-0000-000000000001', 'Fixture Supplier', '0000000000');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name) VALUES
    ('c3000000-0000-0000-0000-000000000002', 'Fixture Doctor', '0000000000',
     'Fixture Address', 'FIXDOC1', 'Fixture Rep');

INSERT INTO public.transactions (id, type, amount, category, date, description) VALUES
    ('c3000000-0000-0000-0000-000000000003', 'income', 100, 'general',
     CURRENT_DATE, 'Fixture transaction');

-- ─── 1. The coordinator arrived ──────────────────────────────────────────

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.get_my_role(), 'coordinator',
    'a coordinator resolves to their own role, not a borrowed one');

-- get_finance_dashboard raises 'finance role required' for anyone outside the
-- finance set. It is the cheapest single probe for the whole finance surface.
SELECT lives_ok(
    $$SELECT public.get_finance_dashboard()$$,
    'a coordinator can execute the finance dashboard');

SELECT lives_ok(
    $$SELECT public.get_order_cost_breakdown(NULL)$$,
    'a coordinator can read order costing');

SELECT lives_ok(
    $$SELECT count(*) FROM public.transactions$$,
    'a coordinator can read transactions -- collection is their job');

SELECT lives_ok(
    $$SELECT count(*) FROM public.material_purchases$$,
    'a coordinator can read material purchases');

SELECT lives_ok(
    $$SELECT count(*) FROM public.financial_obligations$$,
    'a coordinator can read financial obligations');

-- ─── 2. The limits held ──────────────────────────────────────────────────
-- Decision 3's explicit boundary. These three policies name 'admin' alone and
-- were not regenerated, so this is a check that nothing widened them in
-- passing.
--
-- A DELETE refused by RLS removes zero rows rather than raising, so these
-- assert on rows and not on an exception. is_empty runs the statement and
-- checks it returned nothing: each fixture row targeted below is real and
-- was inserted above, so an empty RETURNING means the policy refused -- not
-- that there was nothing there to delete.

SELECT is_empty(
    $$DELETE FROM public.transactions
      WHERE id = 'c3000000-0000-0000-0000-000000000003' RETURNING 1$$,
    'a coordinator cannot delete transactions -- that stays admin-only');

SELECT is_empty(
    $$DELETE FROM public.doctors
      WHERE id = 'c3000000-0000-0000-0000-000000000002' RETURNING 1$$,
    'a coordinator cannot delete doctors');

SELECT is_empty(
    $$DELETE FROM public.suppliers
      WHERE id = 'c3000000-0000-0000-0000-000000000001' RETURNING 1$$,
    'a coordinator cannot delete suppliers');

-- ─── 3. The accountant did not move ──────────────────────────────────────
-- The control. Every policy naming 'accountant' was dropped and recreated by
-- the migration; this is what says the recreation was faithful.

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.get_my_role(), 'accountant',
    'the accountant role still resolves -- decision 5 keeps it live');

SELECT lives_ok(
    $$SELECT public.get_finance_dashboard()$$,
    'the accountant did not lose the finance dashboard');

SELECT lives_ok(
    $$SELECT count(*) FROM public.transactions$$,
    'the accountant did not lose transactions');

-- ─── 4. Nobody else was widened ──────────────────────────────────────────
-- The regeneration rewrote policies that also name 'representative'. If the
-- pass had been sloppy about which literal it was adding to, the
-- representative is where it would show.

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000003', TRUE);
SET LOCAL ROLE authenticated;

SELECT throws_like(
    $$SELECT public.get_finance_dashboard()$$,
    '%finance role required%',
    'a representative still cannot reach finance aggregates');

SELECT is(public.get_my_role(), 'representative',
    'the representative role is unchanged');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
