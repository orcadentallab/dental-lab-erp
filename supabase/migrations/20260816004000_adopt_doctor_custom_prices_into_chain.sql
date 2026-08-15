-- Migration: adopt doctors.custom_prices into the migration chain.
--
-- ROOT CAUSE
--
-- `doctors.custom_prices` has never existed in supabase/migrations/. The
-- `custom_prices` column in 001_initial_schema.sql line 103 belongs to
-- `suppliers`, not `doctors`. The doctors column was only ever created by
-- supabase/temp_migrations/20260328155531_add_doctor_custom_prices.sql,
-- which is outside the chain and was applied to production by hand.
--
-- CONSEQUENCE
--
-- 20260812040000_top_doctors_and_services_statement_parity.sql reads
-- `pd.custom_prices` inside get_top_services_privileged_20260801. plpgsql
-- resolves column references at execution time, not at CREATE time, so the
-- migration applies cleanly and the breakage only appears when an admin
-- actually opens the report:
--
--   ERROR: column pd.custom_prices does not exist
--
-- Production is unaffected today because the hand-applied temp migration put
-- the column there. Every environment built from the chain alone — a local
-- `supabase db reset`, CI, a new staging project — has a silently broken
-- get_top_services. Verified against the local database, which has all 172
-- chain migrations applied and still lacks the column.
--
-- FIX
--
-- Bring the column into the chain. IF NOT EXISTS makes this a no-op on
-- production, where it already exists, so this is safe to apply anywhere.
-- The same column is read by get_doctor_service_profitability
-- (20260816003000), which would otherwise have inherited the same fragility.
--
-- This does not backfill anything: the column is nullable and every reader
-- already COALESCEs past NULL to the catalog price.

BEGIN;

ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS custom_prices JSONB;

COMMENT ON COLUMN public.doctors.custom_prices
    IS 'Per-doctor price overrides, keyed by service name: {"<service name>": <price>}. NULL or a missing key means fall back to services.selling_price.';

COMMIT;
