-- Regression guard for SECURITY DEFINER RPC execute grants.
--
-- Incident this protects against (2026-08-12):
--   Postgres grants EXECUTE to PUBLIC by default, so a SECURITY DEFINER
--   function is reachable by `anon` unless explicitly REVOKEd. The
--   20260801080000 hardening pass only walked supabase/migrations/, so three
--   functions stayed publicly callable with the anon key that ships inside the
--   frontend bundle -- including get_doctor_receivables_breakdown, which
--   returned every doctor's name, phone, balance and aging buckets.
--   Fixed by 20260812080000_harden_exposed_security_definer_rpcs.sql.
--
-- Test 2 is the important one: it is catalog-driven rather than a fixed list,
-- so any NEW SECURITY DEFINER function added without a REVOKE fails this suite
-- automatically, in whatever environment it runs. Tests 3-6 pin the specific
-- functions from that incident so a regression names itself.
--
-- Pure privilege introspection: no fixtures, no writes.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(6);

-- ─── Intentional exceptions ─────────────────────────────────────────────
-- Functions that MAY remain executable by anon. Adding a name here must be a
-- deliberate decision: it means "safe to expose to the public internet",
-- because the anon key ships in the frontend bundle and is not a secret.
--
--   get_my_role / get_my_user_id / get_my_entity_id
--     Self-scoped: each resolves auth.uid() and returns NULL for an
--     unauthenticated caller, so they leak nothing. They are also called from
--     RLS policy expressions, which are evaluated as the calling user, so
--     revoking them would break RLS evaluation for every role.
--
--   get_email_by_username
--     REQUIRED by the username login flow: AuthContext.tsx resolves
--     username -> email via this RPC *before* authenticating, so the caller is
--     necessarily anon. Revoking it breaks login for everyone.
--     ACCEPTED RISK, not an oversight: it is a username-enumeration and
--     staff-email-disclosure oracle (returns the email for a real username,
--     NULL otherwise). Mitigating it properly means moving the lookup behind a
--     rate-limited edge function; until then it stays deliberately open.
CREATE TEMP TABLE anon_execute_allowlist (proname text PRIMARY KEY)
    ON COMMIT DROP;
INSERT INTO anon_execute_allowlist (proname) VALUES
    ('get_my_role'),
    ('get_my_user_id'),
    ('get_my_entity_id'),
    ('get_email_by_username');

-- ─── Expected posture per RPC ───────────────────────────────────────────
--   kind = 'wrapper'    -> anon denied, authenticated allowed
--   kind = 'privileged' -> anon denied, authenticated denied (the admin gate
--                          lives in the wrapper; reaching the inner function
--                          directly would bypass it entirely)
--
--   in_chain marks functions reproducible from supabase/migrations/ alone.
--   get_doctor_receivables_breakdown and get_marketing_summary were originally
--   false here: they lived in temp_migrations/088 and manual/marketing_events.sql,
--   so they existed in production but could not exist in a database built from
--   the chain, and their absence had to be tolerated. 20260812090000 and
--   20260812091000 adopted them into the chain, so every entry is now in_chain
--   and existence is asserted for all of them.
CREATE TEMP TABLE rpc_expectations (sig text, kind text, in_chain boolean)
    ON COMMIT DROP;
INSERT INTO rpc_expectations (sig, kind, in_chain) VALUES
    -- fixed by 20260812080000
    ('public.get_doctor_receivables_breakdown()',                              'wrapper',    true),
    ('public.get_marketing_summary(timestamptz,timestamptz)',                  'wrapper',    true),
    ('public.get_doctor_receivables_breakdown_privileged_20260812()',          'privileged', true),
    ('public.get_marketing_summary_privileged_20260812(timestamptz,timestamptz)', 'privileged', true),
    -- workflow_flag_enabled is evaluated inside CHECK constraints on
    -- public.orders (20260808004000). CHECK expressions run as the writing
    -- user, so losing the authenticated grant would make every order
    -- INSERT/UPDATE by a normal user fail.
    ('public.workflow_flag_enabled(text)',                                     'wrapper',    true),
    -- added by 20260812110000 (issue counts from order_issues, the correct source)
    ('public.get_order_issues_summary(date,date)',                             'wrapper',    true),
    -- added by 20260816002000 (audited correction / voiding of a logged issue)
    ('public.correct_order_issue_cause(uuid,text,text,text)',                  'wrapper',    true),
    ('public.void_order_issue(uuid,text)',                                     'wrapper',    true),
    -- added by 20260816003000 (doctor x service profitability)
    ('public.get_doctor_service_profitability(date,date)',                     'wrapper',    true),
    -- hardened by 20260801080000
    ('public.get_analytics_summary(date,date)',                                'wrapper',    true),
    ('public.get_top_doctors(date,date,integer)',                              'wrapper',    true),
    ('public.get_top_services(date,date,integer)',                             'wrapper',    true),
    ('public.get_top_expense_categories(date,date,integer)',                   'wrapper',    true),
    ('public.get_finance_dashboard()',                                         'wrapper',    true),
    ('public.get_dashboard_data()',                                            'wrapper',    true),
    ('public.admin_review_order_edit(uuid,text,text)',                         'wrapper',    true),
    ('public.rep_update_order_fields_with_audit(uuid,jsonb,text,text)',        'wrapper',    true),
    ('public.settle_employee_expenses(uuid[],numeric,uuid,date,date)',         'wrapper',    true),
    ('public.get_doctors_activity_analytics(uuid)',                            'wrapper',    true),
    ('public.get_todays_follow_ups()',                                         'wrapper',    true),
    ('public.get_analytics_summary_privileged_20260801(date,date)',            'privileged', true),
    ('public.get_top_doctors_privileged_20260801(date,date,integer)',          'privileged', true),
    ('public.get_top_services_privileged_20260801(date,date,integer)',         'privileged', true),
    ('public.get_top_expense_categories_privileged_20260801(date,date,integer)', 'privileged', true),
    ('public.get_finance_dashboard_privileged_20260801()',                     'privileged', true),
    ('public.get_dashboard_data_privileged_20260801()',                        'privileged', true);

-- ─── 1. Sanity: the catalog is populated ────────────────────────────────
-- Without this, every assertion below could pass vacuously (e.g. if the
-- schema failed to load at all).
SELECT cmp_ok(
    (SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef),
    '>',
    20::bigint,
    'catalog is populated: >20 SECURITY DEFINER functions exist in public'
);

-- ─── 2. THE GUARD: nothing reachable by anon ────────────────────────────
-- Catalog-driven, so it covers functions nobody remembered to list below.
-- Trigger functions are excluded: they are not directly invocable.
SELECT is(
    (SELECT string_agg(p.oid::regprocedure::text, E'\n  ' ORDER BY p.oid::regprocedure::text)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.prorettype <> 'pg_catalog.trigger'::regtype
       AND p.proname NOT IN (SELECT proname FROM anon_execute_allowlist)
       AND has_function_privilege('anon', p.oid, 'EXECUTE')),
    NULL,
    'no SECURITY DEFINER function in public grants EXECUTE to anon'
);

-- ─── 3. In-chain RPCs must actually exist ───────────────────────────────
-- Guards against a rename or drop silently turning tests 4-6 into no-ops.
SELECT is(
    (SELECT string_agg(sig, ', ' ORDER BY sig)
     FROM rpc_expectations
     WHERE in_chain AND to_regprocedure(sig) IS NULL),
    NULL,
    'every in-chain hardened RPC still exists under its expected signature'
);

-- ─── 4. Listed RPCs deny anon ───────────────────────────────────────────
SELECT is(
    (SELECT string_agg(sig, ', ' ORDER BY sig)
     FROM rpc_expectations
     WHERE to_regprocedure(sig) IS NOT NULL
       AND has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')),
    NULL,
    'every hardened RPC denies EXECUTE to anon'
);

-- ─── 5. Inner privileged functions deny authenticated too ───────────────
SELECT is(
    (SELECT string_agg(sig, ', ' ORDER BY sig)
     FROM rpc_expectations
     WHERE kind = 'privileged'
       AND to_regprocedure(sig) IS NOT NULL
       AND has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE')),
    NULL,
    'inner *_privileged_* functions deny authenticated as well as anon'
);

-- ─── 6. Anti-over-revoke: the app must still work ───────────────────────
-- The opposite failure mode: revoking too much silently breaks every admin
-- report, and (for workflow_flag_enabled) every order write.
SELECT is(
    (SELECT string_agg(sig, ', ' ORDER BY sig)
     FROM rpc_expectations
     WHERE kind = 'wrapper'
       AND to_regprocedure(sig) IS NOT NULL
       AND NOT has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE')),
    NULL,
    'admin-gated wrappers remain executable by authenticated (no over-revoke)'
);

SELECT * FROM finish();

ROLLBACK;
