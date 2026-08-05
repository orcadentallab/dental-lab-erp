-- Retire on_hold for new workflow transitions without rewriting historical
-- orders. The value remains in the CHECK constraint because old rows must keep
-- their timeline and financial semantics and must still be able to leave it.

CREATE OR REPLACE FUNCTION public.prevent_new_on_hold_issue_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.issue_state IS DISTINCT FROM 'on_hold' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.issue_state = 'on_hold' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'issue_state on_hold is retired and cannot be assigned to new orders or transitions';
END;
$$;
DROP TRIGGER IF EXISTS trigger_prevent_new_on_hold_issue_state ON public.orders;
CREATE TRIGGER trigger_prevent_new_on_hold_issue_state
BEFORE INSERT OR UPDATE OF issue_state ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.prevent_new_on_hold_issue_state();
COMMENT ON FUNCTION public.prevent_new_on_hold_issue_state() IS
'Blocks new on_hold assignments while preserving and allowing exit from historical on_hold rows.';
REVOKE ALL ON FUNCTION public.prevent_new_on_hold_issue_state() FROM PUBLIC;
