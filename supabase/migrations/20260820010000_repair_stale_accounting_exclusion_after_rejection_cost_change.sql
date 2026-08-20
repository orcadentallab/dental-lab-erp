-- The 2026-08-05 migration (20260805060000) assumed every non-redo
-- Doctor Rejected / Rejected order was zero-cost and permanently excluded
-- it from accounting registration (exclude_from_accounting_registration =
-- TRUE). That assumption does not survive a later real cost correction:
-- when someone subsequently records a genuine rejected_lab_cost /
-- rejected_designer_cost / rejected_doctor_amount, the existing
-- capture_accounting_review_change_v2 trigger correctly reopens the order
-- (needs_accounting_reregistration = TRUE, is_registered = FALSE) but has
-- no logic to also clear the stale exclusion flag — so the order becomes
-- invisible in the Case Registration screen while still counting in
-- supplier statements, producing a mismatch between the two.
--
-- Verified manually before this migration: every order matching this
-- WHERE clause (4 rows in production as of 2026-08-20) has a genuine
-- non-zero rejected_lab_cost/rejected_designer_cost, confirming each is a
-- real post-exclusion business change and not a false positive.

BEGIN;

UPDATE public.orders
SET exclude_from_accounting_registration = FALSE
WHERE exclude_from_accounting_registration = TRUE
  AND needs_accounting_reregistration = TRUE;

-- Prevent recurrence: whenever this trigger reopens an order for
-- accounting review, also clear any stale exclusion so the order is not
-- silently hidden again.
CREATE OR REPLACE FUNCTION public.capture_accounting_review_change_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cycle UUID;
    v_sequence INTEGER;
    v_changed_by UUID;
    v_before JSONB;
    v_after JSONB;
    v_changed_fields JSONB;
    v_ignored TEXT[] := ARRAY[
        'updated_at', 'comments', 'accounting_review_cycle_id',
        'needs_accounting_reregistration', 'is_registered',
        'accounting_snapshot', 'accounting_previous_snapshot',
        'accounting_registered_at', 'accounting_reviewed_by',
        'accounting_last_review_type',
        'first_delivered_at', 'first_delivered_source',
        'design_submitted_at', 'legacy_delivery_confirmed'
    ];
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_accounting_audit_v2') THEN
        RETURN NEW;
    END IF;

    IF NEW.is_registered = TRUE AND OLD.is_registered = FALSE THEN
        UPDATE public.accounting_review_changes
        SET reviewed_at = timezone('utc', now()),
            reviewed_by = public.get_my_user_id()
        WHERE review_cycle_id = OLD.accounting_review_cycle_id
          AND reviewed_at IS NULL;
        NEW.accounting_review_cycle_id := NULL;
        RETURN NEW;
    END IF;

    IF OLD.accounting_snapshot IS NULL THEN
        RETURN NEW;
    END IF;

    v_before := to_jsonb(OLD) - v_ignored;
    v_after := to_jsonb(NEW) - v_ignored;

    SELECT COALESCE(
        jsonb_object_agg(
            key,
            jsonb_build_object('old', v_before -> key, 'new', v_after -> key)
        ),
        '{}'::jsonb
    )
    INTO v_changed_fields
    FROM jsonb_object_keys(v_before || v_after) AS key
    WHERE v_before -> key IS DISTINCT FROM v_after -> key;

    IF v_changed_fields = '{}'::jsonb THEN
        RETURN NEW;
    END IF;

    v_cycle := COALESCE(OLD.accounting_review_cycle_id, gen_random_uuid());
    NEW.accounting_review_cycle_id := v_cycle;
    NEW.needs_accounting_reregistration := TRUE;
    NEW.is_registered := FALSE;
    NEW.exclude_from_accounting_registration := FALSE;

    SELECT id INTO v_changed_by
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    SELECT COALESCE(MAX(sequence_no), 0) + 1
    INTO v_sequence
    FROM public.accounting_review_changes
    WHERE review_cycle_id = v_cycle;

    INSERT INTO public.accounting_review_changes (
        order_id, review_cycle_id, sequence_no, changed_by, event_type,
        before_snapshot, after_snapshot, changed_fields
    ) VALUES (
        NEW.id, v_cycle, v_sequence, v_changed_by, 'order_business_change',
        v_before, v_after, v_changed_fields
    );

    RETURN NEW;
END;
$$;

COMMIT;
