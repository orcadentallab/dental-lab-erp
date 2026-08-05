-- One canonical expense taxonomy for every registration source and report.

CREATE OR REPLACE FUNCTION canonical_expense_category(p_category TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE lower(trim(COALESCE(p_category, '')))
        WHEN 'مرتبات وأجور' THEN 'مرتبات وأجور'
        WHEN 'مرتبات واجور' THEN 'مرتبات وأجور'
        WHEN 'salaries' THEN 'مرتبات وأجور'

        WHEN 'شحن وتوصيل' THEN 'شحن وتوصيل'
        WHEN 'shipping' THEN 'شحن وتوصيل'

        WHEN 'انتقالات' THEN 'انتقالات ووقود'
        WHEN 'انتقالات ووقود' THEN 'انتقالات ووقود'
        WHEN 'وقود' THEN 'انتقالات ووقود'
        WHEN 'بنزين' THEN 'انتقالات ووقود'

        WHEN 'دعاية وتسويق' THEN 'دعاية وتسويق'
        WHEN 'دعايا وسوشيال ميديا' THEN 'دعاية وتسويق'
        WHEN 'دعايه وسوشيال ميديا' THEN 'دعاية وتسويق'
        WHEN 'دعاية وسوشيال ميديا' THEN 'دعاية وتسويق'
        WHEN 'marketing' THEN 'دعاية وتسويق'
        WHEN 'advertising' THEN 'دعاية وتسويق'

        WHEN 'ضيافة واجتماعات' THEN 'ضيافة واجتماعات'
        WHEN 'بوفيه وضيافة' THEN 'ضيافة واجتماعات'
        WHEN 'اجتماعات ونثريات' THEN 'ضيافة واجتماعات'
        WHEN 'meetings' THEN 'ضيافة واجتماعات'

        WHEN 'خامات ومستهلكات' THEN 'خامات ومستهلكات'
        WHEN 'أدوات ومهمات' THEN 'خامات ومستهلكات'
        WHEN 'ادوات ومهمات' THEN 'خامات ومستهلكات'
        WHEN 'material' THEN 'خامات ومستهلكات'

        WHEN 'عمولات ورسوم بنكية' THEN 'عمولات ورسوم بنكية'
        WHEN 'transfer_fee' THEN 'عمولات ورسوم بنكية'
        WHEN 'bank_fees' THEN 'عمولات ورسوم بنكية'

        WHEN 'إيجارات ومرافق' THEN 'إيجارات ومرافق'
        WHEN 'ايجارات ومرافق' THEN 'إيجارات ومرافق'
        WHEN 'rent' THEN 'إيجارات ومرافق'
        WHEN 'utilities' THEN 'إيجارات ومرافق'

        WHEN 'صيانة وإصلاحات' THEN 'صيانة وإصلاحات'
        WHEN 'صيانه واصلاحات' THEN 'صيانة وإصلاحات'
        WHEN 'maintenance' THEN 'صيانة وإصلاحات'

        WHEN 'مصروفات أخرى' THEN 'مصروفات أخرى'
        WHEN 'أخرى' THEN 'مصروفات أخرى'
        WHEN 'اخرى' THEN 'مصروفات أخرى'
        WHEN 'other' THEN 'مصروفات أخرى'
        ELSE 'مصروفات أخرى'
    END
$$;
-- Preserve internal payroll components and payable-settlement movement codes;
-- everything that represents an expense category is migrated to one name.
UPDATE transactions
SET category = CASE
    WHEN entity_type = 'supplier' THEN 'supplier_payment'
    WHEN entity_type = 'designer' THEN 'designer_payment'
    WHEN entity_type = 'representative' AND category IN ('bonus', 'deduction', 'commission') THEN category
    ELSE canonical_expense_category(category)
END
WHERE type = 'expense';
CREATE OR REPLACE FUNCTION enforce_canonical_transaction_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.type <> 'expense' THEN
        RETURN NEW;
    END IF;

    IF NEW.entity_type = 'supplier' THEN
        NEW.category := 'supplier_payment';
    ELSIF NEW.entity_type = 'designer' THEN
        NEW.category := 'designer_payment';
    ELSIF NEW.entity_type = 'representative' AND NEW.category IN ('bonus', 'deduction', 'commission') THEN
        NULL;
    ELSE
        NEW.category := canonical_expense_category(NEW.category);
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_canonical_transaction_category ON transactions;
CREATE TRIGGER trg_enforce_canonical_transaction_category
BEFORE INSERT OR UPDATE OF type, category, entity_type ON transactions
FOR EACH ROW EXECUTE FUNCTION enforce_canonical_transaction_category();
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_expense_category_check;
ALTER TABLE transactions
ADD CONSTRAINT transactions_expense_category_check CHECK (
    type <> 'expense'
    OR category IN (
        'مرتبات وأجور',
        'شحن وتوصيل',
        'انتقالات ووقود',
        'دعاية وتسويق',
        'ضيافة واجتماعات',
        'خامات ومستهلكات',
        'عمولات ورسوم بنكية',
        'إيجارات ومرافق',
        'صيانة وإصلاحات',
        'مصروفات أخرى'
    )
    OR (entity_type = 'supplier' AND category = 'supplier_payment')
    OR (entity_type = 'designer' AND category = 'designer_payment')
    OR (entity_type = 'representative' AND category IN ('bonus', 'deduction', 'commission'))
);
