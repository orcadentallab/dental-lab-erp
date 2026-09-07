-- Guards 20260907010000 (drop get_orders_paginated) and 20260907020000
-- (adopt admin_reset_password into the chain), both found by the same
-- production-drift audit (docs/PRODUCTION_ROLES_PLAN_AR.md section 8.6).
--
-- Two properties, opposite directions:
--   1. The dead experiment is actually gone. A silent no-op DROP IF EXISTS
--      is exactly the kind of thing that looks like it worked and didn't.
--   2. The live function survived being adopted into the chain with its
--      grants tightened -- an admin can still reset a password, a
--      non-admin cannot, and the anon key (verified reachable in production
--      before this migration) is now refused before the function body even
--      runs.
--
-- security_definer_rpc_grants.test.sql now covers the catalog-level grant
-- posture for admin_reset_password (test 2's guard, plus its own row in the
-- expectations table). This file is the functional half: does the RPC
-- actually do what an admin needs and refuse what a non-admin should not have.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(5);

-- ─── 1. The dead experiment is gone ──────────────────────────────────────

SELECT is(
    to_regprocedure('public.get_orders_paginated(integer,integer,text,text,text,text)'),
    NULL,
    'get_orders_paginated no longer exists -- nobody called it, so nothing can break');

-- ─── Fixtures for the functional checks ──────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('e9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'reset-admin@example.test', crypt('irrelevant', gen_salt('bf')),
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('e9000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'reset-rep@example.test', crypt('irrelevant', gen_salt('bf')),
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('e9000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'reset-target@example.test', crypt('old-password-123', gen_salt('bf')),
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('ea000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'reset-admin', 'admin', 'Reset Admin'),
    ('ea000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000002', 'reset-rep', 'representative', 'Reset Rep'),
    ('ea000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000003', 'reset-target', 'representative', 'Reset Target');

-- ─── 2. An admin can actually reset a password ───────────────────────────

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
    $$SELECT public.admin_reset_password('ea000000-0000-0000-0000-000000000003', 'new-password-456')$$,
    'an admin can reset another user''s password');

RESET ROLE;
SELECT is(
    (SELECT encrypted_password = crypt('new-password-456', encrypted_password)
     FROM auth.users WHERE id = 'e9000000-0000-0000-0000-000000000003'),
    TRUE,
    'the target''s encrypted_password actually changed to the new value');

-- ─── 3. A non-admin cannot ────────────────────────────────────────────────

SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT throws_like(
    $$SELECT public.admin_reset_password('ea000000-0000-0000-0000-000000000003', 'hijacked-password')$$,
    '%Unauthorized%',
    'a representative cannot reset anyone''s password');

-- ─── 4. The anon key (reachable in production before this migration) is now refused up front ──

RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
    $$SELECT public.admin_reset_password('ea000000-0000-0000-0000-000000000003', 'anon-attempt')$$,
    '42501',
    NULL,
    'anon is refused by the grant itself -- the function body never runs for it');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
