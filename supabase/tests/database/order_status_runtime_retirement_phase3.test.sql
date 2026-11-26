BEGIN;

SET search_path TO public, extensions;

SELECT plan(47);

SELECT ok(
    pg_get_functiondef('public.rep_update_order_fields_with_audit(uuid,jsonb,text,text)'::regprocedure) NOT LIKE '%v_old.status%'
    AND pg_get_functiondef('public.sync_preserved_external_lab_price_change()'::regprocedure) NOT LIKE '%NEW.status%'
    AND pg_get_functiondef('public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)'::regprocedure) NOT LIKE '%v_order.status%'
    AND pg_get_functiondef('public.confirm_shipment_delivery(uuid,text,timestamp with time zone,text)'::regprocedure) NOT LIKE '%o.status%',
    'operational audit, obligation metadata, correction, and shipment paths read V2 axes'
);

SELECT ok(
    to_regprocedure('public.guard_direct_legacy_order_status_write()') IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'aaa_guard_direct_legacy_order_status_write'
          AND pg_get_triggerdef(oid) LIKE '%BEFORE UPDATE OF status%'
    ),
    'direct legacy status updates are rejected while the V2 mirror owns compatibility writes'
);

SELECT ok(
    to_regprocedure('public.sync_workflow_states_fn()') IS NULL
    AND to_regprocedure('public.sync_design_status_on_order_update()') IS NULL
    AND to_regprocedure('public.log_design_status_inconsistency()') IS NULL
    AND to_regprocedure('public.initialize_order_intake_state_v2()') IS NULL
    AND pg_get_functiondef('public.check_order_update_permissions()'::regprocedure) NOT LIKE '%NEW.status%'
    AND pg_get_functiondef('public.check_lab_column_updates()'::regprocedure) NOT LIKE '%NEW.status%'
    AND pg_get_functiondef('public.guard_archive_is_display_only()'::regprocedure) NOT LIKE '%NEW.status%',
    'obsolete reverse-sync and guard reads of legacy status are retired'
);

SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'orders'
          AND policyname = 'orders_update'
          AND (COALESCE(qual, '') LIKE '%status <>%'
               OR COALESCE(with_check, '') LIKE '%status <>%')
    )
    AND EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'orders'
          AND policyname = 'orders_update'
          AND COALESCE(qual, '') LIKE '%production_status%final_delivered%issue_state%none%'
    ),
    'orders update RLS uses V2 delivered state instead of legacy status'
);

SELECT ok(
    pg_get_functiondef('public.get_cost_of_quality_report(date,date)'::regprocedure) NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.get_internal_vs_external_benchmark(date,date)'::regprocedure) NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.capture_cutover_baseline(date,date,text)'::regprocedure) NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.get_order_cost_breakdown(uuid)'::regprocedure) NOT LIKE '%v_order.status%',
    'cost, quality, benchmark, and cutover reports read V2 workflow axes'
);

SELECT ok(
    pg_get_functiondef('public.get_doctors_activity_analytics(uuid)'::regprocedure) NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.get_doctor_receivables_breakdown_privileged_20260812()'::regprocedure) NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.get_doctor_service_profitability(date,date)'::regprocedure) NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.get_doctor_segmentation_inputs(date,date)'::regprocedure) NOT LIKE '%o.status%',
    'doctor analytics, receivables, profitability, and segmentation read V2-derived classifications'
);

SELECT ok(
    pg_get_functiondef('public.get_top_doctors_privileged_20260801(date,date,integer)'::regprocedure) NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.get_top_services_privileged_20260801(date,date,integer)'::regprocedure) NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.get_top_families_privileged_20260826(date,date,integer)'::regprocedure) NOT LIKE '%o.status%',
    'top-doctor, service, and family reports read V2-derived status classifications'
);

SELECT ok(
    pg_get_functiondef('public.get_analytics_summary_privileged_20260801(date,date)'::regprocedure)
        NOT LIKE '%o.status%'
    AND pg_get_functiondef('public.get_analytics_summary_privileged_20260801(date,date)'::regprocedure)
        LIKE '%derive_order_legacy_compat_status_v2%',
    'analytics summary preserves legacy parity through a V2-derived compatibility classification'
);

SELECT ok(
    pg_get_functiondef('public.create_my_order_request_v2(text,jsonb,text,text,text,text,date,numeric)'::regprocedure)
        LIKE '%production_status, issue_state, intake_state, technician_status%'
    AND pg_get_functiondef('public.create_my_order_request_with_destination(text,jsonb,text,text,text,text,date,numeric,text,text)'::regprocedure)
        LIKE '%production_status,issue_state,intake_state,technician_status%'
    AND pg_get_functiondef('public.submit_doctor_portal_case(uuid,jsonb)'::regprocedure)
        LIKE '%production_status,issue_state,intake_state,technician_status%',
    'Doctor Portal inserts write explicit V2 intake state instead of legacy order status'
);

SELECT ok(
    pg_get_functiondef('public.get_dashboard_data_privileged_20260801()'::regprocedure)
        !~ E'\\mstatus\\M'
    AND pg_get_functiondef('public.get_dashboard_data_privileged_20260801()'::regprocedure)
        LIKE '%production_status%'
    AND pg_get_functiondef('public.get_dashboard_data_privileged_20260801()'::regprocedure)
        LIKE '%issue_state%',
    'dashboard RPC filters and projects orders from V2 workflow axes only'
);

SELECT ok(
    pg_get_functiondef('public.guard_lab_rejected_cancelled_transition()'::regprocedure)
        NOT LIKE '%NEW.status%',
    'delivered-order issue guard reads issue_state instead of legacy status'
);

SELECT ok(
    pg_get_triggerdef((
        SELECT oid FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'trigger_guard_lab_rejected_cancelled_transition'
    )) LIKE '%UPDATE OF issue_state%'
    AND pg_get_triggerdef((
        SELECT oid FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'trigger_guard_lab_rejected_cancelled_transition'
    )) NOT LIKE '%UPDATE OF status%',
    'delivered-order issue guard listens only to the V2 issue axis'
);

SELECT ok(
    pg_get_functiondef('public.normalize_zero_fields_for_lab_rejected_cancelled()'::regprocedure)
        NOT LIKE '%NEW.status%',
    'zero-financial normalization reads issue_state instead of legacy status'
);

SELECT ok(
    pg_get_triggerdef((
        SELECT oid FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'zz_before_normalize_zero_financial_fields'
    )) NOT LIKE '%UPDATE OF status%',
    'zero-financial normalization trigger no longer listens to legacy status'
);

SELECT ok(
    to_regprocedure('public.enforce_zero_order_financials_for_lab_rejected_cancelled()') IS NULL,
    'orphaned legacy zero-obligation function is removed'
);

SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'zz_trigger_enforce_zero_order_financials'
    ),
    'orphaned legacy zero-obligation trigger remains absent'
);

SELECT has_function(
    'public',
    'mirror_order_status_from_v2',
    ARRAY[]::TEXT[],
    'one-way V2-to-legacy mirror function exists'
);

SELECT ok(
    pg_get_triggerdef((
        SELECT oid FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'zzzz_mirror_order_status_from_v2'
    )) LIKE '%BEFORE INSERT OR UPDATE OF production_status, issue_state%'
    AND pg_get_triggerdef((
        SELECT oid FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'zzzz_mirror_order_status_from_v2'
    )) LIKE '%INSERT%',
    'legacy mirror is the sole compatibility writer for V2 inserts and updates'
);

SELECT ok(
    pg_get_functiondef('public.apply_order_issue_transition_v2(uuid,text,text,uuid,text,numeric,text,text,text)'::regprocedure)
        NOT LIKE '%status = CASE p_operation%',
    'issue transition RPC no longer writes legacy status directly'
);

SELECT ok(
    pg_get_functiondef('public.record_order_final_delivery_v2(uuid,timestamptz,uuid)'::regprocedure)
        NOT LIKE '%status = ''Delivered''%',
    'final-delivery RPC writes the V2 production axis only'
);

SELECT ok(
    pg_get_functiondef('public.submit_order_design_v2(uuid,text,uuid)'::regprocedure)
        NOT LIKE '%status = ''Under Production''%',
    'design submission RPC writes the V2 production axis only'
);

SELECT ok(
    pg_get_functiondef('public.admin_reject_order_from_tech_status_v2(uuid,text,uuid,text,text)'::regprocedure)
        NOT LIKE '%status = ''Lab Rejected''%',
    'admin lab-rejection RPC writes the V2 issue axis only'
);

SELECT ok(
    pg_get_functiondef('public.review_designer_rejection_v2(uuid,text,text,uuid,text,text)'::regprocedure)
        NOT LIKE '%status = ''Lab Rejected''%',
    'designer rejection review writes the V2 issue axis only'
);

SELECT ok(
    pg_get_functiondef('public.apply_order_rejection_atomic(uuid,text,text,numeric,text,text)'::regprocedure)
        NOT LIKE '%SET status = p_target_status%',
    'compatibility rejection RPC leaves legacy status to the mirror'
);

SELECT ok(
    pg_get_functiondef('public.update_order_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure)
        NOT LIKE '%status = CASE WHEN p_updates ? ''status''%',
    'generic atomic update cannot write legacy status'
);

SELECT ok(
    pg_get_functiondef('public.update_order_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure)
        LIKE '%Legacy order status writes are not allowed%',
    'generic atomic update rejects legacy status payloads explicitly'
);

SELECT ok(
    pg_get_functiondef('public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)'::regprocedure)
        NOT LIKE '%status                            = ''Delivered''%'
    AND pg_get_functiondef('public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)'::regprocedure)
        NOT LIKE '%status                            = v_target_status%',
    'admin issue correction leaves both compatibility writes to the mirror'
);

SELECT ok(
    pg_get_functiondef('public.create_redo_order_atomic(uuid,text,text,numeric,numeric)'::regprocedure)
        NOT LIKE '%SET status = ''Doctor Rejected''%',
    'legacy redo compatibility RPC updates the original through V2 axes'
);

SELECT ok(
    pg_get_functiondef('public.create_redo_order_atomic_v2(uuid,text,text,text,numeric,uuid,text,text)'::regprocedure)
        NOT LIKE '%status = ''Doctor Rejected'', production_status%',
    'V2 redo RPC updates the original through V2 axes'
);

SELECT has_column('public', 'orders', 'intake_state', 'portal intake has an explicit V2 axis');

SELECT col_default_is(
    'public', 'orders', 'intake_state', 'accepted',
    'ordinary and historical orders default to accepted intake'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.orders'::regclass
          AND conname = 'orders_intake_state_check'
          AND pg_get_constraintdef(oid) LIKE '%pending_review%accepted%'
    ),
    'intake state accepts only pending_review or accepted'
);

SELECT has_function(
    'public', 'derive_order_display_status_v2',
    ARRAY['text', 'text', 'text'],
    'SQL display derivation accepts the explicit intake axis'
);

SELECT ok(
    pg_get_functiondef('public.sync_production_from_order(uuid)'::regprocedure)
        NOT LIKE '%o.status%',
    'production synchronization reads V2 workflow and intake axes only'
);

SELECT ok(
    to_regprocedure('public.get_doctor_portal_cases()') IS NULL
    OR pg_get_functiondef('public.get_doctor_portal_cases()'::regprocedure)
        NOT LIKE '%o.status%',
    'doctor portal projection reads V2 workflow and intake axes only when installed'
);

SELECT ok(
    pg_get_functiondef('public.build_order_accounting_snapshot(public.orders)'::regprocedure)
        NOT LIKE '%p_order.status%',
    'accounting snapshots read V2 workflow axes instead of legacy status'
);

SELECT ok(
    pg_get_functiondef('public.reopen_registered_order_for_accounting()'::regprocedure)
        NOT LIKE '%NEW.status%'
    AND pg_get_functiondef('public.reopen_registered_order_for_accounting()'::regprocedure)
        NOT LIKE '%OLD.status%',
    'accounting review trigger ignores the legacy projection'
);

UPDATE public.app_settings
SET value = 'on'
WHERE key = 'workflow_status_legacy_mirror';

INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name)
VALUES (
    '1f000000-0000-0000-0000-000000000001',
    'Status mirror doctor', '01000000991', 'Test', 'STATUS-MIRROR', ''
);

INSERT INTO public.orders(
    id, case_id, doctor_id, patient_name, items, total_price, shade,
    delivery_date, cost, production_status, issue_state, intake_state
) VALUES (
    '2f000000-0000-0000-0000-000000000001', 'STATUS-MIRROR-1',
    '1f000000-0000-0000-0000-000000000001', 'Status mirror patient',
    '[]', 0, 'A1', CURRENT_DATE, 0, 'not_started', 'none', 'pending_review'
);

SELECT throws_ok(
    $$UPDATE public.orders
      SET status = 'Delivered'
      WHERE id = '2f000000-0000-0000-0000-000000000001'$$,
    '22023',
    'Legacy order status writes are not allowed; update workflow V2 axes instead.',
    'direct legacy status UPDATE statements fail closed'
);

INSERT INTO public.orders(
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, lab_cost, designer_cost, production_status, issue_state
) VALUES (
    '2f000000-0000-0000-0000-000000000002', 'STATUS-ACCOUNTING-1',
    '1f000000-0000-0000-0000-000000000001', 'Stale cancellation label',
    '[]', 100, 'A1', 'Delivered', CURRENT_DATE, 50, 50, 0,
    'final_delivered', 'none'
), (
    '2f000000-0000-0000-0000-000000000003', 'STATUS-ACCOUNTING-2',
    '1f000000-0000-0000-0000-000000000001', 'Stale delivered label',
    '[]', 100, 'A1', 'New Case', CURRENT_DATE, 50, 50, 0,
    'not_started', 'none'
);

SELECT set_config('app.order_issue_operation', 'cancel_order', TRUE);
UPDATE public.orders
SET issue_state = 'cancelled'
WHERE id = '2f000000-0000-0000-0000-000000000003';
SELECT set_config('app.order_issue_operation', '', TRUE);

-- Deliberately simulate stale compatibility metadata without allowing legacy
-- synchronization triggers to rewrite the authoritative V2 axes.
SET LOCAL session_replication_role = replica;
UPDATE public.orders
SET status = 'Cancelled'
WHERE id = '2f000000-0000-0000-0000-000000000002';
UPDATE public.orders
SET status = 'Delivered'
WHERE id = '2f000000-0000-0000-0000-000000000003';
SET LOCAL session_replication_role = origin;

SELECT is(
    public.build_order_accounting_snapshot(
        (SELECT o FROM public.orders o WHERE id = '2f000000-0000-0000-0000-000000000002')
    ),
    jsonb_build_object(
        'status', 'Delivered', 'saleAmount', 100, 'labCost', 50,
        'designCost', 0, 'discount', 0,
        'doctorId', '1f000000-0000-0000-0000-000000000001'::uuid,
        'supplierId', NULL, 'designerId', NULL
    ),
    'stale legacy cancellation cannot zero a V2-delivered accounting snapshot'
);

SELECT is(
    (public.build_order_accounting_snapshot(
        (SELECT o FROM public.orders o WHERE id = '2f000000-0000-0000-0000-000000000003')
    )->>'saleAmount')::numeric,
    0::numeric,
    'V2 cancellation stays zero despite a stale delivered label'
);

UPDATE public.orders
SET needs_accounting_reregistration = TRUE
WHERE id = '2f000000-0000-0000-0000-000000000003';

UPDATE public.orders
SET is_registered = TRUE
WHERE id = '2f000000-0000-0000-0000-000000000003';

SELECT is(
    (SELECT accounting_last_review_type FROM public.orders
     WHERE id = '2f000000-0000-0000-0000-000000000003'),
    'cancellation',
    'accounting review type follows V2 cancellation instead of legacy status'
);

SELECT is(
    (SELECT status FROM public.orders WHERE id = '2f000000-0000-0000-0000-000000000001'),
    'Pending Review',
    'V2 portal intake inserts are mirrored to the compatibility display value'
);

SELECT is(
    (SELECT intake_state FROM public.orders WHERE id = '2f000000-0000-0000-0000-000000000001'),
    'pending_review',
    'portal insert records explicit pending intake without reading legacy status'
);

CREATE TEMP TABLE intake_financial_baseline AS
SELECT jsonb_build_object(
    'obligationCount', (SELECT count(*) FROM public.financial_obligations),
    'obligationNet', (SELECT coalesce(sum(net_amount), 0) FROM public.financial_obligations),
    'allocationCount', (SELECT count(*) FROM public.payment_allocations),
    'allocationAmount', (SELECT coalesce(sum(allocated_amount), 0) FROM public.payment_allocations),
    'transactionCount', (SELECT count(*) FROM public.transactions),
    'transactionAmount', (SELECT coalesce(sum(amount), 0) FROM public.transactions),
    'accountingReviewCount', (SELECT count(*) FROM public.accounting_review_changes)
) AS snapshot;

UPDATE public.orders
SET production_status = 'designing', intake_state = 'accepted'
WHERE id = '2f000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT status FROM public.orders WHERE id = '2f000000-0000-0000-0000-000000000001'),
    'Under Design',
    'V2 production updates mirror to the legacy display value while enabled'
);

SELECT is(
    (SELECT snapshot FROM intake_financial_baseline),
    jsonb_build_object(
        'obligationCount', (SELECT count(*) FROM public.financial_obligations),
        'obligationNet', (SELECT coalesce(sum(net_amount), 0) FROM public.financial_obligations),
        'allocationCount', (SELECT count(*) FROM public.payment_allocations),
        'allocationAmount', (SELECT coalesce(sum(allocated_amount), 0) FROM public.payment_allocations),
        'transactionCount', (SELECT count(*) FROM public.transactions),
        'transactionAmount', (SELECT coalesce(sum(amount), 0) FROM public.transactions),
        'accountingReviewCount', (SELECT count(*) FROM public.accounting_review_changes)
    ),
    'accepting portal intake changes no obligation, allocation, transaction, or accounting-review totals'
);

UPDATE public.app_settings
SET value = 'off'
WHERE key = 'workflow_status_legacy_mirror';

UPDATE public.orders
SET production_status = 'in_production'
WHERE id = '2f000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT status FROM public.orders WHERE id = '2f000000-0000-0000-0000-000000000001'),
    'Under Design',
    'disabled mirror leaves the compatibility column untouched'
);

UPDATE public.app_settings
SET value = 'on'
WHERE key = 'workflow_status_legacy_mirror';

UPDATE public.orders
SET production_status = production_status
WHERE id = '2f000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT status FROM public.orders WHERE id = '2f000000-0000-0000-0000-000000000001'),
    'Under Production',
    're-enabled mirror repairs a compatibility value on an explicit V2 write'
);

SELECT * FROM finish();
ROLLBACK;
