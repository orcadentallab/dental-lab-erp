-- Demo seed — fictional INTERNAL lab. Run on an EMPTY demo database only.
--
-- NEVER run this against a real lab's project: it inserts fake doctors, fake
-- cases and fake money. It exists so a sales demo has something to look at.
--
-- Prerequisite: one admin already exists in public.users with an auth_id.
-- The script finds it by itself and acts as that user where a role is needed.
--
-- Shape of the demo:
--   * Internal production only — no suppliers, no external work orders.
--   * Service names in English; doctors and staff in Arabic.
--   * Cases spread across every stage of the board, not piled in one column.
--
-- Two things are done the long way on purpose:
--   1. Cases that end up Delivered are inserted as 'Ready' and then delivered
--      through record_order_final_delivery_v2(). Inserting status='Delivered'
--      directly leaves first_delivered_at NULL, which silently breaks the
--      lead-time and delivery reports — and a guard blocks setting that
--      timestamp by hand on insert.
--   2. That RPC checks the caller's role, so the script sets a jwt claim for
--      the demo admin instead of running as bare postgres.

BEGIN;

-- ------------------------------------------------------------ catalogue
INSERT INTO service_families (id, name_ar, name_en, color, sort_order) VALUES
  ('f1000000-0000-4000-8000-000000000001','Zirconia','Zirconia','emerald',1),
  ('f1000000-0000-4000-8000-000000000002','Emax','Emax','sky',2),
  ('f1000000-0000-4000-8000-000000000003','Dentures','Dentures','amber',3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO services (id, name, selling_price, cost_price, designer_price, family_id, sort_order) VALUES
  ('e1000000-0000-4000-8000-000000000001','Zirconia Crown',900,350,60,'f1000000-0000-4000-8000-000000000001',1),
  ('e1000000-0000-4000-8000-000000000002','Zirconia Coping',700,280,50,'f1000000-0000-4000-8000-000000000001',2),
  ('e1000000-0000-4000-8000-000000000003','Zirconia Bridge Unit',950,380,60,'f1000000-0000-4000-8000-000000000001',3),
  ('e1000000-0000-4000-8000-000000000004','Emax Crown',1100,450,70,'f1000000-0000-4000-8000-000000000002',4),
  ('e1000000-0000-4000-8000-000000000005','Emax Veneer',1300,520,90,'f1000000-0000-4000-8000-000000000002',5),
  ('e1000000-0000-4000-8000-000000000006','Emax Inlay',800,320,55,'f1000000-0000-4000-8000-000000000002',6),
  ('e1000000-0000-4000-8000-000000000007','Full Acrylic Denture',2500,1000,0,'f1000000-0000-4000-8000-000000000003',7),
  ('e1000000-0000-4000-8000-000000000008','Vitallium Denture',4000,1800,0,'f1000000-0000-4000-8000-000000000003',8)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ staff
-- No auth_id: these exist so cases have owners and names show on screen.
-- Give one a login from the dashboard later to demo its role.
INSERT INTO users (id, username, name, role, is_active) VALUES
  ('a1000000-0000-4000-8000-000000000001','sami','سامي محمود','representative',true),
  ('a1000000-0000-4000-8000-000000000002','hoda','هدى عبد الله','representative',true),
  ('a1000000-0000-4000-8000-000000000003','nasser','ناصر فؤاد','accountant',true),
  ('a1000000-0000-4000-8000-000000000004','karim','كريم سعيد','designer',true),
  ('a1000000-0000-4000-8000-000000000005','tarek','طارق الفني','technician',true),
  ('a1000000-0000-4000-8000-000000000006','mahmoud','محمود الفني','technician',true)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ doctors
INSERT INTO doctors (id, name, phone, address, doctor_code, representative_name, representative_id) VALUES
  ('b1000000-0000-4000-8000-000000000001','د. أحمد الشريف','01000000201','المعادي - القاهرة','DR-001','سامي محمود','a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000002','د. منى رشدي','01000000202','مدينة نصر - القاهرة','DR-002','سامي محمود','a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000003','د. خالد عامر','01000000203','الدقي - الجيزة','DR-003','سامي محمود','a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000004','د. ليلى حسن','01000000204','المهندسين - الجيزة','DR-004','سامي محمود','a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000005','د. طارق منصور','01000000205','مصر الجديدة - القاهرة','DR-005','سامي محمود','a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000006','د. سلمى فتحي','01000000206','سموحة - الإسكندرية','DR-006','هدى عبد الله','a1000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000007','د. عمرو زكي','01000000207','سيدي جابر - الإسكندرية','DR-007','هدى عبد الله','a1000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000008','د. نهى إبراهيم','01000000208','المنصورة - الدقهلية','DR-008','هدى عبد الله','a1000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000009','د. يوسف داود','01000000209','طنطا - الغربية','DR-009','هدى عبد الله','a1000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000010','مركز الابتسامة','01000000210','الشيخ زايد - الجيزة','DR-010','هدى عبد الله','a1000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ cases
INSERT INTO orders (id, case_id, doctor_id, patient_name, items, total_price, cost, shade, status, delivery_date, representative_id, delivery_type, created_at) VALUES
 ('c1000000-0000-4000-8000-000000000001','DEMO-001','b1000000-0000-4000-8000-000000000001','مريم السيد','[{"serviceType":"Zirconia Crown","price":900,"teethNumbers":[11,12]}]'::jsonb,1800,700,'A2','New Case',current_date+5,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '2 days'),
 ('c1000000-0000-4000-8000-000000000002','DEMO-002','b1000000-0000-4000-8000-000000000002','حسن عادل','[{"serviceType":"Emax Veneer","price":1300,"teethNumbers":[21,22,23]}]'::jsonb,3900,1560,'A1','Under Production',current_date+3,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '6 days'),
 ('c1000000-0000-4000-8000-000000000003','DEMO-003','b1000000-0000-4000-8000-000000000003','سعاد كمال','[{"serviceType":"Zirconia Bridge Unit","price":950,"teethNumbers":[36,37,38]}]'::jsonb,2850,1140,'B1','Ready',current_date-4,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '20 days'),
 ('c1000000-0000-4000-8000-000000000004','DEMO-004','b1000000-0000-4000-8000-000000000004','رشا فوزي','[{"serviceType":"Emax Crown","price":1100,"teethNumbers":[14]}]'::jsonb,1100,450,'A3','Under Design',current_date+6,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '3 days'),
 ('c1000000-0000-4000-8000-000000000005','DEMO-005','b1000000-0000-4000-8000-000000000005','مصطفى نبيل','[{"serviceType":"Zirconia Crown","price":900,"teethNumbers":[24,25,26]}]'::jsonb,2700,1050,'A2','Ready',current_date+1,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '9 days'),
 ('c1000000-0000-4000-8000-000000000006','DEMO-006','b1000000-0000-4000-8000-000000000006','هالة رمضان','[{"serviceType":"Full Acrylic Denture","price":2500,"teethNumbers":[]}]'::jsonb,2500,1000,'A2','Under Production',current_date+8,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '5 days'),
 ('c1000000-0000-4000-8000-000000000007','DEMO-007','b1000000-0000-4000-8000-000000000007','أيمن صابر','[{"serviceType":"Emax Inlay","price":800,"teethNumbers":[46,47]}]'::jsonb,1600,640,'B2','Ready',current_date-9,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '25 days'),
 ('c1000000-0000-4000-8000-000000000008','DEMO-008','b1000000-0000-4000-8000-000000000008','فاطمة لطفي','[{"serviceType":"Zirconia Coping","price":700,"teethNumbers":[31,32,33,34]}]'::jsonb,2800,1120,'A1','Ready',current_date-14,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '30 days'),
 ('c1000000-0000-4000-8000-000000000009','DEMO-009','b1000000-0000-4000-8000-000000000009','سامح وجيه','[{"serviceType":"Vitallium Denture","price":4000,"teethNumbers":[]}]'::jsonb,4000,1800,'A3','Under Production',current_date+10,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '7 days'),
 ('c1000000-0000-4000-8000-000000000010','DEMO-010','b1000000-0000-4000-8000-000000000010','نورهان عز','[{"serviceType":"Emax Veneer","price":1300,"teethNumbers":[11,12,13,21,22,23]}]'::jsonb,7800,3120,'B1','Try In',current_date+2,'a1000000-0000-4000-8000-000000000002','TryIn',now()-interval '11 days'),
 ('c1000000-0000-4000-8000-000000000011','DEMO-011','b1000000-0000-4000-8000-000000000001','عبد الله شكري','[{"serviceType":"Zirconia Crown","price":900,"teethNumbers":[16]}]'::jsonb,900,350,'A2','Ready',current_date-20,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '35 days'),
 ('c1000000-0000-4000-8000-000000000012','DEMO-012','b1000000-0000-4000-8000-000000000002','إيمان درويش','[{"serviceType":"Zirconia Bridge Unit","price":950,"teethNumbers":[44,45,46]}]'::jsonb,2850,1140,'A3','New Case',current_date+7,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '1 day'),
 ('c1000000-0000-4000-8000-000000000013','DEMO-013','b1000000-0000-4000-8000-000000000003','وليد سمير','[{"serviceType":"Emax Crown","price":1100,"teethNumbers":[15,17]}]'::jsonb,2200,900,'A1','Ready',current_date-6,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '22 days'),
 ('c1000000-0000-4000-8000-000000000014','DEMO-014','b1000000-0000-4000-8000-000000000006','دينا مجدي','[{"serviceType":"Zirconia Crown","price":900,"teethNumbers":[27]}]'::jsonb,900,350,'A2','Under Design',current_date+4,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '2 days'),
 ('c1000000-0000-4000-8000-000000000015','DEMO-015','b1000000-0000-4000-8000-000000000007','هشام قدري','[{"serviceType":"Full Acrylic Denture","price":2500,"teethNumbers":[]}]'::jsonb,2500,1000,'A3','Ready',current_date-11,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '28 days'),
 ('c1000000-0000-4000-8000-000000000016','DEMO-016','b1000000-0000-4000-8000-000000000004','ريهام أنور','[{"serviceType":"Emax Inlay","price":800,"teethNumbers":[35]}]'::jsonb,800,320,'B2','Ready',current_date,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '8 days'),
 ('c1000000-0000-4000-8000-000000000017','DEMO-017','b1000000-0000-4000-8000-000000000008','مروان تامر','[{"serviceType":"Zirconia Coping","price":700,"teethNumbers":[41,42]}]'::jsonb,1400,560,'A1','New Case',current_date+9,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '1 day'),
 ('c1000000-0000-4000-8000-000000000018','DEMO-018','b1000000-0000-4000-8000-000000000005','آية حمدي','[{"serviceType":"Emax Veneer","price":1300,"teethNumbers":[11,21]}]'::jsonb,2600,1040,'A1','Ready',current_date-2,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '18 days'),
 ('c1000000-0000-4000-8000-000000000019','DEMO-019','b1000000-0000-4000-8000-000000000009','كريم عصام','[{"serviceType":"Zirconia Crown","price":900,"teethNumbers":[36,37]}]'::jsonb,1800,700,'A2','Under Production',current_date+5,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '4 days'),
 ('c1000000-0000-4000-8000-000000000020','DEMO-020','b1000000-0000-4000-8000-000000000010','منال بدر','[{"serviceType":"Vitallium Denture","price":4000,"teethNumbers":[]}]'::jsonb,4000,1800,'A3','Ready',current_date-16,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '33 days'),
 ('c1000000-0000-4000-8000-000000000021','DEMO-021','b1000000-0000-4000-8000-000000000002','جمال رأفت','[{"serviceType":"Zirconia Crown","price":900,"teethNumbers":[26,27]}]'::jsonb,1800,700,'A2','Ready',current_date-5,'a1000000-0000-4000-8000-000000000001','Final',now()-interval '15 days'),
 ('c1000000-0000-4000-8000-000000000022','DEMO-022','b1000000-0000-4000-8000-000000000006','عادل مرسي','[{"serviceType":"Emax Crown","price":1100,"teethNumbers":[13]}]'::jsonb,1100,450,'A2','New Case',current_date+4,'a1000000-0000-4000-8000-000000000002','Final',now()-interval '3 days')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  r RECORD;
  v_admin uuid := (SELECT auth_id FROM users
                    WHERE role='admin' AND auth_id IS NOT NULL
                    ORDER BY created_at LIMIT 1);
BEGIN
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'No admin with an auth_id found — create the demo admin first';
  END IF;
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_admin), true);

  -- Deliver through the RPC so first_delivered_at, the order events and the
  -- doctor obligations are all produced the way the app produces them.
  FOR r IN SELECT id, delivery_date FROM orders WHERE case_id IN
     ('DEMO-003','DEMO-007','DEMO-008','DEMO-011','DEMO-013','DEMO-015','DEMO-018','DEMO-020','DEMO-021')
  LOOP
    PERFORM record_order_final_delivery_v2(
      r.id, r.delivery_date::timestamptz + interval '14 hours', gen_random_uuid());
  END LOOP;

  -- One case comes back from the doctor for adjustment...
  UPDATE orders SET status='Returned for Adjustments', delivery_date=current_date+3
   WHERE case_id='DEMO-021';

  -- ...and one is cancelled before any work: zero cost, zero revenue.
  UPDATE orders SET status='Cancelled',
      rejection_doctor_decision='zero', rejected_doctor_amount=0,
      rejection_financial_review_status='resolved',
      rejected_lab_cost=0, rejected_designer_cost=0,
      rejected_lab_cost_status='not_applicable',
      rejected_designer_cost_status='not_applicable'
   WHERE case_id='DEMO-022';
END $$;

-- ------------------------------------------------------------ production
-- Puts every open case at a different point on the CAD route, so the board
-- shows a real spread instead of one column.
DO $$
DECLARE
  o RECORD; r RECORD;
  v_route uuid := (SELECT id FROM production_routes WHERE name_ar LIKE '%CAD%' LIMIT 1);
  v_job uuid; v_units int; v_cur int; v_job_status text;
  v_designer uuid := 'a1000000-0000-4000-8000-000000000004';
  v_t1 uuid := 'a1000000-0000-4000-8000-000000000005';
  v_t2 uuid := 'a1000000-0000-4000-8000-000000000006';
  v_status text; v_assignee uuid; v_start timestamptz; v_done timestamptz; v_step timestamptz;
BEGIN
  FOR o IN SELECT id, status, created_at, items FROM orders
           WHERE case_id LIKE 'DEMO-%' AND status <> 'Cancelled' ORDER BY case_id
  LOOP
    v_cur := CASE o.status
       WHEN 'New Case' THEN 10 WHEN 'Under Design' THEN 10
       WHEN 'Try In' THEN 60
       WHEN 'Under Production' THEN 90 WHEN 'Returned for Adjustments' THEN 90
       WHEN 'Ready' THEN 130
       WHEN 'Delivered' THEN 999 ELSE 10 END;
    v_job_status := CASE WHEN v_cur = 999 THEN 'done'
                         WHEN o.status='New Case' THEN 'queued' ELSE 'active' END;

    SELECT GREATEST(COALESCE(SUM(jsonb_array_length(COALESCE(it->'teethNumbers','[]'::jsonb))),1),1)
      INTO v_units FROM jsonb_array_elements(o.items) it;

    INSERT INTO production_jobs (order_id, route_id, unit_count, status, started_at, completed_at, created_at)
    VALUES (o.id, v_route, v_units, v_job_status,
            CASE WHEN v_job_status='queued' THEN NULL ELSE o.created_at + interval '4 hours' END,
            CASE WHEN v_job_status='done' THEN o.created_at + interval '9 days' END,
            o.created_at)
    RETURNING id INTO v_job;

    FOR r IN SELECT rs.step_no, rs.stage_id, s.code, rs.allowed_roles
             FROM production_route_stages rs JOIN production_stages s ON s.id=rs.stage_id
             WHERE rs.route_id=v_route ORDER BY rs.step_no
    LOOP
      v_status := CASE WHEN r.step_no < v_cur THEN 'done'
                       WHEN r.step_no = v_cur AND o.status IN ('New Case','Ready') THEN 'ready'
                       WHEN r.step_no = v_cur THEN 'in_progress'
                       ELSE 'pending' END;
      v_assignee := CASE WHEN r.code='design' THEN v_designer
                         WHEN v_status='pending' THEN NULL
                         WHEN (r.step_no/10) % 2 = 0 THEN v_t1 ELSE v_t2 END;
      v_step  := o.created_at + (r.step_no/10) * interval '12 hours';
      v_start := CASE WHEN v_status IN ('done','in_progress') THEN v_step END;
      v_done  := CASE WHEN v_status='done' THEN v_step + interval '5 hours' END;

      INSERT INTO production_stage_runs
        (job_id, stage_id, seq, execution, status, assignee_id, allowed_roles,
         units_in, units_passed, queued_at, started_at, completed_at, driven_by)
      VALUES (v_job, r.stage_id, r.step_no, 'internal', v_status, v_assignee, r.allowed_roles,
              v_units, CASE WHEN v_status='done' THEN v_units ELSE 0 END,
              v_step - interval '1 hour', v_start, v_done, 'my_tasks');
    END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------ money
INSERT INTO transactions (type, amount, category, date, description, entity_id, entity_type, status, is_approved, is_registered) VALUES
 ('income', 2000,'تحصيل من دكتور', current_date-3,  'دفعة تحت الحساب','b1000000-0000-4000-8000-000000000001','doctor','approved',true,true),
 ('income', 1500,'تحصيل من دكتور', current_date-8,  'سداد جزئي','b1000000-0000-4000-8000-000000000002','doctor','approved',true,true),
 ('income', 2800,'تحصيل من دكتور', current_date-12, 'سداد كامل','b1000000-0000-4000-8000-000000000008','doctor','approved',true,true),
 ('income', 1000,'تحصيل من دكتور', current_date-1,  'دفعة تحت الحساب','b1000000-0000-4000-8000-000000000007','doctor','pending',false,false),
 ('expense',8500,'مرتبات وأجور',     current_date-5,  'مرتبات الفنيين',NULL,'general','approved',true,true),
 ('expense',3200,'خامات ومستهلكات', current_date-6,  'بلوكات زيركون',NULL,'general','approved',true,true),
 ('expense',1400,'إيجارات ومرافق',   current_date-7,  'كهرباء ومياه',NULL,'general','approved',true,true),
 ('expense', 900,'صيانة وإصلاحات',  current_date-10, 'صيانة ماكينة الميلينج',NULL,'general','approved',true,true);

COMMIT;
