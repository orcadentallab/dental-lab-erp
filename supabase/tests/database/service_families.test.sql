-- Service families: RLS posture, the top-families contract, and the atomic
-- repricing RPC (20260826000000, 20260826002000, 20260826003000, 20260826005000).
--
-- Two of these assertions exist because of specific defects that shipped:
--
--   * get_top_families returned a bare ranked array built from order_items.
--     Orders holding a receivable with no items could not appear in it, so the
--     card silently omitted ~10% of period revenue and could not be reconciled
--     against the doctor statement. The contract is now an object carrying
--     total / allocated / itemless, and the identity between them is asserted.
--
--   * bulk repricing was a per-service UPDATE loop in TypeScript, so a failure
--     partway left the catalogue half-repriced with no record of which half.
--     The dry-run path is asserted to write nothing, because that is what the
--     confirmation step in the UI depends on.
--
-- Privilege introspection plus one temporary family; everything rolls back.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(25);

-- ─── Schema ─────────────────────────────────────────────────────────────
SELECT has_table('public', 'service_families', 'service_families table exists');
SELECT has_column('public', 'services', 'family_id', 'services carries family_id');
SELECT col_is_fk('public', 'services', ARRAY['family_id'], 'services.family_id is a foreign key');

-- The three name-based joins between order_items and the catalogue multiply
-- rather than fail if a name repeats, so uniqueness is load-bearing for every
-- per-service and per-family figure in the app.
SELECT has_index('public', 'services', 'idx_services_name_unique_ci',
    'services has a case-insensitive unique index on name');
SELECT ok(
    (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.idx_services_name_unique_ci'::regclass),
    'the service-name index is actually UNIQUE, not merely present'
);

-- ─── RLS ────────────────────────────────────────────────────────────────
SELECT ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.service_families'::regclass),
    'RLS is enabled on service_families'
);
SELECT is(
    (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'service_families'),
    4,
    'service_families has exactly the four expected policies'
);
SELECT ok(
    (SELECT bool_and(qual = '(get_my_role() = ''admin''::text)' OR with_check = '(get_my_role() = ''admin''::text)')
     FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'service_families' AND cmd <> 'SELECT'),
    'every write policy on service_families is admin-only'
);

-- ─── Function existence and grants ──────────────────────────────────────
SELECT has_function('public', 'get_top_families', ARRAY['date', 'date', 'integer'],
    'get_top_families wrapper exists');
SELECT has_function('public', 'adjust_family_prices',
    ARRAY['uuid', 'text', 'numeric', 'text', 'boolean'],
    'adjust_family_prices exists');

-- The wrapper holds the admin check, so signed-in callers must reach it.
SELECT ok(
    has_function_privilege('authenticated', 'public.get_top_families(date,date,integer)', 'EXECUTE'),
    'signed-in callers reach get_top_families, where the admin check lives'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.get_top_families(date,date,integer)', 'EXECUTE'),
    'anonymous callers cannot call get_top_families'
);

-- The regression that shipped: revoking the wrapper and not the body leaves
-- the admin gate bypassable, and SECURITY DEFINER means RLS is bypassed too.
SELECT ok(
    NOT has_function_privilege('authenticated',
        'public.get_top_families_privileged_20260826(date,date,integer)', 'EXECUTE'),
    'the privileged body is unreachable by authenticated (the admin gate is in the wrapper)'
);
SELECT ok(
    NOT has_function_privilege('anon',
        'public.get_top_families_privileged_20260826(date,date,integer)', 'EXECUTE'),
    'the privileged body is unreachable by anon'
);
SELECT ok(
    NOT has_function_privilege('anon',
        'public.adjust_family_prices(uuid,text,numeric,text,boolean)', 'EXECUTE'),
    'anonymous callers cannot reprice a family'
);

-- ─── The reconciliation contract ────────────────────────────────────────
-- Called directly, bypassing the wrapper's admin check, to assert the SHAPE
-- the UI relies on rather than the authorisation (covered above).
CREATE TEMP TABLE top_families_probe ON COMMIT DROP AS
SELECT public.get_top_families_privileged_20260826(NULL, NULL, 5) AS payload;

SELECT ok(
    (SELECT payload ? 'families' AND payload ? 'family_count'
        AND payload ? 'total_revenue' AND payload ? 'allocated_revenue'
        AND payload ? 'itemless_revenue'
     FROM top_families_probe),
    'get_top_families returns the full reconciliation object, not a bare array'
);
SELECT ok(
    (SELECT jsonb_typeof(payload -> 'families') = 'array' FROM top_families_probe),
    'families is an array'
);

-- The identity that makes the card addable against the doctor statement.
SELECT ok(
    (SELECT abs(
        (payload ->> 'total_revenue')::numeric
        - (payload ->> 'allocated_revenue')::numeric
        - (payload ->> 'itemless_revenue')::numeric
     ) < 0.01
     FROM top_families_probe),
    'total_revenue = allocated_revenue + itemless_revenue'
);

-- ─── Repricing is atomic, and dry runs write nothing ────────────────────
INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('99200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'family-admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('99200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'family-rep@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('39200000-0000-0000-0000-000000000001', '99200000-0000-0000-0000-000000000001',
     'family_admin', 'admin', 'Family Admin'),
    ('39200000-0000-0000-0000-000000000002', '99200000-0000-0000-0000-000000000002',
     'family_rep', 'representative', 'Family Representative');

INSERT INTO public.service_families (id, name_ar, color)
VALUES ('00000000-0000-0000-0000-0000000000f1', 'عائلة اختبار', 'emerald');

INSERT INTO public.services (id, name, selling_price, cost_price, family_id)
VALUES
    ('00000000-0000-0000-0000-0000000000f2', 'zz test service alpha', 100, 50,
     '00000000-0000-0000-0000-0000000000f1'),
    ('00000000-0000-0000-0000-0000000000f3', 'zz test service beta', 200, 80,
     '00000000-0000-0000-0000-0000000000f1');

-- The grant reaches every signed-in role, so the admin gate inside the
-- function is the only thing standing between a rep and the price list.
SELECT set_config('request.jwt.claim.sub', '99200000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;
SELECT throws_like(
    $$SELECT public.adjust_family_prices(
        '00000000-0000-0000-0000-0000000000f1', 'percentage', 10, 'sellingPrice', FALSE
    )$$,
    '%admin role required%',
    'a representative cannot reprice a family'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '99200000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

-- A dry run must report the change and leave the prices alone; the UI shows
-- this list and only then asks for confirmation.
SELECT is(
    (SELECT (public.adjust_family_prices(
        '00000000-0000-0000-0000-0000000000f1', 'percentage', 10, 'sellingPrice', TRUE
    ) ->> 'affected')::int),
    2,
    'a dry run reports both services as affected'
);
SELECT is(
    (SELECT (public.adjust_family_prices(
        '00000000-0000-0000-0000-0000000000f1', 'percentage', 10, 'sellingPrice', TRUE
    ) ->> 'applied')::int),
    0,
    'a dry run writes nothing'
);
SELECT is(
    (SELECT selling_price FROM public.services
     WHERE id = '00000000-0000-0000-0000-0000000000f2'),
    100::numeric,
    'prices are untouched after a dry run'
);

-- Applying for real covers the whole family in one statement.
SELECT is(
    (SELECT (public.adjust_family_prices(
        '00000000-0000-0000-0000-0000000000f1', 'percentage', 10, 'sellingPrice', FALSE
    ) ->> 'applied')::int),
    2,
    'applying for real writes every service in the family'
);
SELECT results_eq(
    $$SELECT selling_price::numeric FROM public.services
      WHERE family_id = '00000000-0000-0000-0000-0000000000f1' ORDER BY name$$,
    $$VALUES (110::numeric), (220::numeric)$$,
    'both services moved by exactly 10%'
);

-- A percentage that would invert prices is rejected rather than clamped.
SELECT throws_like(
    $$SELECT public.adjust_family_prices(
        '00000000-0000-0000-0000-0000000000f1', 'percentage', -150, 'both', FALSE
    )$$,
    '%zero or invert%',
    'a percentage below -100 is refused'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
