-- The accountant needs to record the current registration snapshot for a
-- doctor-rejected/redo order even while the liability decision (doctor
-- charge / supplier cost / designer cost) is still pending. This is no
-- longer treated as a block: it is intentionally an interim registration.
--
-- Once the pending decision is resolved (or any other business field on the
-- order changes), zzz_capture_accounting_review_change_v2 already reopens
-- the order automatically (is_registered = FALSE, needs_accounting_
-- reregistration = TRUE), which brings it back to the pending queue for the
-- accountant to review and re-register. That mechanism is untouched here.
--
-- This migration only removes the hard guard that previously raised an
-- exception and prevented is_registered from being set to TRUE before those
-- decisions were resolved.

BEGIN;

DROP TRIGGER IF EXISTS zzy_guard_accounting_registration_v2 ON public.orders;
DROP FUNCTION IF EXISTS public.guard_accounting_registration_v2();

COMMIT;
