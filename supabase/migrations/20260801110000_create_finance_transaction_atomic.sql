-- Create a finance transaction and its optional cashbox transfer fee in one
-- database transaction. No current financial rows are changed by this migration.

CREATE OR REPLACE FUNCTION public.create_finance_transaction_atomic(
    p_type TEXT,
    p_amount NUMERIC,
    p_category TEXT,
    p_description TEXT,
    p_date DATE,
    p_effective_date DATE DEFAULT NULL,
    p_entity_type TEXT DEFAULT NULL,
    p_entity_id UUID DEFAULT NULL,
    p_cashbox_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT 'approved',
    p_transfer_fee_amount NUMERIC DEFAULT 0,
    p_transfer_fee_effective_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_transaction public.transactions%ROWTYPE;
BEGIN
    IF p_type NOT IN ('income', 'expense') THEN
        RAISE EXCEPTION 'Invalid transaction type: %', p_type;
    END IF;
    IF COALESCE(p_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Transaction amount must be greater than zero';
    END IF;
    IF NULLIF(btrim(p_category), '') IS NULL THEN
        RAISE EXCEPTION 'Transaction category is required';
    END IF;
    IF NULLIF(btrim(p_description), '') IS NULL THEN
        RAISE EXCEPTION 'Transaction description is required';
    END IF;
    IF p_date IS NULL THEN
        RAISE EXCEPTION 'Transaction date is required';
    END IF;
    IF p_status NOT IN ('pending', 'approved', 'rejected', 'settled') THEN
        RAISE EXCEPTION 'Invalid transaction status: %', p_status;
    END IF;
    IF COALESCE(p_transfer_fee_amount, 0) < 0 THEN
        RAISE EXCEPTION 'Transfer fee amount cannot be negative';
    END IF;
    IF COALESCE(p_transfer_fee_amount, 0) > 0 AND p_cashbox_id IS NULL THEN
        RAISE EXCEPTION 'A cashbox is required when a transfer fee is recorded';
    END IF;

    INSERT INTO public.transactions (
        type, amount, category, description, date, effective_date,
        entity_type, entity_id, cashbox_id, status, is_approved,
        is_registered, is_system_generated_fee
    ) VALUES (
        p_type, p_amount, p_category, left(btrim(p_description), 500), p_date,
        p_effective_date, p_entity_type, p_entity_id, p_cashbox_id, p_status,
        p_status IN ('approved', 'settled'), FALSE, FALSE
    )
    RETURNING * INTO v_transaction;

    IF COALESCE(p_transfer_fee_amount, 0) > 0 THEN
        INSERT INTO public.transactions (
            type, amount, category, description, date, effective_date,
            entity_type, cashbox_id, linked_transaction_id, status,
            is_approved, is_registered, is_system_generated_fee
        ) VALUES (
            'expense', p_transfer_fee_amount, 'عمولات ورسوم بنكية',
            left('عمولة سحب/تحويل - ' || btrim(p_description), 500), p_date,
            COALESCE(p_transfer_fee_effective_date, p_effective_date),
            'general', p_cashbox_id, v_transaction.id, 'approved',
            TRUE, TRUE, TRUE
        );
    END IF;

    RETURN to_jsonb(v_transaction);
END;
$$;
REVOKE ALL ON FUNCTION public.create_finance_transaction_atomic(
    TEXT, NUMERIC, TEXT, TEXT, DATE, DATE, TEXT, UUID, UUID, TEXT, NUMERIC, DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_finance_transaction_atomic(
    TEXT, NUMERIC, TEXT, TEXT, DATE, DATE, TEXT, UUID, UUID, TEXT, NUMERIC, DATE
) TO authenticated;
COMMENT ON FUNCTION public.create_finance_transaction_atomic(
    TEXT, NUMERIC, TEXT, TEXT, DATE, DATE, TEXT, UUID, UUID, TEXT, NUMERIC, DATE
) IS 'Creates a finance transaction and optional linked cashbox fee atomically.';
