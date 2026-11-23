BEGIN;
SET search_path TO public, extensions;
SELECT plan(5);

INSERT INTO auth.users(id, email) VALUES
    ('51ce0000-0000-4000-8000-000000000001', 'scanner-rep@example.test'),
    ('51ce0000-0000-4000-8000-000000000002', 'scanner-coordinator@example.test');
INSERT INTO public.users(id, auth_id, username, role, name) VALUES
    ('51ce0000-0000-4000-8000-000000000001', '51ce0000-0000-4000-8000-000000000001', 'scanner_rep', 'representative', 'Scanner rep'),
    ('51ce0000-0000-4000-8000-000000000002', '51ce0000-0000-4000-8000-000000000002', 'scanner_coordinator', 'coordinator', 'Scanner coordinator');
INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name)
VALUES ('51ce0000-0000-4000-8000-000000000010', 'Scanner doctor', '01012341234', 'Test', 'SCAN-RENT', 'Scanner rep');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51ce0000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$
    INSERT INTO public.adjustments (entity_type, entity_id, amount, type, reason)
    VALUES ('doctor', '51ce0000-0000-4000-8000-000000000010', 500, 'charge', 'Scanner Rent')
    RETURNING *
$$, 'Representative can record and receive the inserted doctor charge');
SELECT throws_ok($$
    INSERT INTO public.adjustments (entity_type, entity_id, amount, type, reason)
    VALUES ('doctor', '51ce0000-0000-4000-8000-000000000010', 500, 'charge', 'Other charge')
$$, '42501', NULL, 'Representative cannot record another charge');
SELECT throws_ok($$
    INSERT INTO public.adjustments (entity_type, entity_id, amount, type, reason)
    VALUES ('doctor', '51ce0000-0000-4000-8000-000000000010', 500, 'credit', 'Scanner Rent')
$$, '42501', NULL, 'Representative cannot record a scanner rental credit');
SELECT throws_ok($$
    INSERT INTO public.adjustments (entity_type, entity_id, amount, type, reason)
    VALUES ('doctor', '51ce0000-0000-4000-8000-000000000099', 500, 'charge', 'Scanner Rent')
$$, '42501', NULL, 'Representative cannot charge a nonexistent doctor');

SELECT set_config('request.jwt.claim.sub', '51ce0000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$
    INSERT INTO public.adjustments (entity_type, entity_id, amount, type, reason)
    VALUES ('doctor', '51ce0000-0000-4000-8000-000000000010', 300, 'charge', 'Scanner Rent - Test notes')
    RETURNING *
$$, 'Coordinator can record and receive the inserted charge with notes');

SELECT * FROM finish();
ROLLBACK;
