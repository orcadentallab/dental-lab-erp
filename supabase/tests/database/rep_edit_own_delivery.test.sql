BEGIN;
SET search_path = public, extensions;
SELECT plan(7);

SELECT is(public.order_edit_requires_admin_approval(jsonb_populate_record(
    NULL::public.orders,
    '{"is_redo":true,"original_order_id":"40000000-0000-0000-0000-000000000101","production_status":"not_started","status":"Delivered"}'
)), FALSE, 'undelivered remake does not inherit delivery from parent or legacy status');

SELECT is(public.order_edit_requires_admin_approval(jsonb_populate_record(
    NULL::public.orders, '{"is_redo":true,"production_status":"final_delivered"}'
)), TRUE, 'delivered replacement still requires approval');

SELECT is(public.order_edit_requires_admin_approval(jsonb_populate_record(
    NULL::public.orders,
    '{"is_redo":true,"production_status":"not_started","issue_state":"returned","first_delivered_at":"2026-10-01T10:00:00Z"}'
)), TRUE, 'replacement with its own first delivery remains protected after return');

SELECT is(public.order_edit_requires_admin_approval(jsonb_populate_record(
    NULL::public.orders, '{"actual_delivery_date":"2026-10-01"}'
)), TRUE, 'actual delivery on the edited case requires approval');

SELECT is(public.order_edit_requires_admin_approval(jsonb_populate_record(
    NULL::public.orders, '{"legacy_delivery_confirmed":true}'
)), TRUE, 'reviewed historical delivery on the edited case requires approval');

SELECT is(public.order_edit_requires_admin_approval(jsonb_populate_record(
    NULL::public.orders, '{"production_status":"final_ready","delivery_date":"2026-10-01"}'
)), FALSE, 'readiness and scheduled delivery are not actual delivery');

SELECT ok(strpos(pg_get_functiondef(
    'public.rep_update_order_fields_with_audit(uuid,jsonb,text,text)'::regprocedure
), 'AND public.order_edit_requires_admin_approval(v_old) THEN') > 0,
    'representative RPC gates approval using the locked edited row');

SELECT * FROM finish();
ROLLBACK;
