BEGIN;

SET search_path TO public, extensions;
SELECT plan(41);

SELECT has_column('public', 'orders', 'design_submitted_at', 'design submission has a dedicated timestamp');
SELECT has_column('public', 'orders', 'first_delivered_at', 'first final delivery has a dedicated timestamp');
SELECT has_table('public', 'order_transition_commands', 'transition idempotency commands exist');
SELECT has_table('public', 'accounting_review_changes', 'accounting change trail exists');
SELECT has_table('public', 'doctor_order_feedback', 'doctor feedback is isolated from internal orders rows');
SELECT has_column('public', 'workflow_v2_backfill_dry_run', 'timing_review_reason', 'dry run reports unresolved lifecycle timing');
SELECT has_column('public', 'orders', 'legacy_delivery_confirmed', 'legacy delivery can be confirmed without inventing a timestamp');
SELECT has_table('public', 'workflow_v2_legacy_delivery_confirmations', 'legacy delivery confirmations have an admin audit trail');
SELECT has_view('public', 'workflow_v2_backfill_effective_review', 'effective backfill review distinguishes accepted legacy evidence');
SELECT has_view('public', 'financial_obligation_allocation_audit_v2', 'allocation audit distinguishes valid settled write-offs');
SELECT has_function('public', 'confirm_legacy_delivery_without_date_v2', ARRAY['uuid','text'], 'admin legacy delivery confirmation RPC exists');
SELECT ok(
    pg_get_constraintdef((
        SELECT oid FROM pg_constraint
        WHERE conrelid = 'public.orders'::regclass
          AND conname = 'orders_issue_timing_v2_check'
    )) LIKE '%workflow_flag_enabled%legacy_delivery_confirmed%',
    'timing constraint remains rollout-gated and accepts reviewed legacy delivery evidence'
);
SELECT ok(
    pg_get_functiondef('public.apply_workflow_v2_backfill(text)'::regprocedure)
        LIKE '%workflow_v2_backfill_effective_review%',
    'backfill gate uses the effective reviewed timing report'
);

SELECT ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_transition_commands'::regclass),
    'transition commands have RLS enabled'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.order_transition_commands', 'SELECT'),
    'clients cannot read transition commands'
);
SELECT ok(
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = 'Doctors view own orders'),
    'doctor direct orders read policy is retired'
);
SELECT ok(
    pg_get_functiondef('public.sync_order_financial_obligations()'::regprocedure) LIKE '%manual_design_price%',
    'financial owner reads manual design price'
);
SELECT ok(
    pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND tgname = 'trigger_sync_order_financial_obligations'))
        NOT LIKE '%is_archived%',
    'archiving does not invoke the financial owner'
);
SELECT ok(
    NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND tgname = 'zz_trigger_enforce_zero_order_financials'),
    'the duplicate zero-finance writer is removed'
);
SELECT has_function('public', 'apply_order_issue_transition_v2', ARRAY['uuid','text','text','uuid','text','numeric','text'], 'issue transition RPC exists');
SELECT has_function('public', 'request_designer_rejection_v2', ARRAY['uuid','text','uuid'], 'designer rejection request RPC exists');
SELECT has_function('public', 'review_designer_rejection_v2', ARRAY['uuid','text','text','uuid'], 'designer rejection review RPC exists');
SELECT has_function('public', 'admin_reject_order_from_tech_status_v2', ARRAY['uuid','text','uuid'], 'admin technician-status lab rejection RPC exists');
SELECT ok(
    pg_get_functiondef('public.apply_workflow_v2_backfill(text)'::regprocedure)
        LIKE '%Unresolved lifecycle timing rows must be reviewed before backfill%',
    'backfill refuses to mutate while lifecycle timing is unresolved'
);

SELECT ok(
    pg_get_functiondef('public.apply_order_issue_transition_v2(uuid,text,text,uuid,text,numeric,text)'::regprocedure)
        LIKE '%WHEN ''decide_later'' THEN COALESCE(v_order.total_price, 0)%',
    'doctor rejection uses the full order total as the pending provisional amount'
);
SELECT ok(
    pg_get_functiondef('public.create_redo_order_atomic_v2(uuid,text,text,text,numeric,uuid)'::regprocedure)
        LIKE '%WHEN ''decide_later'' THEN COALESCE(v_original.total_price, 0)%',
    'redo uses the full original order total as the pending provisional amount'
);
SELECT ok(
    pg_get_functiondef('public.sync_order_financial_obligations()'::regprocedure)
        LIKE '%NEW.rejection_doctor_decision = ''decide_later''%COALESCE(NEW.rejected_doctor_amount, NEW.total_price, 0)%',
    'financial synchronization creates the lab-safe provisional doctor receivable'
);
SELECT ok(
    pg_get_constraintdef((
        SELECT oid FROM pg_constraint
        WHERE conrelid = 'public.orders'::regclass
          AND conname = 'orders_pending_doctor_decision_check'
    )) LIKE '%NOT (rejected_doctor_amount IS DISTINCT FROM COALESCE(total_price, (0)::numeric))%pending%',
    'pending doctor decisions require full provisional liability and pending review'
);

UPDATE public.app_settings
SET value = 'on'
WHERE key = 'workflow_issue_v2_write';

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('98000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'issue-v2-admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('98000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'issue-v2-rep@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('38000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001',
     'issue_v2_admin', 'admin', 'Issue V2 Admin'),
    ('38000000-0000-0000-0000-000000000002', '98000000-0000-0000-0000-000000000002',
     'issue_v2_rep', 'representative', 'Issue V2 Representative'),
    ('38000000-0000-0000-0000-000000000003', NULL,
     'issue_v2_designer', 'designer', 'Issue V2 Internal Designer');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES (
    '18000000-0000-0000-0000-000000000001', 'Issue V2 Doctor',
    '01000000000', 'Test', 'ISSUE-V2', 'Issue V2 Rep'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, technician_status, designer_id, production_status, issue_state
) VALUES (
    '48000000-0000-0000-0000-000000000001', 'ISSUE-V2-TECH-REJECT',
    '18000000-0000-0000-0000-000000000001', 'Issue V2 Patient', '[]',
    500, 'A1', 'New Case', CURRENT_DATE, 100, 'Pending',
    '38000000-0000-0000-0000-000000000003', 'not_started', 'none'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, technician_status, production_status, issue_state
) VALUES (
    '48000000-0000-0000-0000-000000000002', 'ISSUE-V2-LEGACY-DELIVERY',
    '18000000-0000-0000-0000-000000000001', 'Legacy Delivery Patient', '[]',
    500, 'A1', 'Doctor Rejected', CURRENT_DATE, 100, 'Pending',
    'final_ready', 'none'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, technician_status, designer_id, production_status,
    issue_state, rejected_designer_cost
) VALUES (
    '48000000-0000-0000-0000-000000000003', 'ISSUE-V2-REP-CANCEL',
    '18000000-0000-0000-0000-000000000001', 'Representative Cancel Patient', '[]',
    500, 'A1', 'New Case', CURRENT_DATE, 100, 'Pending',
    '38000000-0000-0000-0000-000000000003', 'not_started', 'none', 75
);

UPDATE public.orders
SET issue_state = 'doctor_rejected'
WHERE id = '48000000-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
    $$SELECT public.confirm_legacy_delivery_without_date_v2(
        '48000000-0000-0000-0000-000000000002',
        'Reviewed paper delivery record; exact date unavailable'
    )$$,
    'admin can confirm a historical delivery without fabricating a date'
);
SELECT ok(
    (SELECT legacy_delivery_confirmed AND first_delivered_at IS NULL
     FROM public.orders WHERE id = '48000000-0000-0000-0000-000000000002'),
    'legacy confirmation keeps the exact first-delivery timestamp null'
);
SELECT is(
    (SELECT count(*)::integer FROM public.workflow_v2_legacy_delivery_confirmations
     WHERE order_id = '48000000-0000-0000-0000-000000000002'),
    1,
    'legacy confirmation creates one audited evidence row'
);
SELECT lives_ok(
    $$SELECT public.admin_reject_order_from_tech_status_v2(
        '48000000-0000-0000-0000-000000000001', 'External lab cannot produce case',
        '88000000-0000-0000-0000-000000000001'
    )$$,
    'admin can directly reject a pre-submission order even with an internal designer assigned'
);
SELECT lives_ok(
    $$SELECT public.admin_reject_order_from_tech_status_v2(
        '48000000-0000-0000-0000-000000000001', 'External lab cannot produce case',
        '88000000-0000-0000-0000-000000000001'
    )$$,
    'admin technician rejection is idempotent on retry'
);
RESET ROLE;

SELECT is(
    (SELECT status || ':' || issue_state || ':' || technician_status
     FROM public.orders WHERE id = '48000000-0000-0000-0000-000000000001'),
    'Lab Rejected:lab_rejected:Rejected',
    'direct technician rejection atomically sets the lab rejection states'
);
SELECT ok(
    (SELECT rejected_doctor_amount = 0
            AND rejected_lab_cost = 0
            AND rejected_designer_cost = 0
     FROM public.orders WHERE id = '48000000-0000-0000-0000-000000000001'),
    'direct technician rejection atomically zeroes every financial field'
);
SELECT is(
    (SELECT count(*)::integer FROM public.financial_obligations
     WHERE order_id = '48000000-0000-0000-0000-000000000001'
       AND status NOT IN ('void', 'written_off')
       AND COALESCE(net_amount, 0) <> 0),
    0,
    'direct technician rejection leaves no active non-zero obligation'
);
SELECT is(
    (SELECT count(*)::integer FROM public.order_events
     WHERE order_id = '48000000-0000-0000-0000-000000000001'
       AND event_type = 'case_rejected'
       AND metadata->>'source' = 'admin_tech_status'),
    1,
    'idempotent retry creates one direct technician rejection event'
);

SELECT set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
    $$SELECT public.apply_order_issue_transition_v2(
        '48000000-0000-0000-0000-000000000003', 'cancel_order',
        'Representative cancellation before delivery',
        '88000000-0000-0000-0000-000000000003', 'zero', NULL,
        'Issue V2 Representative'
    )$$,
    'representative cancellation can atomically zero a pre-existing designer rejection cost'
);
SELECT ok(
    (SELECT issue_state = 'cancelled'
            AND rejected_doctor_amount = 0
            AND rejected_lab_cost = 0
            AND rejected_designer_cost = 0
     FROM public.orders WHERE id = '48000000-0000-0000-0000-000000000003'),
    'representative cancellation zeroes all issue financial fields'
);
SELECT set_config('app.order_issue_operation', '', TRUE);
SELECT throws_like(
    $$UPDATE public.orders
      SET rejected_designer_cost = 25
      WHERE id = '48000000-0000-0000-0000-000000000003'$$,
    '%Only admin can update rejected designer cost%',
    'representative direct designer-cost edits remain blocked outside a workflow RPC'
);
SELECT throws_like(
    $$SELECT public.admin_reject_order_from_tech_status_v2(
        '48000000-0000-0000-0000-000000000001', 'Representative direct rejection',
        '88000000-0000-0000-0000-000000000002'
    )$$,
    '%Only admin can reject directly from technician status%',
    'representative cannot use the admin-only direct technician rejection path'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
