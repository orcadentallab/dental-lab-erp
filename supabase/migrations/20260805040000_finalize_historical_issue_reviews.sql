-- Existing rejected and redo cases are historical, confirmed records. Keep
-- their stored numbers untouched and mark only their review state as resolved,
-- so the new "pending financial review" state applies exclusively to cases
-- created after this rollout.
UPDATE public.orders
SET rejection_financial_review_status = 'resolved'
WHERE COALESCE(issue_state, 'none') IN ('redo', 'doctor_rejected', 'lab_rejected')
  AND rejection_financial_review_status IS NULL;
