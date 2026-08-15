BEGIN;

SET search_path TO public, extensions;

SELECT plan(24);

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('91000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-rep@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('91000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-accountant@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('91000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-doctor@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('31000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'rls_admin', 'admin', 'RLS Admin'),
    ('31000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 'rls_rep', 'representative', 'RLS Rep'),
    ('31000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000003', 'rls_accountant', 'accountant', 'RLS Accountant'),
    ('31000000-0000-0000-0000-000000000004', '91000000-0000-0000-0000-000000000004', 'rls_doctor', 'doctor', 'RLS Doctor');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('11000000-0000-0000-0000-000000000001', 'RLS Doctor Entity', '01000000000', 'Test', 'RLS-DOC', 'RLS Rep');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    '41000000-0000-0000-0000-000000000001', 'RLS-ISSUE',
    '11000000-0000-0000-0000-000000000001', 'RLS Patient', '[]', 100,
    'A1', 'New Case', CURRENT_DATE, 0, 'not_started', 'none'
);

INSERT INTO public.order_issues (id, order_id, issue_type, cause_category, notes)
VALUES (
    '61000000-0000-0000-0000-000000000001',
    '41000000-0000-0000-0000-000000000001',
    'returned', 'unknown', 'Sensitive issue note'
);

INSERT INTO public.ai_insights (id, insight_type, content)
VALUES ('71000000-0000-0000-0000-000000000001', 'on_demand', 'Sensitive AI report');

INSERT INTO public.cashboxes (id, name, type, opening_balance)
VALUES ('71000000-0000-0000-0000-000000000002', 'RLS finance box', 'cash', 0);

SELECT ok(
    NOT has_function_privilege('anon', 'public.get_dashboard_data()', 'EXECUTE'),
    'anonymous callers cannot execute the dashboard RPC'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.get_analytics_summary(date,date)', 'EXECUTE'),
    'anonymous callers cannot execute analytics RPCs'
);
SELECT ok(
    NOT has_function_privilege('authenticated', 'public.log_order_issue_trigger_fn()', 'EXECUTE'),
    'trigger-only SECURITY DEFINER functions are not client-callable'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.admin_review_order_edit(uuid,text,text)', 'EXECUTE'),
    'anonymous callers cannot execute admin review RPCs'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.rep_update_order_fields_with_audit(uuid,jsonb,text,text)', 'EXECUTE'),
    'anonymous callers cannot execute representative edit RPCs'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.settle_employee_expenses(uuid[],numeric,uuid,date,date)', 'EXECUTE'),
    'anonymous callers cannot execute employee settlement RPCs'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.get_doctors_activity_analytics(uuid)', 'EXECUTE'),
    'anonymous callers cannot execute doctor retention analytics'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.get_todays_follow_ups()', 'EXECUTE'),
    'anonymous callers cannot read follow-up reports'
);
SELECT ok(
    NOT has_function_privilege(
        'anon',
        'public.create_finance_transaction_atomic(text,numeric,text,text,date,date,text,uuid,uuid,text,numeric,date)',
        'EXECUTE'
    ),
    'anonymous callers cannot create atomic finance transactions'
);

SELECT set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::integer FROM public.order_issues), 0, 'representative cannot read order issue audit rows');
SELECT is((SELECT count(*)::integer FROM public.ai_insights), 0, 'representative cannot read AI reports');
SELECT throws_like(
    $$INSERT INTO public.ai_insights (insight_type, content) VALUES ('on_demand', 'unauthorized')$$,
    '%row-level security policy%',
    'representative cannot insert AI reports directly'
);
SELECT throws_like(
    $$SELECT public.get_analytics_summary(NULL, NULL)$$,
    '%admin role required%',
    'representative cannot execute admin analytics'
);
SELECT throws_like(
    $$SELECT public.get_finance_dashboard()$$,
    '%finance role required%',
    'representative cannot execute finance aggregates'
);
SELECT lives_ok(
    $$SELECT public.get_dashboard_data()$$,
    'representative can execute the staff dashboard'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000003', TRUE);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
    $$SELECT public.get_finance_dashboard()$$,
    'accountant can execute finance aggregates'
);
SELECT throws_like(
    $$SELECT public.get_analytics_summary(NULL, NULL)$$,
    '%admin role required%',
    'accountant cannot execute admin-only analytics'
);
SELECT lives_ok(
    $$
        SELECT public.create_finance_transaction_atomic(
            'income', 75, 'إيراد عام', 'RLS accountant atomic income',
            CURRENT_DATE, NULL, 'general', NULL,
            '71000000-0000-0000-0000-000000000002', 'approved', 0, NULL
        )
    $$,
    'accountant can create an authorized atomic finance transaction'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000004', TRUE);
SET LOCAL ROLE authenticated;
SELECT throws_like(
    $$SELECT public.get_dashboard_data()$$,
    '%staff role required%',
    'doctor cannot execute the internal staff dashboard'
);
SELECT throws_like(
    $$
        SELECT public.create_finance_transaction_atomic(
            'income', 75, 'إيراد عام', 'Unauthorized doctor income',
            CURRENT_DATE, NULL, 'general', NULL, NULL, 'approved', 0, NULL
        )
    $$,
    '%row-level security policy%',
    'doctor cannot create finance transactions through the atomic RPC'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.order_issues), 1, 'admin can read order issue audit rows');
SELECT is((SELECT count(*)::integer FROM public.ai_insights), 1, 'admin can read AI reports');
SELECT lives_ok(
    $$SELECT public.get_analytics_summary(NULL, NULL)$$,
    'admin can execute analytics aggregates'
);
SELECT lives_ok(
    $$UPDATE public.order_issues SET resolution_notes = 'Reviewed' WHERE id = '61000000-0000-0000-0000-000000000001'$$,
    'admin can update issue resolution fields'
);

SELECT * FROM finish();
ROLLBACK;
