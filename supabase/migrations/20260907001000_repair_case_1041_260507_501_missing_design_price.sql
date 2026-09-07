-- Repair one order whose cost was saved without its design price.
--
-- Case 1041-260507-501 (delivered 2026-05-07, AB Lab, designer Hosny who is
-- paid per piece) is stored as:
--
--     cost = 100,  manual_cost = 100,  design_price = 60
--
-- Every other split case with a per-piece designer -- 30 of them -- stores
-- cost = milling + design_price.  This one stores the milling price alone, so
-- the 60 owed to the designer never reached the case cost.  Re-opening it in
-- the order form shows the correct figure: 100 milling + 60 design = 160.
--
-- WHAT MOVES
-- ----------
--     cost   100 -> 160
--
-- and, consistently with 20260907000000, the components become
--     lab_cost = 100, designer_cost = 60.
--
-- WHAT DOES NOT MOVE
-- ------------------
--  * The external lab payable.  sync_order_financial_obligations reads
--    COALESCE(manual_cost, cost - design_price), and manual_cost is set, so
--    AB Lab stays at 100.
--  * The designer payable.  It is built from design_price, still 60.
--  * accounting_snapshot.  build_order_accounting_snapshot reads
--    COALESCE(manual_cost, cost), and manual_cost is set, so it stays 100.
--
-- The one number that changes is the case cost the P&L reads
-- (getLabCostAmount -> order.cost), which is the whole point: this case really
-- cost 160, and it has been reported as 100 since May.
--
-- WHY TRIGGERS ARE SUPPRESSED
-- ---------------------------
-- This repairs a write the system got wrong; it is not a business decision
-- taken today.  Letting the 25 triggers on public.orders fire would kick a
-- delivered-and-registered May order back into the accounting queue, stamp
-- updated_at, and churn obligations that -- as set out above -- do not actually
-- change.  Same reasoning and same mechanism as 20260812003000 and
-- 20260826001000.  If the correction should instead be reviewed by the
-- accountant, clear is_registered on this order by hand afterwards.

SET LOCAL session_replication_role = replica;

UPDATE public.orders
   SET cost          = 160.00,
       lab_cost      = 100.00,
       designer_cost = 60.00
 WHERE case_id      = '1041-260507-501'
   AND cost         = 100.00
   AND manual_cost  = 100.00
   AND design_price = 60.00;

SET LOCAL session_replication_role = origin;

DO $do$
DECLARE
    v_row public.orders%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.orders WHERE case_id = '1041-260507-501';

    IF NOT FOUND THEN
        RAISE NOTICE 'case 1041-260507-501 not present; nothing to repair';
        RETURN;
    END IF;

    IF v_row.cost <> 160.00 THEN
        RAISE EXCEPTION
            'case 1041-260507-501 was not in the expected shape (cost is now %); repair skipped, investigate by hand',
            v_row.cost;
    END IF;

    IF v_row.cost <> v_row.lab_cost + v_row.designer_cost THEN
        RAISE EXCEPTION
            'case 1041-260507-501 breaks cost = lab_cost + designer_cost after repair';
    END IF;

    RAISE NOTICE 'case 1041-260507-501 repaired: cost 100 -> 160 (100 lab + 60 designer)';
END;
$do$;
