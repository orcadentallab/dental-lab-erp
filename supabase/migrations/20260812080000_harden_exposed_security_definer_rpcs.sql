-- Migration: Harden SECURITY DEFINER RPCs that are reachable by anon
--
-- Context / root cause:
--   Postgres grants EXECUTE on functions to PUBLIC by default. Migration
--   20260801080000_harden_rls_and_reporting_rpcs.sql closed this for the
--   analytics/reporting RPCs (rename -> privileged, REVOKE, admin-gated
--   wrapper), but three SECURITY DEFINER functions were never covered:
--
--     1. get_doctor_receivables_breakdown()  -- defined in temp_migrations/088,
--        outside the migrations/ chain, so the 20260801 hardening pass missed it.
--     2. get_marketing_summary()             -- defined in supabase/manual/,
--        likewise outside the migrations/ chain.
--     3. workflow_flag_enabled(TEXT)         -- added 20260808, after the
--        hardening pass; no REVOKE was included.
--
--   All three were verified callable in production using only the public anon
--   key (which ships inside the frontend bundle and is therefore not secret).
--   get_doctor_receivables_breakdown returned 49 doctor rows including
--   doctorName, doctorPhone, balance and full aging buckets.
--
-- This migration is idempotent and changes NO business logic or data --
-- only who is allowed to execute these functions.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. get_doctor_receivables_breakdown()  [CRITICAL — doctor PII + AR]
--    Follows the established rename -> privileged + admin-gated wrapper
--    pattern from 20260801080000, so the body is not duplicated here.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_doctor_receivables_breakdown'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'get_doctor_receivables_breakdown_privileged_20260812'
    ) THEN
        EXECUTE 'ALTER FUNCTION public.get_doctor_receivables_breakdown()
                 RENAME TO get_doctor_receivables_breakdown_privileged_20260812';
    END IF;
END $$;

DO $outer$
BEGIN
    IF to_regprocedure('public.get_doctor_receivables_breakdown_privileged_20260812()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.get_doctor_receivables_breakdown_privileged_20260812() FROM PUBLIC, anon, authenticated';
        EXECUTE $ddl$
            CREATE OR REPLACE FUNCTION public.get_doctor_receivables_breakdown()
            RETURNS JSONB
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, auth
            AS $body$
            BEGIN
                IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
                    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
                END IF;
                RETURN public.get_doctor_receivables_breakdown_privileged_20260812();
            END;
            $body$
        $ddl$;
        EXECUTE 'REVOKE ALL ON FUNCTION public.get_doctor_receivables_breakdown() FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_doctor_receivables_breakdown() TO authenticated';
    END IF;
END
$outer$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. get_marketing_summary(timestamptz, timestamptz)  [marketing aggregates]
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_marketing_summary'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'get_marketing_summary_privileged_20260812'
    ) THEN
        EXECUTE 'ALTER FUNCTION public.get_marketing_summary(timestamptz, timestamptz)
                 RENAME TO get_marketing_summary_privileged_20260812';
    END IF;
END $$;

DO $outer$
BEGIN
    IF to_regprocedure('public.get_marketing_summary_privileged_20260812(timestamptz,timestamptz)') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.get_marketing_summary_privileged_20260812(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated';
        EXECUTE $ddl$
            CREATE OR REPLACE FUNCTION public.get_marketing_summary(
                p_start_date timestamptz DEFAULT (now() - INTERVAL '30 days'),
                p_end_date timestamptz DEFAULT now()
            )
            RETURNS JSONB
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, auth
            AS $body$
            BEGIN
                IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
                    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
                END IF;
                RETURN public.get_marketing_summary_privileged_20260812(p_start_date, p_end_date);
            END;
            $body$
        $ddl$;
        EXECUTE 'REVOKE ALL ON FUNCTION public.get_marketing_summary(timestamptz, timestamptz) FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_marketing_summary(timestamptz, timestamptz) TO authenticated';
    END IF;
END
$outer$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. workflow_flag_enabled(TEXT)  [feature-flag disclosure]
--
--    NOT admin-gated on purpose. This function is evaluated inside CHECK
--    constraints on public.orders (see 20260808004000) and inside many
--    SECURITY DEFINER workflow functions. CHECK constraint expressions run
--    as the writing user, so `authenticated` must retain EXECUTE or every
--    order INSERT/UPDATE by a normal user would fail. Only the implicit
--    PUBLIC/anon grant is withdrawn.
-- ─────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.workflow_flag_enabled(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_flag_enabled(TEXT) TO authenticated;

COMMIT;
