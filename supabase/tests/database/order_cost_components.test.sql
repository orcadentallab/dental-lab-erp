-- orders.cost splits into lab_cost + designer_cost, and nothing else moves.
--
-- Guards 20260907000000_split_lab_and_designer_cost_components.sql (phase 1).
--
-- The whole value of that migration is a claim about what did NOT happen: the
-- two new columns are pure derivations, so every existing cost, every payable
-- and every accounting registration has to come out the other side untouched.
-- That is not visible in the diff, so it is asserted here.
--
-- Four properties matter:
--
--   1. THE INVARIANT.  cost = lab_cost + designer_cost on every row, whatever
--      mix of manual and automatic prices produced it. This is the one thing
--      phase 2 will read, so if it can drift the whole plan is unsafe.
--   2. THE SALARY RULE.  A fixed-salary designer earns nothing per case, so
--      designer_cost is 0 and the entire cost belongs to the lab. design_price
--      stays populated as the reference figure -- that asymmetry is the exact
--      thing four production readers got wrong, so it is pinned here.
--   3. cost IS NEVER REWRITTEN.  The components are derived FROM cost, so a
--      recompute can rebalance the split but must never change the total.
--   4. THE WRITE DIRECTION FLIPS CLEANLY (phase 3).  A writer that records the
--      two components drives cost from them; a writer that still records only
--      cost keeps working and has the split derived for it; a writer that sends
--      both with disagreeing values is refused rather than silently resolved.
--
-- The accounting-audit ignore list is deliberately NOT asserted here. It only
-- has to hold at the instant the columns go from absent to populated, which is
-- inside the migration itself; by the time any test runs that moment has
-- passed, and any assertion would be theatre.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(16);

-- ─── Fixtures ────────────────────────────────────────────────────────────
-- Two designers: one paid per piece, one on a fixed salary. Every assertion
-- about the per-piece designer has a matching one for the salaried designer,
-- so a failure says which of the two rules broke.

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
    ('c1000000-0000-0000-0000-000000000001', 'perpiece@test.local', 'x', now(), now(), now()),
    ('c1000000-0000-0000-0000-000000000002', 'salaried@test.local', 'x', now(), now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, auth_id, username, name, email, role, custom_permissions)
VALUES
    ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
     'cc_perpiece', 'Per Piece Designer', 'perpiece@test.local', 'designer', '{}'::jsonb),
    ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002',
     'cc_salaried', 'Salaried Designer', 'salaried@test.local', 'designer',
     '{"designer_fixed_salary": true}'::jsonb);

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('c3000000-0000-0000-0000-000000000001', 'Dr Cost Components', '01000000000',
        'Test Clinic', '9901', 'Test Rep');

-- ─── 1. The salaried lookup ──────────────────────────────────────────────

SELECT is(
    public.order_designer_is_salaried('c2000000-0000-0000-0000-000000000001'::uuid),
    FALSE,
    'A1: a designer without the flag is not salaried'
);

SELECT is(
    public.order_designer_is_salaried('c2000000-0000-0000-0000-000000000002'::uuid),
    TRUE,
    'A2: designer_fixed_salary marks the designer as salaried'
);

-- ─── 2. Split case, per-piece designer: cost carries the design price ─────
-- The shape the production bug was reported on: cost 450 is 400 milling plus
-- 50 design, and the card was showing all 450 against the external lab.

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, cost, shade,
    status, delivery_date, workflow_type, designer_id, design_price
) VALUES (
    'c4000000-0000-0000-0000-000000000001', 'CASE-CC-PERPIECE',
    'c3000000-0000-0000-0000-000000000001', 'Patient PerPiece', '[]'::jsonb,
    750.00, 450.00, 'A2', 'New Case', CURRENT_DATE,
    'split', 'c2000000-0000-0000-0000-000000000001', 50.00
);

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost, cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000001'),
    ARRAY[400.00, 50.00, 450.00]::numeric(10,2)[],
    'B1: per-piece designer -- 450 splits into 400 lab + 50 designer'
);

-- ─── 3. Split case, salaried designer: cost is milling only ──────────────
-- design_price is still recorded as the reference figure, and must NOT be
-- taken out of the lab cost.

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, cost, shade,
    status, delivery_date, workflow_type, designer_id, design_price
) VALUES (
    'c4000000-0000-0000-0000-000000000002', 'CASE-CC-SALARIED',
    'c3000000-0000-0000-0000-000000000001', 'Patient Salaried', '[]'::jsonb,
    750.00, 400.00, 'A2', 'New Case', CURRENT_DATE,
    'split', 'c2000000-0000-0000-0000-000000000002', 50.00
);

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000002'),
    ARRAY[400.00, 0.00]::numeric(10,2)[],
    'B2: salaried designer earns nothing per case -- the whole cost is the lab'
);

SELECT is(
    (SELECT design_price FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000002'),
    50.00::numeric(10,2),
    'B3: design_price survives as the reference figure for a salaried designer'
);

-- ─── 4. Full workflow: no designer at all ────────────────────────────────

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, cost, shade,
    status, delivery_date, workflow_type
) VALUES (
    'c4000000-0000-0000-0000-000000000003', 'CASE-CC-FULL',
    'c3000000-0000-0000-0000-000000000001', 'Patient Full', '[]'::jsonb,
    1200.00, 600.00, 'A2', 'New Case', CURRENT_DATE, 'full'
);

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000003'),
    ARRAY[600.00, 0.00]::numeric(10,2)[],
    'B4: a full-workflow case puts everything on the lab'
);

-- ─── 5. The manual/automatic mix ─────────────────────────────────────────
-- A manually entered design price outranks the automatic one, and the lab
-- keeps whatever is left of cost. This is the "one manual, one automatic"
-- combination -- the mix the split has to survive.

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, cost, shade,
    status, delivery_date, workflow_type, designer_id,
    design_price, manual_design_price, manual_cost
) VALUES (
    'c4000000-0000-0000-0000-000000000004', 'CASE-CC-MANUALMIX',
    'c3000000-0000-0000-0000-000000000001', 'Patient ManualMix', '[]'::jsonb,
    1000.00, 520.00, 'A2', 'New Case', CURRENT_DATE,
    'split', 'c2000000-0000-0000-0000-000000000001',
    50.00, 120.00, 400.00
);

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000004'),
    ARRAY[400.00, 120.00]::numeric(10,2)[],
    'C1: a manual design price wins over the automatic one, lab keeps the rest'
);

SELECT is(
    (SELECT lab_cost FROM public.orders WHERE id = 'c4000000-0000-0000-0000-000000000004'),
    (SELECT manual_cost FROM public.orders WHERE id = 'c4000000-0000-0000-0000-000000000004'),
    'C2: with both sides entered manually, lab_cost equals the recorded manual milling price'
);

-- ─── 6. cost is never rewritten by a recompute ───────────────────────────
-- Moving the designer from per-piece to salaried rebalances the split. The
-- total is the number the P&L reads, so it must not move.

UPDATE public.orders
   SET designer_id = 'c2000000-0000-0000-0000-000000000002'
 WHERE id = 'c4000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost, cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000001'),
    ARRAY[450.00, 0.00, 450.00]::numeric(10,2)[],
    'D1: reassigning to a salaried designer rebalances the split but not the total'
);

-- Raising the cost re-splits it against the same design price.
UPDATE public.orders
   SET designer_id = 'c2000000-0000-0000-0000-000000000001',
       cost        = 600.00
 WHERE id = 'c4000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost, cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000001'),
    ARRAY[550.00, 50.00, 600.00]::numeric(10,2)[],
    'D2: a new cost re-splits against the unchanged design price'
);

-- ─── 7. Phase 3: the components drive cost ───────────────────────────────

UPDATE public.orders SET lab_cost = 700.00
 WHERE id = 'c4000000-0000-0000-0000-000000000003';

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost, cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000003'),
    ARRAY[700.00, 0.00, 700.00]::numeric(10,2)[],
    'E1: writing a component drives cost, instead of cost driving the component'
);

UPDATE public.orders SET lab_cost = 600.00
 WHERE id = 'c4000000-0000-0000-0000-000000000003';

-- An update that touches neither cost nor the design inputs leaves the
-- components exactly where they were.
UPDATE public.orders
   SET patient_name = 'Patient Full Renamed'
 WHERE id = 'c4000000-0000-0000-0000-000000000003';

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000003'),
    ARRAY[600.00, 0.00]::numeric(10,2)[],
    'E2: an unrelated edit does not disturb the components'
);

-- ─── 8. The invariant, over every row in the database ────────────────────
-- Covers everything the migration backfilled, not just these fixtures.

SELECT is(
    (SELECT COUNT(*)::int FROM public.orders
      WHERE COALESCE(cost, 0) <> lab_cost + designer_cost),
    0,
    'F1: cost = lab_cost + designer_cost holds on every row in the table'
);

-- ─── 9. Phase 3: both write directions, and the ambiguous one ────────────

-- Component-first INSERT: cost is computed, not supplied.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, cost, shade,
    status, delivery_date, workflow_type, designer_id, design_price,
    lab_cost, designer_cost
) VALUES (
    'c4000000-0000-0000-0000-000000000005', 'CASE-CC-COMPONENTFIRST',
    'c3000000-0000-0000-0000-000000000001', 'Patient ComponentFirst', '[]'::jsonb,
    900.00, 0.00, 'A2', 'New Case', CURRENT_DATE,
    'split', 'c2000000-0000-0000-0000-000000000001', 70.00,
    330.00, 70.00
);

SELECT is(
    (SELECT cost FROM public.orders WHERE id = 'c4000000-0000-0000-0000-000000000005'),
    400.00::numeric(10,2),
    'G1: a component-first insert adds the two components into cost'
);

-- A caller that sends cost alongside components must agree with them.
SELECT throws_ok(
    $$
    UPDATE public.orders
       SET lab_cost = 500.00, designer_cost = 70.00, cost = 999.00
     WHERE id = 'c4000000-0000-0000-0000-000000000005'
    $$,
    NULL,
    NULL,
    'G2: cost that disagrees with the components is rejected, not silently resolved'
);

-- The legacy direction still works: move cost alone and the split follows.
UPDATE public.orders SET cost = 470.00
 WHERE id = 'c4000000-0000-0000-0000-000000000005';

SELECT is(
    (SELECT ARRAY[lab_cost, designer_cost, cost] FROM public.orders
      WHERE id = 'c4000000-0000-0000-0000-000000000005'),
    ARRAY[400.00, 70.00, 470.00]::numeric(10,2)[],
    'G3: a cost-only writer still gets the split derived for it'
);

SELECT * FROM finish();

ROLLBACK;
