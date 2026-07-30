-- Re-run canonical obligation synchronization for all existing orders after
-- installing the approved financial invariants.
--
-- Assigning a tracked column to itself deliberately fires the synchronization
-- triggers without changing the commercial order data. Each order is processed
-- atomically: stale obligations are voided, replacements are created, and
-- active allocations are transferred by sync_single_order_obligation.

DO $resync$
DECLARE
    v_before_active_count BIGINT;
    v_after_active_count BIGINT;
    v_void_obligation RECORD;
BEGIN
    -- Repair legacy allocations that were left active on already-void
    -- obligations before this migration. The canonical helper reallocates
    -- FIFO to another eligible obligation or creates account credit.
    FOR v_void_obligation IN
        SELECT DISTINCT obligation.id
        FROM public.financial_obligations obligation
        JOIN public.payment_allocations allocation
          ON allocation.obligation_id = obligation.id
        WHERE obligation.status = 'void'
          AND allocation.status = 'active'
    LOOP
        PERFORM public.reallocate_voided_obligation_allocations(
            v_void_obligation.id,
            NULL,
            NULL
        );
    END LOOP;

    SELECT count(*)
    INTO v_before_active_count
    FROM public.financial_obligations
    WHERE status NOT IN ('void', 'written_off');

    UPDATE public.orders
    SET status = status,
        cost = cost
    WHERE COALESCE(is_deleted, FALSE) = FALSE;

    SELECT count(*)
    INTO v_after_active_count
    FROM public.financial_obligations
    WHERE status NOT IN ('void', 'written_off');

    RAISE NOTICE
        'Order obligation resync complete: active obligations before=%, after=%',
        v_before_active_count,
        v_after_active_count;

    IF EXISTS (
        SELECT 1
        FROM public.payment_allocations allocation
        JOIN public.financial_obligations obligation
          ON obligation.id = allocation.obligation_id
        WHERE allocation.status = 'active'
          AND obligation.status = 'void'
    ) THEN
        RAISE EXCEPTION
            'Resync verification failed: active allocation points to a void obligation';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.orders order_row
        JOIN public.financial_obligations obligation
          ON obligation.order_id = order_row.id
        WHERE COALESCE(order_row.is_deleted, FALSE) = FALSE
          AND (
              order_row.status IN ('Lab Rejected', 'Cancelled')
              OR COALESCE(order_row.issue_state, 'none')
                    IN ('lab_rejected', 'cancelled')
          )
          AND obligation.source = 'order'
          AND obligation.status NOT IN ('void', 'written_off')
    ) THEN
        RAISE EXCEPTION
            'Resync verification failed: Lab Rejected/Cancelled order still has an active order obligation';
    END IF;
END;
$resync$;
