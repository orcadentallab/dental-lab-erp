-- Give Doctor Portal review its own V2 axis. This migration is schema-only:
-- it performs no order, obligation, allocation, or accounting data updates.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.orders WHERE status = 'Pending Review'
    ) THEN
        RAISE EXCEPTION 'Pending Review rows require reviewed intake_state backfill before this schema migration';
    END IF;
END;
$$;

ALTER TABLE public.orders
ADD COLUMN intake_state TEXT NOT NULL DEFAULT 'accepted';

ALTER TABLE public.orders
ADD CONSTRAINT orders_intake_state_check
CHECK (intake_state IN ('pending_review', 'accepted'));

ALTER TABLE public.orders
ADD CONSTRAINT orders_pending_intake_workflow_check
CHECK (
    intake_state = 'accepted'
    OR (
        production_status = 'not_started'
        AND issue_state = 'none'
    )
);

CREATE OR REPLACE FUNCTION public.derive_order_display_status_v2(
    p_production_status TEXT,
    p_issue_state TEXT,
    p_intake_state TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT CASE
        WHEN p_intake_state = 'pending_review'
             AND p_production_status = 'not_started'
             AND p_issue_state = 'none'
            THEN 'Pending Review'
        WHEN p_intake_state <> 'accepted' THEN NULL
        ELSE public.derive_order_display_status_v2(
            p_production_status,
            p_issue_state
        )
    END;
$$;

COMMENT ON FUNCTION public.derive_order_display_status_v2(TEXT, TEXT, TEXT) IS
    'Presentation-only V2 status derivation including explicit Doctor Portal intake state.';

REVOKE ALL ON FUNCTION public.derive_order_display_status_v2(TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.initialize_order_intake_state_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Temporary INSERT compatibility for the Doctor Portal RPCs. New internal
    -- orders keep the column default. No UPDATE path reads legacy status.
    IF NEW.status = 'Pending Review' THEN
        NEW.intake_state := 'pending_review';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_order_intake_state_v2 ON public.orders;
CREATE TRIGGER initialize_order_intake_state_v2
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.initialize_order_intake_state_v2();

CREATE OR REPLACE FUNCTION public.mirror_order_status_from_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_status_legacy_mirror') THEN
        RETURN NEW;
    END IF;

    v_status := CASE
        WHEN NEW.issue_state = 'redo' THEN 'Doctor Rejected'
        ELSE public.derive_order_display_status_v2(
            NEW.production_status,
            NEW.issue_state,
            NEW.intake_state
        )
    END;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Cannot mirror unknown workflow state: production_status=%, issue_state=%, intake_state=%',
            NEW.production_status, NEW.issue_state, NEW.intake_state;
    END IF;

    NEW.status := v_status;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzzz_mirror_order_status_from_v2 ON public.orders;
CREATE TRIGGER zzzz_mirror_order_status_from_v2
BEFORE UPDATE OF production_status, issue_state, intake_state ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.mirror_order_status_from_v2();

COMMIT;
