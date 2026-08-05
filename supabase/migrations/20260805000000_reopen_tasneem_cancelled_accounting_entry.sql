-- Tasneem Adel / 1503-260507-511 was part of the reviewed legacy batch that
-- was restored to is_registered=true on 2026-07-31. Accounting subsequently
-- treated its stored sale price as a delivered entry even though it is
-- Cancelled. Reopen this exact row so the accountant can remove the entry; the
-- registration UI presents Cancelled financial impact as zero.

UPDATE public.orders
SET is_registered = FALSE,
    needs_accounting_reregistration = TRUE
WHERE id = '4f0f9156-ac82-4c3b-a785-2e501dd2f71d'::uuid
  AND case_id = '1503-260507-511'
  AND status = 'Cancelled'
  AND is_registered = TRUE
  AND COALESCE(is_deleted, FALSE) = FALSE;
