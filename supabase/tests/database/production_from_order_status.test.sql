-- The stage chain follows the order's status, with nobody pressing anything.
--
-- Guards 20260827000000_drive_production_from_order_status.sql.
--
-- The point of the whole mechanism is ONE NUMBER: how long the outside lab
-- keeps a case. Everything asserted here is in service of that number being
-- real rather than plausible:
--
--   * the chain builds itself, because the version that needed a button was
--     built in phase 1 and pressed zero times on 1174 orders;
--   * the vendor's window opens the moment the order says the vendor has it
--     and closes the moment it says otherwise -- so the duration is the status
--     timestamps, not a guess;
--   * doctor time is a step of its own, so a try-in does not bill the vendor
--     for the fortnight the case spent in a surgery;
--   * cancelled cases produce no window at all, because a case nobody worked
--     is not a turnaround;
--   * a case that predates the mechanism gets NOTHING, because its real
--     timestamps are gone and a chain stamped now() would read as a case that
--     took no time -- which would flatter the vendor baseline and then flatter
--     the in-house lab that gets compared against it;
--   * and the reverse reading agrees with the order at every step, or the
--     shadow report shows differences that are really translation errors and
--     the cutover decision gets made on noise.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(21);

-- ─── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('c2000000-0000-0000-0000-000000000001', 'Status test doctor',
        '01000000000', 'Test address', 'DBSTAT', 'Test representative');

-- Needed only for the cancellation at the end: issue transitions go through an
-- audited RPC that insists on a real admin.
INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('c9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'status-admin@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('c8000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001',
     'status_admin', 'admin', 'Status Admin');

-- A full-lab, final-delivery case: the simplest shape there is.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, priority,
    workflow_type, delivery_type
) VALUES (
    'c3000000-0000-0000-0000-000000000001', 'STAT-FULL',
    'c2000000-0000-0000-0000-000000000001', 'Full patient', '[]',
    3000, 'A2', 'New Case', DATE '2026-09-10', 900, 'not_started', 'none', 'Normal',
    'full', 'Final');

-- ─── 1-3. No button: registering the case starts the vendor's clock ──────

SELECT isnt(
    (SELECT id FROM public.production_jobs
      WHERE order_id = 'c3000000-0000-0000-0000-000000000001' AND NOT is_backfilled),
    NULL,
    'a new order builds its own chain, with nobody pressing anything');

-- "مجرد ما تترفع عالسيستم فى حالات full lab" -- a full-lab case is at the
-- vendor from registration. There is no earlier signal to wait for.
SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000001'
        AND s.code = 'external_full'),
    'waiting_external',
    'a full-lab case is at the outside lab the moment it is registered');

-- A chain nobody can see the start of measures nothing.
SELECT isnt(
    (SELECT r.started_at FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000001'
        AND s.code = 'external_full'),
    NULL,
    'and its clock is running');

-- ─── 4-6. The vendor window closes when the order says it closed ────────

UPDATE public.orders SET production_status = 'final_ready'
 WHERE id = 'c3000000-0000-0000-0000-000000000001';

-- "مجرد ما تتعمل ready يبقى المعمل الخارجى خلص شغله"
SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000001'
        AND s.code = 'external_full'),
    'done',
    'final_ready closes the outside lab''s window');

-- An external run is wall-clock: the vendor's weekends are part of what we
-- quote against, and applying our shift calendar to them invents a number.
SELECT is(
    (SELECT r.duration_basis FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000001'
        AND s.code = 'external_full'),
    'wall_clock',
    'and it is measured on the wall clock, not on our shifts');

SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000001'
        AND s.code = 'shipping'),
    'waiting_external',
    'and the case moves on to shipping');

-- ─── 7-8. The reverse reading agrees, which is what the cutover needs ────

SELECT is(
    public.compute_production_status_from_stages('c3000000-0000-0000-0000-000000000001'),
    'final_ready',
    'reading the chain back gives the status it was built from');

-- The arrow points ONE way while the flag is off. If the sync wrote status
-- too, the two would chase each other.
SELECT is(
    (SELECT production_status FROM public.orders
      WHERE id = 'c3000000-0000-0000-0000-000000000001'),
    'final_ready',
    'and the sync never writes production_status back');

-- ─── 9-10. Delivered closes the case ────────────────────────────────────

UPDATE public.orders SET production_status = 'final_delivered'
 WHERE id = 'c3000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000001'
        AND r.status NOT IN ('done', 'skipped')),
    0,
    'final_delivered leaves nothing open');

SELECT is(
    (SELECT status FROM public.production_jobs
      WHERE order_id = 'c3000000-0000-0000-0000-000000000001' AND NOT is_backfilled),
    'done',
    'and the job is done');

-- ─── 11-15. A split try-in: the shape the doctor window exists for ──────

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, priority,
    workflow_type, delivery_type
) VALUES (
    'c3000000-0000-0000-0000-000000000002', 'STAT-TRYIN',
    'c2000000-0000-0000-0000-000000000001', 'TryIn patient', '[]',
    5000, 'A2', 'New Case', DATE '2026-09-20', 1500, 'not_started', 'none', 'Normal',
    'split', 'TryIn');

-- Split work is ours first. The vendor has not seen it yet, and counting from
-- registration would charge them for our design time -- the exact confusion the
-- historical backfill spent its length separating.
SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000002'
        AND s.code = 'external_full' AND r.seq = 20),
    'pending',
    'a split case is not at the vendor while our designer still has it');

-- "مجرد ما المصمم يرفع التصميم فحالات الspilt يبقى الحالة عند المعمل الخارجى"
UPDATE public.orders SET production_status = 'in_production'
 WHERE id = 'c3000000-0000-0000-0000-000000000002';

SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000002'
        AND s.code = 'design'),
    'done',
    'design closes when the case moves out');

SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000002'
        AND s.code = 'external_full' AND r.seq = 20),
    'waiting_external',
    'and the vendor window opens at that moment, not at registration');

-- "مجرد ما الحالة تتحط try in يبقى هى عند الطبيب"
UPDATE public.orders SET production_status = 'try_in_ready'
 WHERE id = 'c3000000-0000-0000-0000-000000000002';

SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000002'
        AND s.code = 'doctor_review'),
    'waiting_external',
    'try_in_ready puts the case with the doctor');

-- The whole reason doctor_review is a step: the fortnight a try-in spends in a
-- surgery must not land inside the vendor's turnaround.
SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000002'
        AND s.code = 'external_full' AND r.seq = 20),
    'done',
    'and it closes the vendor''s first window rather than leaving it running');

-- ─── 16-17. Back to the vendor, and the reverse reading follows ─────────

UPDATE public.orders SET production_status = 'finalization'
 WHERE id = 'c3000000-0000-0000-0000-000000000002';

SELECT is(
    (SELECT r.status FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000002'
        AND s.code = 'external_full' AND r.seq = 40),
    'waiting_external',
    'finalisation is a SECOND vendor window, measured separately');

-- The same stage at two positions means two different things, and only the
-- position can tell them apart.
SELECT is(
    public.compute_production_status_from_stages('c3000000-0000-0000-0000-000000000002'),
    'finalization',
    'and reading it back says finalisation, not production');

-- ─── 18. A case corrected backwards is corrected, not left half-done ────

UPDATE public.orders SET production_status = 'in_production'
 WHERE id = 'c3000000-0000-0000-0000-000000000002';

SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'c3000000-0000-0000-0000-000000000002'
        AND s.code = 'doctor_review' AND r.status = 'done'),
    0,
    'moving a case back reopens what it had already passed');

-- ─── 19. A cancelled case is not a turnaround ───────────────────────────
-- Through the audited RPC, not a bare UPDATE: guard_order_issue_transition_v2
-- refuses direct writes to issue_state, and a test that bypassed it would be
-- proving the reconciler handles a transition that cannot actually happen.

SELECT set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
    $$SELECT public.apply_order_issue_transition_v2(
        'c3000000-0000-0000-0000-000000000002', 'cancel_order',
        'Cancelled before the vendor finished',
        'c7000000-0000-0000-0000-000000000001'::uuid, 'zero', NULL,
        'Status Admin')$$,
    'the case can be cancelled through the audited path');

RESET ROLE;

SELECT is(
    (SELECT status FROM public.production_jobs
      WHERE order_id = 'c3000000-0000-0000-0000-000000000002' AND NOT is_backfilled),
    'cancelled',
    'a cancelled case is closed out, never measured');

-- ─── 20. Nothing is invented for a case that predates the mechanism ─────
-- Its vendor window is already partly spent with nothing recording when. A
-- chain stamped now() would read as a case that took no time at all.

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, priority,
    workflow_type, delivery_type, created_at
) VALUES (
    'c3000000-0000-0000-0000-000000000003', 'STAT-OLD',
    'c2000000-0000-0000-0000-000000000001', 'Old patient', '[]',
    3000, 'A2', 'New Case', DATE '2026-09-10', 900, 'in_production', 'none', 'Normal',
    'full', 'Final', NOW() - INTERVAL '90 days');

SELECT is(
    (SELECT COUNT(*)::int FROM public.production_jobs
      WHERE order_id = 'c3000000-0000-0000-0000-000000000003' AND NOT is_backfilled),
    0,
    'a case older than the measurement cutoff gets no fabricated chain');

SELECT * FROM finish();

ROLLBACK;
