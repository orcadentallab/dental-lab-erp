-- Admin correction of a wrongly recorded issue state
-- (20260825000000_admin_correct_order_issue_state.sql).
--
-- The point of the feature is that money is NOT moved by hand: putting the
-- order row back into the state it should have had must be enough for
-- sync_order_financial_obligations to rebuild every obligation. So the
-- assertions below check the resulting obligations, not just the columns.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(45);

SELECT has_function(
    'public', 'admin_correct_order_issue_state_v2',
    ARRAY['uuid', 'text', 'text', 'uuid', 'text', 'numeric', 'text', 'text'],
    'admin issue-state correction RPC exists'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)', 'EXECUTE'),
    'anonymous callers cannot correct an issue state'
);
SELECT ok(
    has_function_privilege('authenticated', 'public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)', 'EXECUTE'),
    'signed-in callers reach the RPC, where the admin check lives'
);
SELECT ok(
    pg_get_functiondef('public.guard_order_issue_transition_v2()'::regprocedure)
        LIKE '%admin_correct_issue_state%',
    'the transition guard recognises the correction operation'
);
SELECT has_function(
    'public', 'is_observed_first_delivery_source', ARRAY['text'],
    'the observed-vs-inferred delivery evidence rule is a named function'
);
SELECT ok(
    NOT public.is_observed_first_delivery_source('accounting_snapshot_inferred')
    AND public.is_observed_first_delivery_source('direct_transition'),
    'an accounting-registration timestamp is not treated as an observed delivery'
);
SELECT ok(
    pg_get_functiondef('public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)'::regprocedure)
        NOT LIKE '%financial_obligations%',
    'the correction never writes an obligation by hand'
);

UPDATE public.app_settings SET value = 'on' WHERE key = 'workflow_issue_v2_write';
UPDATE public.app_settings SET value = 'on' WHERE key = 'workflow_issue_v2_enforce';

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('99100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'correct-admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('99100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'correct-rep@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('39100000-0000-0000-0000-000000000001', '99100000-0000-0000-0000-000000000001',
     'correct_admin', 'admin', 'Correction Admin'),
    ('39100000-0000-0000-0000-000000000002', '99100000-0000-0000-0000-000000000002',
     'correct_rep', 'representative', 'Correction Representative');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES (
    '19100000-0000-0000-0000-000000000001', 'Correction Doctor',
    '01000000010', 'Test', 'CORRECT', 'Correction Rep'
);

INSERT INTO public.suppliers (id, name, phone) VALUES
    ('29100000-0000-0000-0000-000000000001', 'Correction Supplier', '01000000011');

-- A doctor of their own, holding exactly ONE order. Credits are pooled per
-- doctor account and re-applied FIFO, so a shared doctor would let the
-- returning credit land on a different case and make the assertion ambiguous.
INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES (
    '19100000-0000-0000-0000-000000000002', 'Paid Correction Doctor',
    '01000000012', 'Test', 'CORRECT-PAID', 'Correction Rep'
);

-- A case that will be delivered and then wrongly marked as a doctor
-- rejection. Every fixture below is inserted UNDELIVERED and then delivered
-- through record_order_final_delivery_v2: guard_order_issue_transition_v2
-- rejects any INSERT that carries first_delivered_at, so a hand-stamped
-- delivery timestamp is not a shortcut the database allows.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, technician_status,
    production_status, issue_state
) VALUES (
    '49100000-0000-0000-0000-000000000001', 'CORRECT-MISCLICK',
    '19100000-0000-0000-0000-000000000001', 'Misclick Patient', '[]',
    1000, 'A1', 'Ready', CURRENT_DATE, 400,
    '29100000-0000-0000-0000-000000000001', 'Pending', 'final_ready', 'none'
);

-- A pre-delivery case cancelled by mistake.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, technician_status, production_status, issue_state
) VALUES (
    '49100000-0000-0000-0000-000000000002', 'CORRECT-CANCELLED',
    '19100000-0000-0000-0000-000000000001', 'Cancelled Patient', '[]',
    800, 'A1', 'Under Production', CURRENT_DATE, 300, 'Pending',
    'in_production', 'none'
);

-- A delivered case rejected at ZERO doctor cost. Correcting it to a return
-- is the trap case: `returned` is the one state the financial owner
-- PRESERVES instead of recomputing, so a naive single write would freeze the
-- zero in place on a case the doctor actually owes in full.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, technician_status,
    production_status, issue_state
) VALUES (
    '49100000-0000-0000-0000-000000000003', 'CORRECT-ZERO-REJECT',
    '19100000-0000-0000-0000-000000000001', 'Zero Reject Patient', '[]',
    1200, 'A1', 'Ready', CURRENT_DATE, 500,
    '29100000-0000-0000-0000-000000000001', 'Pending', 'final_ready', 'none'
);

-- A legacy case whose delivery evidence is INFERRED: 20260808002000 stamps
-- first_delivered_source = 'accounting_snapshot_inferred' from
-- accounting_registered_at, which says delivery happened but not when. A
-- return clears actual_delivery_date, and clearing the return must NOT
-- resurrect it from that inferred timestamp — doing so silently moved a real
-- January case into July (production, 2026-08-25).
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, technician_status,
    production_status, issue_state
) VALUES (
    '49100000-0000-0000-0000-000000000006', 'CORRECT-INFERRED',
    '19100000-0000-0000-0000-000000000001', 'Inferred Evidence Patient', '[]',
    500, 'A1', 'Ready', CURRENT_DATE - 200, 200,
    '29100000-0000-0000-0000-000000000001', 'Pending', 'final_ready', 'none'
);

-- A delivered case wrongly returned for adjustment. The return CLEARS
-- actual_delivery_date, so clearing the issue has to put it back: a
-- final_delivered order with no delivery date silently reprices the
-- statement date and the obligation due date onto the PLANNED delivery_date,
-- which is why delivery_date here is deliberately far in the future.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, technician_status,
    production_status, issue_state
) VALUES (
    '49100000-0000-0000-0000-000000000004', 'CORRECT-RETURNED',
    '19100000-0000-0000-0000-000000000001', 'Returned Patient', '[]',
    900, 'A1', 'Ready', CURRENT_DATE + 30, 350,
    '29100000-0000-0000-0000-000000000001', 'Pending', 'final_ready', 'none'
);

-- A delivered case the doctor has already PART-PAID, then rejected at zero
-- doctor cost. The rejection voids the receivable, which turns the payment
-- into an account credit. Clearing the issue must rebuild the receivable AND
-- pull that credit back onto it — otherwise the lab silently loses track of
-- money it already collected.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, technician_status,
    production_status, issue_state
) VALUES (
    '49100000-0000-0000-0000-000000000005', 'CORRECT-PART-PAID',
    '19100000-0000-0000-0000-000000000002', 'Part Paid Patient', '[]',
    1000, 'A1', 'Ready', CURRENT_DATE, 400,
    '29100000-0000-0000-0000-000000000001', 'Pending', 'final_ready', 'none'
);

SELECT set_config('request.jwt.claim.sub', '99100000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

-- Real deliveries, so first_delivered_at / first_delivered_source are what the
-- workflow actually records rather than something the fixture invented.
SELECT public.record_order_final_delivery_v2(
    '49100000-0000-0000-0000-000000000001', timezone('utc', now()),
    '89100000-0000-0000-0000-000000000020');
SELECT public.record_order_final_delivery_v2(
    '49100000-0000-0000-0000-000000000003', timezone('utc', now()),
    '89100000-0000-0000-0000-000000000021');
SELECT public.record_order_final_delivery_v2(
    '49100000-0000-0000-0000-000000000006', timezone('utc', now()),
    '89100000-0000-0000-0000-000000000022');
RESET ROLE;

-- Downgrade the legacy case's evidence to the inferred source the backfill
-- produces. Only first_delivered_source changes, which no guard restricts.
UPDATE public.orders
SET first_delivered_source = 'accounting_snapshot_inferred'
WHERE id = '49100000-0000-0000-0000-000000000006';

SELECT set_config('request.jwt.claim.sub', '99100000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
    $$SELECT public.apply_order_issue_transition_v2(
        '49100000-0000-0000-0000-000000000001', 'doctor_reject_order',
        'Recorded in error', '89100000-0000-0000-0000-000000000001',
        'full_price', NULL, 'Correction Admin', 'fit', 'external_lab'
    )$$,
    'the mistaken doctor rejection is recorded through the normal RPC'
);
SELECT lives_ok(
    $$SELECT public.apply_order_issue_transition_v2(
        '49100000-0000-0000-0000-000000000002', 'cancel_order',
        'Cancelled in error', '89100000-0000-0000-0000-000000000002',
        NULL, NULL, 'Correction Admin', 'duplicate_order', 'doctor'
    )$$,
    'the mistaken cancellation is recorded through the normal RPC'
);

-- The workflow itself must stay one-way: only the correction RPC may leave.
SELECT throws_like(
    $$SELECT public.apply_order_issue_transition_v2(
        '49100000-0000-0000-0000-000000000001', 'return_for_adjustment',
        'Try to walk back', '89100000-0000-0000-0000-000000000003',
        NULL, NULL, 'Correction Admin', 'fit', 'external_lab'
    )$$,
    '%terminal issue state%',
    'the ordinary workflow still refuses to leave a terminal issue state'
);

SELECT throws_like(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000001', 'none', '   ',
        '89100000-0000-0000-0000-000000000004'
    )$$,
    '%سبب التصحيح مطلوب%',
    'a correction without a stated reason is refused'
);
SELECT throws_like(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000001', 'cancelled', 'Wrong target',
        '89100000-0000-0000-0000-000000000005'
    )$$,
    '%إلغاء أو رفض معمل%',
    'a delivered case cannot be corrected into a zero-impact issue'
);
SELECT throws_like(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000002', 'doctor_rejected', 'Wrong target',
        '89100000-0000-0000-0000-000000000006', 'full_price'
    )$$,
    '%تسليماً سابقاً%',
    'an undelivered case cannot be corrected into a post-delivery issue'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '99100000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;
SELECT throws_like(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000001', 'none', 'Rep tries to correct',
        '89100000-0000-0000-0000-000000000007'
    )$$,
    '%admin role required%',
    'a representative cannot correct an issue state'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '99100000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000001', 'none',
        'Rejection was recorded on the wrong case',
        '89100000-0000-0000-0000-000000000008'
    )$$,
    'admin clears a wrongly recorded doctor rejection'
);
SELECT lives_ok(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000001', 'none',
        'Rejection was recorded on the wrong case',
        '89100000-0000-0000-0000-000000000008'
    )$$,
    'the correction is idempotent on retry with the same key'
);
SELECT lives_ok(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000002', 'lab_rejected',
        'It was an internal lab rejection, not a cancellation',
        '89100000-0000-0000-0000-000000000009', NULL, NULL, 'prep', 'doctor'
    )$$,
    'admin changes the TYPE of a wrongly classified pre-delivery issue'
);

SELECT lives_ok(
    $$SELECT public.apply_order_issue_transition_v2(
        '49100000-0000-0000-0000-000000000003', 'doctor_reject_order',
        'Rejected at zero doctor cost', '89100000-0000-0000-0000-00000000000a',
        'zero', NULL, 'Correction Admin', 'shade', 'external_lab'
    )$$,
    'a rejection that charges the doctor nothing is recorded'
);
SELECT lives_ok(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000003', 'returned',
        'It was only a return for adjustment',
        '89100000-0000-0000-0000-00000000000b', NULL, NULL, 'contact', 'external_lab'
    )$$,
    'admin retypes a zero-cost rejection as a return for adjustment'
);

SELECT lives_ok(
    $$SELECT public.record_order_final_delivery_v2(
        '49100000-0000-0000-0000-000000000004', timezone('utc', now()),
        '89100000-0000-0000-0000-00000000000c'
    )$$,
    'the case is delivered through the normal RPC'
);
SELECT lives_ok(
    $$SELECT public.apply_order_issue_transition_v2(
        '49100000-0000-0000-0000-000000000004', 'return_for_adjustment',
        'Returned in error', '89100000-0000-0000-0000-00000000000d',
        NULL, NULL, 'Correction Admin', 'contact', 'external_lab'
    )$$,
    'the mistaken return for adjustment is recorded'
);
SELECT lives_ok(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000004', 'none',
        'The case was never returned', '89100000-0000-0000-0000-00000000000e'
    )$$,
    'admin clears a wrongly recorded return for adjustment'
);
RESET ROLE;

SELECT is(
    (SELECT actual_delivery_date
     FROM public.orders WHERE id = '49100000-0000-0000-0000-000000000004'),
    CURRENT_DATE,
    'clearing a return restores the real delivery date the return had wiped'
);

-- ── Inferred delivery evidence must never become a delivery date ────────
SELECT set_config('request.jwt.claim.sub', '99100000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
    $$SELECT public.apply_order_issue_transition_v2(
        '49100000-0000-0000-0000-000000000006', 'return_for_adjustment',
        'Returned in error', '89100000-0000-0000-0000-000000000023',
        NULL, NULL, 'Correction Admin', 'contact', 'external_lab'
    )$$,
    'the legacy case with inferred evidence is returned by mistake'
);
SELECT lives_ok(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000006', 'none',
        'The return was a misclick', '89100000-0000-0000-0000-000000000024'
    )$$,
    'admin clears the return on the legacy case'
);
RESET ROLE;

SELECT ok(
    (SELECT actual_delivery_date IS NULL AND first_delivered_at IS NOT NULL
     FROM public.orders WHERE id = '49100000-0000-0000-0000-000000000006'),
    'inferred evidence still proves delivery, but is never promoted into a delivery date'
);

-- ── Part-paid case: reject at zero, then clear the issue ────────────────
SELECT set_config('request.jwt.claim.sub', '99100000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
    $$SELECT public.record_order_final_delivery_v2(
        '49100000-0000-0000-0000-000000000005', timezone('utc', now()),
        '89100000-0000-0000-0000-00000000000f'
    )$$,
    'the part-paid case is delivered through the normal RPC'
);
RESET ROLE;

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type,
    status, is_approved
) VALUES (
    '59100000-0000-0000-0000-000000000001', 'income', 400, 'collection',
    CURRENT_DATE, 'Partial collection before the mistaken rejection',
    '19100000-0000-0000-0000-000000000002', 'doctor', 'approved', TRUE
);

SELECT is(
    (SELECT COALESCE(SUM(allocated_amount), 0)::numeric
     FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000005'
       AND entity_type = 'doctor' AND status NOT IN ('void', 'written_off')),
    400::numeric,
    'the collection is allocated against the delivered receivable'
);

SELECT set_config('request.jwt.claim.sub', '99100000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
    $$SELECT public.apply_order_issue_transition_v2(
        '49100000-0000-0000-0000-000000000005', 'doctor_reject_order',
        'Rejected at zero by mistake', '89100000-0000-0000-0000-000000000010',
        'zero', NULL, 'Correction Admin', 'fit', 'external_lab'
    )$$,
    'the part-paid case is wrongly rejected at zero doctor cost'
);
RESET ROLE;

SELECT is(
    (SELECT COALESCE(SUM(remaining_amount), 0)::numeric
     FROM public.account_credits
     WHERE entity_id = '19100000-0000-0000-0000-000000000002' AND status = 'active'),
    400::numeric,
    'voiding the receivable parks the collected money as an account credit'
);

SELECT set_config('request.jwt.claim.sub', '99100000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
    $$SELECT public.admin_correct_order_issue_state_v2(
        '49100000-0000-0000-0000-000000000005', 'none',
        'The rejection was a misclick', '89100000-0000-0000-0000-000000000011'
    )$$,
    'admin clears the rejection on the part-paid case'
);
RESET ROLE;

SELECT is(
    (SELECT COALESCE(SUM(net_amount), 0)::numeric
     FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000005'
       AND entity_type = 'doctor' AND status NOT IN ('void', 'written_off')),
    1000::numeric,
    'the voided doctor receivable is rebuilt at the full delivered value'
);
SELECT is(
    (SELECT COALESCE(SUM(allocated_amount), 0)::numeric
     FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000005'
       AND entity_type = 'doctor' AND status NOT IN ('void', 'written_off')),
    400::numeric,
    'the parked credit is pulled back onto the rebuilt receivable'
);
SELECT is(
    (SELECT COALESCE(SUM(remaining_amount), 0)::numeric
     FROM public.account_credits
     WHERE entity_id = '19100000-0000-0000-0000-000000000002' AND status = 'active'),
    0::numeric,
    'no collected money is left stranded as an unapplied credit'
);
SELECT is(
    (SELECT COALESCE(SUM(net_amount), 0)::numeric
     FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000005'
       AND entity_type = 'external_lab' AND status NOT IN ('void', 'written_off')),
    400::numeric,
    'the external lab payable the rejection removed is rebuilt too'
);
SELECT is(
    (SELECT COALESCE(SUM(net_amount), 0)::numeric
     FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000004'
       AND status NOT IN ('void', 'written_off')),
    1250::numeric,
    'a returned case keeps its doctor receivable and lab payable throughout'
);

SELECT is(
    (SELECT COALESCE(SUM(net_amount), 0)::numeric
     FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000003'
       AND entity_type = 'doctor' AND direction = 'receivable'
       AND status NOT IN ('void', 'written_off')),
    1200::numeric,
    'retyping to a return restores the full delivered receivable, not the frozen zero'
);

SELECT is(
    (SELECT status || ':' || issue_state || ':' || production_status
     FROM public.orders WHERE id = '49100000-0000-0000-0000-000000000001'),
    'Delivered:none:final_delivered',
    'clearing the issue restores the delivered case to its evidenced state'
);
SELECT ok(
    (SELECT rejection_doctor_decision IS NULL
            AND rejected_doctor_amount IS NULL
            AND rejection_financial_review_status IS NULL
     FROM public.orders WHERE id = '49100000-0000-0000-0000-000000000001'),
    'clearing the issue also clears every rejection settlement field'
);

-- The whole point: the obligations follow the corrected row on their own.
SELECT is(
    (SELECT COALESCE(SUM(net_amount), 0)::numeric
     FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000001'
       AND entity_type = 'doctor' AND direction = 'receivable'
       AND status NOT IN ('void', 'written_off')),
    1000::numeric,
    'the doctor receivable is rebuilt at the full delivered order value'
);
SELECT is(
    (SELECT count(*)::integer FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000001'
       AND trigger_type = 'external_lab_issue_settlement'
       AND status NOT IN ('void', 'written_off')
       AND COALESCE(net_amount, 0) <> 0),
    0,
    'no rejection settlement obligation survives the correction'
);
SELECT is(
    (SELECT count(*)::integer FROM public.financial_obligations
     WHERE order_id = '49100000-0000-0000-0000-000000000002'
       AND status NOT IN ('void', 'written_off')
       AND COALESCE(net_amount, 0) <> 0),
    0,
    'a lab-rejected case keeps its zero financial footprint after retyping'
);

SELECT ok(
    (SELECT bool_and(is_voided) FROM public.order_issues
     WHERE order_id = '49100000-0000-0000-0000-000000000001'
       AND issue_type = 'doctor_rejected'),
    'the mis-filed issue log row is voided, so the reports stop counting it'
);
SELECT is(
    (SELECT count(*)::integer FROM public.order_events
     WHERE order_id = '49100000-0000-0000-0000-000000000001'
       AND event_type = 'issue_state_corrected'),
    1,
    'the idempotent retry writes exactly one correction audit event'
);
SELECT ok(
    (SELECT NOT is_registered
     FROM public.orders WHERE id = '49100000-0000-0000-0000-000000000001'),
    'a corrected order is not left registered on the stale numbers'
);

ROLLBACK;
