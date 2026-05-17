-- Phase 3C preparation: support shadow historical external lab issue settlements.
-- This widens the trigger_type vocabulary only. It does not create or update data.

DO $$
DECLARE
    existing_constraint_name TEXT;
BEGIN
    SELECT c.conname
    INTO existing_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'financial_obligations'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%trigger_type%'
    LIMIT 1;

    IF existing_constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.financial_obligations DROP CONSTRAINT %I',
            existing_constraint_name
        );
    END IF;
END $$;

ALTER TABLE public.financial_obligations
ADD CONSTRAINT financial_obligations_trigger_type_check
CHECK (trigger_type IN (
    'doctor_delivered',
    'external_lab_ready',
    'external_lab_issue_settlement',
    'designer_approved',
    'manual_adjustment'
));
