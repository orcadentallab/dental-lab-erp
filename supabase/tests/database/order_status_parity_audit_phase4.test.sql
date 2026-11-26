BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

SELECT plan(20);

SELECT has_view('public', 'workflow_v2_status_parity_audit', 'phase 4 exposes a read-only per-order parity report');
SELECT has_view('public', 'workflow_v2_status_parity_review', 'phase 4 exposes only rows requiring review');
SELECT has_view('public', 'workflow_v2_status_parity_gate', 'phase 4 exposes one mirror-off gate row');

SELECT has_column('public', 'workflow_v2_status_parity_audit', 'legacy_status', 'audit includes the current legacy value');
SELECT has_column('public', 'workflow_v2_status_parity_audit', 'derived_status', 'audit includes the V2 presentation value');
SELECT has_column('public', 'workflow_v2_status_parity_audit', 'presentation_mismatch_reason', 'presentation mismatch has an explicit reason');
SELECT has_column('public', 'workflow_v2_status_parity_audit', 'legacy_confirmed_without_timestamp', 'legacy confirmation without invented delivery time is visible');
SELECT has_column('public', 'workflow_v2_status_parity_audit', 'financial_effect_differs', 'financial parity is separate from presentation parity');
SELECT has_column('public', 'workflow_v2_status_parity_audit', 'requires_review', 'unresolved rows fail the audit gate');

SELECT ok(
    has_table_privilege('anon', 'public.workflow_v2_status_parity_audit', 'SELECT') = FALSE
    AND has_table_privilege('authenticated', 'public.workflow_v2_status_parity_audit', 'SELECT') = FALSE,
    'parity evidence is not exposed to application roles'
);

UPDATE public.app_settings
SET value = 'off'
WHERE key = 'workflow_status_legacy_mirror';

INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name)
VALUES (
    '1f400000-0000-0000-0000-000000000001',
    'Phase 4 parity doctor', '01000004999', 'Test', 'PHASE4-PARITY', ''
);

INSERT INTO public.orders(
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, intake_state,
    legacy_delivery_confirmed
) VALUES
(
    '2f400000-0000-0000-0000-000000000001', 'PHASE4-MATCH',
    '1f400000-0000-0000-0000-000000000001', 'Matching delivered', '[]',
    0, 'A1', 'Delivered', CURRENT_DATE, 0, 'final_delivered', 'none', 'accepted', FALSE
),
(
    '2f400000-0000-0000-0000-000000000002', 'PHASE4-STALE',
    '1f400000-0000-0000-0000-000000000001', 'Stale legacy new case', '[]',
    0, 'A1', 'New Case', CURRENT_DATE, 0, 'final_delivered', 'none', 'accepted', FALSE
),
(
    '2f400000-0000-0000-0000-000000000003', 'PHASE4-REDO',
    '1f400000-0000-0000-0000-000000000001', 'Expected redo alias', '[]',
    0, 'A1', 'Doctor Rejected', CURRENT_DATE, 0, 'final_delivered', 'none', 'accepted', FALSE
),
(
    '2f400000-0000-0000-0000-000000000004', 'PHASE4-LEGACY-CONFIRMED',
    '1f400000-0000-0000-0000-000000000001', 'Confirmed without timestamp', '[]',
    0, 'A1', 'Doctor Rejected', CURRENT_DATE, 0, 'final_delivered', 'none', 'accepted', FALSE
),
(
    '2f400000-0000-0000-0000-000000000005', 'PHASE4-UNRESOLVED',
    '1f400000-0000-0000-0000-000000000001', 'Unresolved historical evidence', '[]',
    0, 'A1', 'New Case', CURRENT_DATE, 0, 'not_started', 'none', 'accepted', FALSE
);

-- Simulate evidence already reviewed during the historical backfill. The
-- production workflow permits this flag only through its admin RPC; this test
-- is validating the read-only audit classification, not that RPC itself.
SET LOCAL session_replication_role = replica;
UPDATE public.orders
SET issue_state = 'redo',
    first_delivered_at = created_at,
    first_delivered_source = 'status_history'
WHERE id = '2f400000-0000-0000-0000-000000000003';
UPDATE public.orders
SET issue_state = 'doctor_rejected',
    legacy_delivery_confirmed = TRUE
WHERE id = '2f400000-0000-0000-0000-000000000004';
SET LOCAL session_replication_role = origin;

INSERT INTO public.workflow_v2_backfill_review(order_id, review_type, evidence)
VALUES (
    '2f400000-0000-0000-0000-000000000005',
    'unresolved_delivery_history',
    '{"phase":"phase4-test"}'::jsonb
);

SELECT is(
    (SELECT derived_status FROM public.workflow_v2_status_parity_audit
     WHERE order_id = '2f400000-0000-0000-0000-000000000001'),
    'Delivered',
    'matching row derives Delivered from V2 axes'
);

SELECT ok(
    (SELECT NOT presentation_mismatch AND NOT financial_effect_differs AND NOT requires_review
     FROM public.workflow_v2_status_parity_audit
     WHERE order_id = '2f400000-0000-0000-0000-000000000001'),
    'matching row is clean in both presentation and financial dimensions'
);

SELECT is(
    (SELECT presentation_mismatch_reason FROM public.workflow_v2_status_parity_audit
     WHERE order_id = '2f400000-0000-0000-0000-000000000002'),
    'legacy_status_differs_from_v2',
    'stale legacy text has an unexplained presentation mismatch reason'
);

SELECT ok(
    (SELECT presentation_mismatch AND financial_effect_differs AND requires_review
     FROM public.workflow_v2_status_parity_audit
     WHERE order_id = '2f400000-0000-0000-0000-000000000002'),
    'stale New Case versus delivered V2 axes is both presentation and financial review work'
);

SELECT is(
    (SELECT presentation_mismatch_reason FROM public.workflow_v2_status_parity_audit
     WHERE order_id = '2f400000-0000-0000-0000-000000000003'),
    'expected_redo_legacy_alias',
    'Redo keeps its explicit, explained legacy Doctor Rejected alias'
);

SELECT ok(
    (SELECT presentation_mismatch AND NOT financial_effect_differs AND NOT requires_review
     FROM public.workflow_v2_status_parity_audit
     WHERE order_id = '2f400000-0000-0000-0000-000000000003'),
    'explained Redo presentation alias does not create financial or manual-review noise'
);

SELECT ok(
    (SELECT legacy_confirmed_without_timestamp AND NOT requires_review
     FROM public.workflow_v2_status_parity_audit
     WHERE order_id = '2f400000-0000-0000-0000-000000000004'),
    'legacy delivery confirmation is reported without inventing a timestamp'
);

SELECT ok(
    (SELECT has_unresolved_legacy_review AND requires_review
     FROM public.workflow_v2_status_parity_audit
     WHERE order_id = '2f400000-0000-0000-0000-000000000005'),
    'unresolved historical evidence remains explicit review work'
);

SELECT is(
    (SELECT count(*)::integer FROM public.workflow_v2_status_parity_review
     WHERE order_id IN (
        '2f400000-0000-0000-0000-000000000001',
        '2f400000-0000-0000-0000-000000000002',
        '2f400000-0000-0000-0000-000000000003',
        '2f400000-0000-0000-0000-000000000004',
        '2f400000-0000-0000-0000-000000000005'
     )),
    2,
    'review view contains only the stale and unresolved rows'
);

SELECT ok(
    (SELECT unexplained_presentation_mismatches >= 1
        AND unresolved_legacy_rows >= 1
        AND financial_differences >= 1
        AND ready_for_mirror_off = FALSE
     FROM public.workflow_v2_status_parity_gate),
    'gate remains closed while any unexplained presentation, legacy, or financial row exists'
);

SELECT * FROM finish();
ROLLBACK;
