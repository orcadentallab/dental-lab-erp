-- Migration: add credit limit / stop-work threshold to entity_billing_settings
--
-- Why:
--   The AR aging report can already show what each doctor owes and how overdue
--   it is (get_doctor_receivables_breakdown), but there is nothing to compare
--   that balance against -- entity_billing_settings holds payment terms only
--   (billing_mode, billing_day, per_order_due_days), no limit.
--
-- SCOPE -- read this before wiring anything to these columns:
--   These are DISPLAY-ONLY at this stage. They must NOT block order creation
--   or any workflow automatically. Refusing work to a doctor is a commercial
--   decision the owner makes, not something a threshold should trigger on its
--   own. Enforcement, if ever wanted, is a separate decision.
--
--   NULL means "no limit" for both, which is the default for every existing
--   row -- so this migration changes no behaviour on its own.

BEGIN;

ALTER TABLE public.entity_billing_settings
    ADD COLUMN IF NOT EXISTS credit_limit         NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS stop_work_threshold  NUMERIC(12,2);

COMMENT ON COLUMN public.entity_billing_settings.credit_limit
    IS 'Credit ceiling in EGP. NULL = no limit. Display-only: never auto-blocks work.';
COMMENT ON COLUMN public.entity_billing_settings.stop_work_threshold
    IS 'Balance at which the owner should consider pausing new orders. NULL = none. Display-only.';

COMMIT;
