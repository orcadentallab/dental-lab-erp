-- Emergency rollback for phase 5. Re-enable the mirror, then repair only rows
-- created while it was off. V2 axes remain authoritative.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

UPDATE public.app_settings
SET value = 'on'
WHERE key = 'workflow_status_legacy_mirror';

UPDATE public.orders
SET production_status = production_status
WHERE status IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.orders WHERE status IS NULL) THEN
        RAISE EXCEPTION 'Mirror rollback could not repair every legacy status';
    END IF;
END;
$$;

ALTER TABLE public.orders
ALTER COLUMN status SET NOT NULL;

COMMIT;
