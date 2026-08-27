-- Prevent deleting delivered orders or orders with active financial obligations.
--
-- The block lives in two places on purpose. soft_delete_order_atomic is the
-- approved path and rejects the order before it touches anything, but it is not
-- the only writer: updateOrder() assigns orders.is_deleted directly, so a plain
-- UPDATE reaches the table without the RPC ever running. The trigger guard below
-- is what actually closes that path.

CREATE OR REPLACE FUNCTION public.soft_delete_order_atomic(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_updated_count INTEGER;
    v_production_status TEXT;
BEGIN
    -- Check existence and financial state before enabling the guard bypass.
    SELECT production_status INTO v_production_status
    FROM public.orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
    END IF;

    -- Block deletion if order was already delivered or has active financial obligations
    IF v_production_status = 'final_delivered' OR EXISTS (
        SELECT 1
        FROM public.financial_obligations
        WHERE order_id = p_order_id
          AND status NOT IN ('void', 'written_off')
    ) THEN
        RAISE EXCEPTION 'لا يمكن حذف أوردر مُسلَّم أو له استحقاق مالي نشط';
    END IF;

    -- This transaction-local signal is only set inside the approved RPC.
    PERFORM set_config('app.atomic_order_soft_delete', 'true', TRUE);

    UPDATE public.orders
    SET is_deleted = TRUE,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_order_id
      AND COALESCE(is_deleted, FALSE) = FALSE
    RETURNING * INTO v_order;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    -- Reset the transaction-local signal
    PERFORM set_config('app.atomic_order_soft_delete', 'false', TRUE);

    IF v_updated_count = 0 THEN
        IF EXISTS (
            SELECT 1
            FROM public.orders
            WHERE id = p_order_id
              AND COALESCE(is_deleted, FALSE) = TRUE
        ) THEN
            SELECT * INTO v_order
            FROM public.orders
            WHERE id = p_order_id;
        ELSE
            RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
        END IF;
    END IF;

    RETURN to_jsonb(v_order);
END;
$$;

-- Trigger-level backstop for every writer that does not go through the RPC.
--
-- The obligation check keeps its original message and its bypass, so the
-- approved RPC can still clean up residual void obligations. The delivered
-- check is deliberately NOT bypassable: a delivered order is never deletable,
-- no matter which path asks. The RPC rejects delivered orders before it reaches
-- the UPDATE, so this costs it nothing.
CREATE OR REPLACE FUNCTION public.guard_financially_active_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE(OLD.is_deleted, FALSE) = FALSE
       AND COALESCE(NEW.is_deleted, FALSE) = TRUE
       AND EXISTS (
           SELECT 1
           FROM public.financial_obligations obligation
           WHERE obligation.order_id = OLD.id
             AND obligation.status NOT IN ('void', 'written_off')
       )
       AND COALESCE(
           current_setting('app.atomic_order_soft_delete', TRUE),
           'false'
       ) <> 'true' THEN
        RAISE EXCEPTION
            'Financially active orders cannot be deleted; use soft_delete_order_atomic';
    END IF;

    IF COALESCE(OLD.is_deleted, FALSE) = FALSE
       AND COALESCE(NEW.is_deleted, FALSE) = TRUE
       AND NEW.production_status = 'final_delivered' THEN
        RAISE EXCEPTION 'لا يمكن حذف أوردر مُسلَّم أو له استحقاق مالي نشط';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_order_atomic(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_order_atomic(UUID)
TO authenticated;
REVOKE ALL ON FUNCTION public.guard_financially_active_order_delete()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.soft_delete_order_atomic(UUID) IS
    'Soft-deletes one order if not final_delivered and has no active obligations; lets trigger atomically cleanup residual void obligations.';
COMMENT ON FUNCTION public.guard_financially_active_order_delete() IS
    'Blocks deleting financially active orders (bypassable by the approved RPC) and delivered orders (never bypassable).';
