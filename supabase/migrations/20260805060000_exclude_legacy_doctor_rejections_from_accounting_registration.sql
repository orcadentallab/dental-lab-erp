-- Historical Doctor Rejected cases were zero-cost to the doctor. A legacy
-- client fallback treated a missing amount as the order total. Correct those
-- existing cases, then keep them out of accounting registration: they were
-- already settled and have no doctor receivable. Redo chains are excluded.
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS exclude_from_accounting_registration BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.orders
SET rejection_doctor_decision = 'zero',
    rejected_doctor_amount = 0,
    rejection_financial_review_status = 'resolved',
    exclude_from_accounting_registration = TRUE
WHERE status IN ('Doctor Rejected', 'Rejected')
  AND COALESCE(issue_state, 'doctor_rejected') <> 'redo';

-- The preceding correction may have reopened a historical row through the
-- standard accounting trigger. Re-close it with its corrected zero snapshot.
UPDATE public.orders
SET is_registered = TRUE,
    needs_accounting_reregistration = FALSE
WHERE status IN ('Doctor Rejected', 'Rejected')
  AND COALESCE(issue_state, 'doctor_rejected') <> 'redo'
  AND exclude_from_accounting_registration = TRUE;
