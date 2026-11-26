-- Review only. Run with an authorized read role against the database containing these codes.
-- No merge, DELETE, UPDATE, INSERT, DDL or automatic financial reconciliation.
BEGIN READ ONLY;

WITH target AS (SELECT * FROM public.doctors WHERE doctor_code IN ('2003','2024'))
SELECT d.id,d.doctor_code,d.name,d.phone,d.phone2,d.address,d.is_center,d.parent_id,d.has_branches,d.branches,
    (SELECT count(*) FROM public.orders o WHERE o.doctor_id=d.id) AS all_order_count,
    (SELECT count(*) FROM public.transactions t WHERE t.entity_type='doctor' AND t.entity_id=d.id) AS payment_row_count,
    (SELECT count(*) FROM public.financial_obligations f WHERE f.entity_type='doctor' AND f.entity_id=d.id) AS obligation_row_count,
    (SELECT count(*) FROM public.adjustments a WHERE a.entity_type='doctor' AND a.entity_id=d.id) AS adjustment_row_count,
    (SELECT count(*) FROM public.users u WHERE u.role='doctor' AND u.entity_id=d.id) AS linked_account_count,
    (SELECT count(*) FROM public.doctors child WHERE child.parent_id=d.id) AS child_doctor_count
FROM target d ORDER BY d.doctor_code;

-- Inventory every actual foreign key to doctors, including references added by later migrations.
SELECT c.conrelid::regclass AS referencing_table,pg_get_constraintdef(c.oid) AS reference_definition
FROM pg_constraint c WHERE c.contype='f' AND c.confrelid='public.doctors'::regclass ORDER BY 1;

-- Polymorphic references are not foreign keys and must be reviewed separately.
SELECT table_name,column_name FROM information_schema.columns
WHERE table_schema='public' AND column_name IN ('entity_id','doctor_id','parent_id','target_doctor_id')
ORDER BY table_name,column_name;

-- Preserve amount/date/source/status fields in a before/after snapshot; do not sum raw rows as a balance.
SELECT t.* FROM public.transactions t JOIN public.doctors d ON d.id=t.entity_id
WHERE t.entity_type='doctor' AND d.doctor_code IN ('2003','2024') ORDER BY t.id;
SELECT f.* FROM public.financial_obligations f JOIN public.doctors d ON d.id=f.entity_id
WHERE f.entity_type='doctor' AND d.doctor_code IN ('2003','2024') ORDER BY f.id;
SELECT a.* FROM public.adjustments a JOIN public.doctors d ON d.id=a.entity_id
WHERE a.entity_type='doctor' AND d.doctor_code IN ('2003','2024') ORDER BY a.id;

ROLLBACK;
