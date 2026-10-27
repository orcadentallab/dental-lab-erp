-- Central presentation-only derivation for the V2 workflow axes.
-- This migration does not change orders, financial data, or the legacy mirror.

BEGIN;

CREATE OR REPLACE FUNCTION public.derive_order_display_status_v2(
    p_production_status TEXT,
    p_issue_state TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT CASE
        WHEN p_production_status IS NULL OR p_issue_state IS NULL THEN NULL
        WHEN p_issue_state = 'returned' THEN 'Returned for Adjustments'
        WHEN p_issue_state = 'doctor_rejected' THEN 'Doctor Rejected'
        WHEN p_issue_state = 'lab_rejected' THEN 'Lab Rejected'
        WHEN p_issue_state = 'cancelled' THEN 'Cancelled'
        WHEN p_issue_state = 'redo' THEN 'Redo'
        WHEN p_issue_state <> 'none' THEN NULL
        ELSE CASE p_production_status
            WHEN 'not_started' THEN 'New Case'
            WHEN 'designing' THEN 'Under Design'
            WHEN 'in_production' THEN 'Under Production'
            WHEN 'try_in_ready' THEN 'Try In'
            WHEN 'waiting_doctor' THEN 'Waiting Dr Approval'
            WHEN 'finalization' THEN 'Try In Approved'
            WHEN 'final_ready' THEN 'Ready'
            WHEN 'final_delivered' THEN 'Delivered'
            ELSE NULL
        END
    END;
$$;

COMMENT ON FUNCTION public.derive_order_display_status_v2(TEXT, TEXT) IS
    'Presentation-only V2 status derivation. Issue state overrides production stage; redo remains distinct. Unknown axes return NULL.';

REVOKE ALL ON FUNCTION public.derive_order_display_status_v2(TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

COMMIT;
