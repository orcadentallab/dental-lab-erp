-- Employee expense rows are claims until an approved settlement creates the
-- real ledger movement. Keep claims identifiable and settle them atomically.

UPDATE transactions t
SET entity_type = 'representative'
WHERE t.type = 'expense'
  AND t.entity_id IS NOT NULL
  AND (t.entity_type = 'general' OR t.entity_type IS NULL)
  AND t.category NOT IN ('مرتبات وأجور', 'salaries')
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = t.entity_id);

CREATE OR REPLACE FUNCTION settle_employee_expenses(
    p_expense_ids UUID[],
    p_settled_amount NUMERIC,
    p_cashbox_id UUID DEFAULT NULL,
    p_settlement_date DATE DEFAULT CURRENT_DATE,
    p_effective_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requested_count INT := COALESCE(cardinality(p_expense_ids), 0);
    v_valid_count INT;
    v_employee_count INT;
    v_employee_id UUID;
    v_employee_name TEXT;
    v_claim_total NUMERIC;
    v_category_count INT;
    v_category_index INT := 0;
    v_allocated NUMERIC := 0;
    v_category_amount NUMERIC;
    v_details TEXT;
    v_group RECORD;
    v_inserted transactions%ROWTYPE;
    v_first_transaction_id UUID;
    v_transfer_fee NUMERIC := 0;
    v_created JSONB := '[]'::jsonb;
BEGIN
    IF get_my_role() NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Only admins and accountants can settle employee expenses';
    END IF;
    IF v_requested_count = 0 THEN
        RAISE EXCEPTION 'No expense claims were selected';
    END IF;
    IF p_settled_amount IS NULL OR p_settled_amount < 0 THEN
        RAISE EXCEPTION 'Settlement amount must be zero or greater';
    END IF;

    PERFORM 1 FROM transactions WHERE id = ANY(p_expense_ids) FOR UPDATE;

    SELECT COUNT(*), COUNT(DISTINCT entity_id), MIN(entity_id::text)::uuid, COALESCE(SUM(amount), 0)
    INTO v_valid_count, v_employee_count, v_employee_id, v_claim_total
    FROM transactions
    WHERE id = ANY(p_expense_ids)
      AND type = 'expense'
      AND entity_id IS NOT NULL
      AND entity_type = 'representative'
      AND category NOT IN ('مرتبات وأجور', 'salaries')
      AND status = 'approved';

    IF v_valid_count <> v_requested_count THEN
        RAISE EXCEPTION 'Every selected claim must exist and still be approved';
    END IF;
    IF v_employee_count <> 1 OR v_claim_total <= 0 THEN
        RAISE EXCEPTION 'Selected claims must belong to one employee and have a positive total';
    END IF;

    SELECT name INTO v_employee_name FROM users WHERE id = v_employee_id;
    v_employee_name := COALESCE(v_employee_name, 'موظف غير معروف');

    SELECT COUNT(DISTINCT category) INTO v_category_count
    FROM transactions WHERE id = ANY(p_expense_ids);

    FOR v_group IN
        SELECT category, SUM(amount) AS category_total
        FROM transactions WHERE id = ANY(p_expense_ids)
        GROUP BY category ORDER BY category
    LOOP
        v_category_index := v_category_index + 1;
        IF v_category_index = v_category_count THEN
            v_category_amount := p_settled_amount - v_allocated;
        ELSE
            v_category_amount := ROUND(p_settled_amount * v_group.category_total / v_claim_total, 2);
            v_allocated := v_allocated + v_category_amount;
        END IF;

        SELECT string_agg(description || ' (' || amount || ' ج.م)', '، ' ORDER BY date, id)
        INTO v_details
        FROM transactions
        WHERE id = ANY(p_expense_ids) AND category = v_group.category;

        IF v_category_amount > 0 THEN
            INSERT INTO transactions (
                type, amount, category, date, description, entity_id, entity_type,
                is_registered, is_approved, status, effective_date, cashbox_id
            ) VALUES (
                'expense', v_category_amount, v_group.category, p_settlement_date,
                LEFT('تسوية مصاريف ' || v_employee_name || ' - ' || v_group.category || ': ' || v_details, 500),
                NULL, 'general', false, true, 'approved', p_effective_date, p_cashbox_id
            ) RETURNING * INTO v_inserted;

            v_first_transaction_id := COALESCE(v_first_transaction_id, v_inserted.id);
            v_created := v_created || jsonb_build_array(to_jsonb(v_inserted));
            UPDATE transactions
            SET linked_transaction_id = v_inserted.id
            WHERE id = ANY(p_expense_ids) AND category = v_group.category;
        END IF;
    END LOOP;

    -- Keep the bank/wallet fee in the same atomic operation, calculated once
    -- from the full settlement (not once per expense category).
    IF p_cashbox_id IS NOT NULL AND p_settled_amount > 0 AND v_first_transaction_id IS NOT NULL THEN
        SELECT CASE
            WHEN NOT fee_enabled THEN 0
            WHEN fee_max_amount IS NULL THEN GREATEST(fee_min_amount, ROUND(p_settled_amount * fee_percentage / 100, 2))
            ELSE LEAST(fee_max_amount, GREATEST(fee_min_amount, ROUND(p_settled_amount * fee_percentage / 100, 2)))
        END
        INTO v_transfer_fee
        FROM cashboxes
        WHERE id = p_cashbox_id;

        IF COALESCE(v_transfer_fee, 0) > 0 THEN
            INSERT INTO transactions (
                type, amount, category, date, description, entity_type,
                is_registered, is_approved, status, effective_date, cashbox_id,
                linked_transaction_id, is_system_generated_fee
            ) VALUES (
                'expense', v_transfer_fee, 'transfer_fee', p_settlement_date,
                LEFT('مصاريف بنك/محفظة - تسوية مصاريف ' || v_employee_name, 500), 'general',
                true, true, 'approved', p_effective_date, p_cashbox_id,
                v_first_transaction_id, true
            ) RETURNING * INTO v_inserted;
            v_created := v_created || jsonb_build_array(to_jsonb(v_inserted));
        END IF;
    END IF;

    UPDATE transactions
    SET status = 'settled', is_approved = true,
        description = LEFT(description || ' (تمت التسوية بتاريخ ' || p_settlement_date || ')', 500)
    WHERE id = ANY(p_expense_ids);

    RETURN jsonb_build_object(
        'employee_id', v_employee_id,
        'employee_name', v_employee_name,
        'claim_total', v_claim_total,
        'settled_amount', p_settled_amount,
        'created_transactions', v_created
    );
END;
$$;

REVOKE ALL ON FUNCTION settle_employee_expenses(UUID[], NUMERIC, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settle_employee_expenses(UUID[], NUMERIC, UUID, DATE, DATE) TO authenticated;

-- This dashboard RPC predates transaction statuses. Exclude employee claims by
-- their dedicated entity type while retaining all real manual ledger entries.
CREATE OR REPLACE FUNCTION get_finance_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_total_income NUMERIC;
    v_production_costs NUMERIC;
    v_operating_expenses NUMERIC;
    v_total_capital NUMERIC;
    v_total_assets NUMERIC;
BEGIN
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0),
        COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND entity_type IN ('supplier', 'designer')
        ), 0),
        COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense'
              AND (entity_type NOT IN ('supplier', 'designer', 'representative') OR entity_type IS NULL)
        ), 0)
    INTO v_total_income, v_production_costs, v_operating_expenses
    FROM transactions;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_capital FROM capital_entries;
    SELECT COALESCE(SUM(value), 0) INTO v_total_assets FROM fixed_assets;

    result := jsonb_build_object(
        'total_income', v_total_income,
        'production_costs', v_production_costs,
        'operating_expenses', v_operating_expenses,
        'total_capital', v_total_capital,
        'total_assets', v_total_assets,
        'starting_balance', v_total_capital - v_total_assets,
        'current_balance', (v_total_capital - v_total_assets) + v_total_income - (v_production_costs + v_operating_expenses)
    );
    RETURN result;
END;
$$;
