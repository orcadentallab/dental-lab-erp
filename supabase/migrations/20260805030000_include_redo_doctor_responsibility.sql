-- A remake may retain an approved amount owed by the doctor on its original
-- case.  The original is marked issue_state = 'redo', so include it in the
-- same receivable synchronization branch used for approved rejections.
DO $$
DECLARE
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    SELECT pg_get_functiondef('public.sync_order_financial_obligations()'::regprocedure)
    INTO v_definition;

    v_patched := replace(
        v_definition,
        'v_issue_state IN (''doctor_rejected'', ''lab_rejected'')',
        'v_issue_state IN (''doctor_rejected'', ''lab_rejected'', ''redo'')'
    );

    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'sync_order_financial_obligations did not contain the expected rejection branch';
    END IF;

    EXECUTE v_patched;
END;
$$;
-- Re-fire the financial synchronization for existing redo records that already
-- have an approved doctor amount (including the cases created before this fix).
UPDATE public.orders
SET rejected_doctor_amount = rejected_doctor_amount
WHERE COALESCE(issue_state, 'none') = 'redo'
  AND rejection_doctor_decision IS NOT NULL;
