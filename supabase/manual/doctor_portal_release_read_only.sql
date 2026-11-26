-- Run by an authorized operator on staging/production, before and after rollout.
-- Reports only. No repairs, reconciliation, allocation, reparenting or backfill.
BEGIN READ ONLY;
SELECT version();
SELECT count(*) AS orders,count(DISTINCT doctor_id) AS doctors_in_orders,sum(total_price) AS stored_order_total FROM public.orders WHERE NOT coalesce(is_deleted,false);
SELECT count(*) AS obligations,sum(net_amount) AS net,sum(allocated_amount) AS allocated FROM public.financial_obligations WHERE entity_type='doctor' AND direction='receivable' AND status NOT IN('void','written_off');
SELECT count(*) AS payments,sum(amount) AS amount FROM public.transactions WHERE entity_type='doctor';
SELECT count(*) AS allocations,sum(allocated_amount) AS amount FROM public.payment_allocations WHERE entity_type='doctor' AND status='active';
SELECT count(*) AS adjustments,sum(amount) AS amount FROM public.adjustments WHERE entity_type='doctor';
-- Recent delivered cases lacking a recognized ledger row must be reviewed before
-- presenting a ledger-only monthly statement. Never automatically fix these.
SELECT d.id,d.name,o.case_id,o.status,o.first_delivered_at,o.actual_delivery_date
FROM public.orders o JOIN public.doctors d ON d.id=o.doctor_id
WHERE NOT coalesce(o.is_deleted,false) AND (o.production_status='final_delivered' OR o.status IN('Delivered','Completed'))
 AND coalesce(o.first_delivered_at::date,o.actual_delivery_date,o.delivery_date)>= (date_trunc('month',timezone('Africa/Cairo',now()))-interval '1 month')::date
 AND NOT EXISTS(SELECT 1 FROM public.financial_obligations f WHERE f.order_id=o.id AND f.entity_type='doctor' AND f.direction='receivable' AND f.status NOT IN('void','written_off'));
SELECT u.id,u.entity_id,d.name,d.parent_id,d.is_center FROM public.users u LEFT JOIN public.doctors d ON d.id=u.entity_id WHERE u.role='doctor' AND u.is_active AND (u.entity_id IS NULL OR d.id IS NULL);
SELECT entity_id,count(*) FROM public.users WHERE role='doctor' AND entity_id IS NOT NULL GROUP BY entity_id HAVING count(*)>1;
SELECT id,name,parent_id FROM public.doctors WHERE parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.doctors p WHERE p.id=doctors.parent_id AND p.is_center AND p.parent_id IS NULL);
SELECT id,public FROM storage.buckets WHERE id IN('case-files','case-scans');
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('register_doctor_password_account','get_doctor_portal_cases','get_my_doctor_month','submit_doctor_portal_case','get_doctor_portal_staff_inbox');
ROLLBACK;
