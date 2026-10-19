-- Remove the retired on_hold value after the production audit confirmed that
-- no orders still use it. This migration is intentionally non-destructive: it
-- aborts instead of rewriting an order when an unexpected row is present.

DO $$
DECLARE
    v_on_hold_count bigint;
BEGIN
    SELECT count(*)
    INTO v_on_hold_count
    FROM public.orders
    WHERE issue_state = 'on_hold';

    IF v_on_hold_count <> 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = format(
                'Cannot remove issue_state on_hold: %s order(s) still use it; review them before deployment',
                v_on_hold_count
            );
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trigger_prevent_new_on_hold_issue_state ON public.orders;
DROP FUNCTION IF EXISTS public.prevent_new_on_hold_issue_state();
DROP TRIGGER IF EXISTS aa_guard_retired_on_hold_insert_v2 ON public.orders;
DROP FUNCTION IF EXISTS public.guard_retired_on_hold_insert_v2();

ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS orders_issue_state_check;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_issue_state_check CHECK (issue_state IN (
        'none',
        'returned',
        'cancelled',
        'redo',
        'doctor_rejected',
        'lab_rejected'
    ));

COMMENT ON CONSTRAINT orders_issue_state_check ON public.orders IS
'Allowed issue states. on_hold was fully removed after verification that no rows used it.';
