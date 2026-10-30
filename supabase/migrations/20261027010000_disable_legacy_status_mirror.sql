-- Phase 5: stop writing the legacy orders.status projection.
-- The legacy column remains present and read-only for the observation window.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
    v_ready BOOLEAN;
BEGIN
    SELECT ready_for_mirror_off
    INTO v_ready
    FROM public.workflow_v2_status_parity_gate;

    IF v_ready IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Phase 5 blocked: workflow V2 parity gate is not ready';
    END IF;

    IF (SELECT value FROM public.app_settings
        WHERE key = 'workflow_status_legacy_mirror') IS DISTINCT FROM 'on'
    THEN
        RAISE EXCEPTION 'Phase 5 expects workflow_status_legacy_mirror=on before cutover';
    END IF;
END;
$$;

ALTER TABLE public.orders
ALTER COLUMN status DROP NOT NULL;

UPDATE public.app_settings
SET value = 'off'
WHERE key = 'workflow_status_legacy_mirror';

COMMENT ON COLUMN public.orders.status IS
    'Deprecated compatibility projection. Read-only observation column after workflow V2 mirror-off.';

COMMIT;
