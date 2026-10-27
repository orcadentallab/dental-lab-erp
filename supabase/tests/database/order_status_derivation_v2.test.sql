BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

SELECT is(public.derive_order_display_status_v2('not_started', 'none'), 'New Case', 'not_started maps to New Case');
SELECT is(public.derive_order_display_status_v2('designing', 'none'), 'Under Design', 'designing maps to Under Design');
SELECT is(public.derive_order_display_status_v2('in_production', 'none'), 'Under Production', 'in_production maps to Under Production');
SELECT is(public.derive_order_display_status_v2('try_in_ready', 'none'), 'Try In', 'try_in_ready maps to Try In');
SELECT is(public.derive_order_display_status_v2('waiting_doctor', 'none'), 'Waiting Dr Approval', 'waiting_doctor maps to Waiting Dr Approval');
SELECT is(public.derive_order_display_status_v2('finalization', 'none'), 'Try In Approved', 'finalization maps to Try In Approved');
SELECT is(public.derive_order_display_status_v2('final_ready', 'none'), 'Ready', 'final_ready maps to Ready');
SELECT is(public.derive_order_display_status_v2('final_delivered', 'none'), 'Delivered', 'final_delivered maps to Delivered');

SELECT is(public.derive_order_display_status_v2('final_delivered', 'returned'), 'Returned for Adjustments', 'returned overrides production status');
SELECT is(public.derive_order_display_status_v2('not_started', 'doctor_rejected'), 'Doctor Rejected', 'doctor_rejected overrides production status');
SELECT is(public.derive_order_display_status_v2('designing', 'lab_rejected'), 'Lab Rejected', 'lab_rejected overrides production status');
SELECT is(public.derive_order_display_status_v2('in_production', 'cancelled'), 'Cancelled', 'cancelled overrides production status');
SELECT is(public.derive_order_display_status_v2('final_delivered', 'redo'), 'Redo', 'redo has a distinct derived display status');

SELECT is(public.derive_order_display_status_v2('unknown', 'none'), NULL, 'unknown production status fails closed');
SELECT is(public.derive_order_display_status_v2('not_started', 'unknown'), NULL, 'unknown issue state fails closed');
SELECT is(public.derive_order_display_status_v2(NULL, 'none'), NULL, 'missing production status fails closed');
SELECT is(public.derive_order_display_status_v2('not_started', NULL), NULL, 'missing issue state fails closed');

SELECT * FROM finish();
ROLLBACK;
