-- Close the stale archived orders that were left in a non-terminal status.
--
-- Context (owner decision, 2026-09-03): these orders are finished, no work
-- will be done on them, and no money may be attached to them. They are to
-- become Cancelled and stay archived.
--
-- How they got here: each one had already reached a terminal state and was
-- manually pulled BACK into production before the issue_state (V2) workflow
-- existed -- back then a doctor return was expressed by flipping the legacy
-- status by hand. They were then archived, which hid them from the orders
-- page and the dashboard, so nobody saw them again. Because the doctor
-- statement scope keys off the legacy status, a non-terminal order is
-- invisible to accounting entirely -- no revenue, no receivable, no record.
--
-- TWO of the five are deliberately NOT included, because the database
-- refuses to call them cancelled and it is right to:
--   1034-260427-510 -- actual_delivery_date 2026-05-09 and first_delivered_at
--       2026-05-02; trigger_guard_lab_rejected_cancelled_transition raises
--       "A delivered order cannot become Lab Rejected or Cancelled".
--   2018-2304-1351  -- first_delivered_at 2026-05-09; the check constraint
--       orders_issue_timing_v2_check forbids issue_state 'cancelled' on any
--       order that was ever delivered.
-- Both really did reach the doctor, so cancelling them would erase a delivery
-- that happened. They need their own decision, not a bypass of the guard.
--
-- Triggers do the rest on their own: trigger_log_order_changes writes the
-- audit row, zz_before_normalize_zero_financial_fields zeroes the financial
-- fields, and trigger_sync_order_financial_obligations settles obligations.

BEGIN;

UPDATE public.orders
   SET status = 'Cancelled'
 WHERE case_id IN (
        '1019-260423-577',
        '1031-260425-503',
        '1019-260512-665'
       )
   AND status <> 'Cancelled'
   AND COALESCE(is_deleted, false) = false;

-- Must be exactly 3; anything else means the data moved since this was written.
DO $$
DECLARE v_remaining INT;
BEGIN
    SELECT COUNT(*) INTO v_remaining
    FROM public.orders
    WHERE case_id IN ('1019-260423-577','1031-260425-503','1019-260512-665')
      AND status <> 'Cancelled';

    IF v_remaining <> 0 THEN
        RAISE EXCEPTION 'expected all 3 orders cancelled, % still are not', v_remaining;
    END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------
-- Part 2: the two orders that really were delivered.
--
-- Owner decision, 2026-09-03: both are to be recorded as delivered to the
-- doctor with ZERO money attached to any party -- no doctor receivable, no
-- supplier payable, no designer fee. The work left the lab, so cancelling
-- them would erase a delivery that happened (and both are blocked from
-- cancellation by trigger_guard_lab_rejected_cancelled_transition /
-- orders_issue_timing_v2_check for exactly that reason). They stay archived.
--
-- Zeroing total_price is what keeps the money off: 
-- assert_delivered_doctor_obligation_integrity exempts any delivered order
-- whose total_price <= 0 from the "must have a matching doctor receivable"
-- rule, so no receivable is created or demanded. Cost is zeroed for the same
-- reason on the supplier/designer side.
--
-- actual_delivery_date is set from first_delivered_at, so both land in the
-- month they actually reached the doctor (May 2026) and not in a later
-- period.

BEGIN;

UPDATE public.orders
   SET status               = 'Delivered',
       production_status    = 'final_delivered',
       actual_delivery_date = COALESCE(actual_delivery_date, first_delivered_at::date),
       total_price          = 0,
       cost                 = 0
 WHERE case_id IN ('1034-260427-510', '2018-2304-1351')
   AND COALESCE(is_deleted, false) = false;

DO $$
DECLARE v_bad INT;
BEGIN
    SELECT COUNT(*) INTO v_bad
    FROM public.orders
    WHERE case_id IN ('1034-260427-510','2018-2304-1351')
      AND (status <> 'Delivered'
           OR production_status <> 'final_delivered'
           OR COALESCE(total_price, 0) <> 0
           OR COALESCE(cost, 0) <> 0
           OR actual_delivery_date IS NULL);

    IF v_bad <> 0 THEN
        RAISE EXCEPTION '% order(s) did not reach the intended delivered/zero-money state', v_bad;
    END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------
-- Part 3 (2026-09-05): outcomes of the zero-priced-delivery review.
--
-- The owner reviewed all 22 zero-priced delivered cases and annotated each one.
-- Nineteen were confirmed as deliberate 100% discounts (repeat prints agreed
-- free, try-ins for cases that never completed, redos absorbed by the lab or
-- charged back to the external lab, a marketing discount). Two needed data
-- corrections; both are applied below.
--
-- 2018-2304-1351 -- A DELIVERY THAT NEVER HAPPENED.
--   This is a duplicate of 2018-260426-502: same doctor, same patient, same
--   tooth (LL6), same delivery day, and that one was billed 950. Part 2 above
--   had recorded this duplicate as delivered-at-zero; the owner confirmed the
--   delivery record itself is the error, so it is undone and the order is
--   cancelled.
--
--   Two guards stand in the way, both correctly: guard_order_issue_transition_v2
--   only lets first_delivered_at move under the 'record_final_delivery'
--   operation, and both trigger_guard_lab_rejected_cancelled_transition and
--   orders_issue_timing_v2_check refuse to cancel an order that carries any
--   delivery mark. Hence two statements: clear the delivery marks first, then
--   cancel. Authorised explicitly by the owner on 2026-09-05.
--
-- BEGIN;
--   SET LOCAL app.order_issue_operation = 'record_final_delivery';
--   UPDATE public.orders
--      SET first_delivered_at = NULL, actual_delivery_date = NULL,
--          production_status = 'not_started', status = 'New Case'
--    WHERE case_id = '2018-2304-1351' AND COALESCE(is_deleted,false) = false;
--
--   SET LOCAL app.order_issue_operation = 'cancel_order';
--   UPDATE public.orders SET status = 'Cancelled'
--    WHERE case_id = '2018-2304-1351' AND COALESCE(is_deleted,false) = false;
-- COMMIT;
--
-- 1503-260812-514 -- WRONG UNIT COUNT.
--   Entered as one unit priced 2,800 with the tooth number "28". It is really a
--   full 28-unit job, both arches 7 to 7, at 100 per unit. The money is
--   unchanged (28 x 100 = 2,800 = the recorded discount); only the unit count
--   was wrong, and a 1 there understates work volume by 27 units.
--
-- BEGIN;
--   UPDATE public.order_items
--      SET teeth_numbers = '["17","16","15","14","13","12","11","21","22","23","24","25","26","27",
--                            "37","36","35","34","33","32","31","41","42","43","44","45","46","47"]'::jsonb,
--          count = 28, price = 100
--    WHERE order_id = (SELECT id FROM public.orders WHERE case_id = '1503-260812-514')
--      AND price = 2800;
-- COMMIT;
--
-- 1034-260427-510 -- LEFT TO THE OWNER.
--   To be recorded as a doctor rejection settled at zero (no sale, no cost).
--   That path needs no guard bypass: the order already carries
--   first_delivered_at, which is exactly what guard_order_issue_transition_v2
--   and orders_issue_timing_v2_check require for 'doctor_rejected'. The owner
--   is doing it from the app.
--
-- Both statements above were applied to production on 2026-09-05 and verified.
