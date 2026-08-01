-- Soft-delete financially active orders through one explicit transaction.
-- The AFTER UPDATE financial sync remains the sole owner of voiding obligations,
-- reversing allocations, and preserving excess payments as account credits.

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

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_order_atomic(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_updated_count INTEGER;
BEGIN
    -- This transaction-local signal is only set inside the approved RPC. The
    -- guard still rejects direct table updates, while the AFTER UPDATE trigger
    -- performs the complete financial cleanup before this RPC can commit.
    PERFORM set_config('app.atomic_order_soft_delete', 'true', TRUE);

    UPDATE public.orders
    SET is_deleted = TRUE,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_order_id
      AND COALESCE(is_deleted, FALSE) = FALSE
    RETURNING * INTO v_order;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    -- Do not let the bypass signal outlive the single guarded statement when
    -- this function is called from a larger database transaction.
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

REVOKE ALL ON FUNCTION public.soft_delete_order_atomic(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_order_atomic(UUID)
TO authenticated;

REVOKE ALL ON FUNCTION public.guard_financially_active_order_delete()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.soft_delete_order_atomic(UUID) IS
    'Soft-deletes one order and lets the order financial trigger atomically void obligations, reverse allocations, and preserve payments as credits.';
