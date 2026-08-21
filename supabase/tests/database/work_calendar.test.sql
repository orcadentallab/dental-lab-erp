-- Work calendar: the closed hours must never count as delay.
--
-- Guards 20260821000000_work_calendar_foundation.sql. Every stage duration the
-- internal lab will report is a subtraction between two timestamps, and if that
-- subtraction counts nights, weekends and holidays, every bottleneck ranking
-- and every technician comparison built on top of it is wrong. These are the
-- worked examples from docs/INTERNAL_LAB_PLAN_AR.md section 12.
--
-- FIXED WEEK USED THROUGHOUT — 2026-06-01 is a Monday:
--   Mon 06-01  Tue 06-02  Wed 06-03  Thu 06-04  Fri 06-05 OFF  Sat 06-06  Sun 06-07
--
-- All literals are written as `TIMESTAMP '...' AT TIME ZONE 'Africa/Cairo'` so
-- they mean local wall-clock time regardless of DST. Egypt observes DST in
-- June; hard-coding UTC offsets here would silently drift by an hour.
--
-- The tests use their OWN calendar rather than the seeded default, so editing
-- the real lab's hours in production can never turn this suite red.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(28);

-- ─── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO public.work_calendars (id, name, timezone, is_default, is_active)
VALUES ('c1000000-0000-0000-0000-000000000001',
        'Work calendar test lab', 'Africa/Cairo', FALSE, TRUE);

-- 09:00-18:00 Saturday through Thursday. Friday (DOW 5) has no shift.
INSERT INTO public.work_shifts (id, calendar_id, weekday, start_time, end_time)
VALUES
    ('c2000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000001', 0, '09:00', '18:00'),
    ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 1, '09:00', '18:00'),
    ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 2, '09:00', '18:00'),
    ('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 3, '09:00', '18:00'),
    ('c2000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', 4, '09:00', '18:00'),
    ('c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000001', 6, '09:00', '18:00');

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('c9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'work-calendar-admin@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name)
VALUES ('c3000000-0000-0000-0000-000000000001',
        'c9000000-0000-0000-0000-000000000001',
        'work_calendar_admin', 'admin', 'Work calendar admin');

-- ─── 1-2. The functions exist ────────────────────────────────────────────

SELECT has_function('public', 'work_windows',
    ARRAY['uuid', 'timestamp with time zone', 'timestamp with time zone'],
    'work_windows() exists');

SELECT has_function('public', 'working_minutes_between',
    ARRAY['timestamp with time zone', 'timestamp with time zone', 'uuid'],
    'working_minutes_between() exists');

-- ─── 3-8. Planned schedule only, no sessions recorded yet ────────────────

-- THE headline case from the plan: a stage finishes exactly at closing time
-- and the next one starts when the lab reopens. Wall clock says 15 hours.
-- Working time says zero, and zero is the honest answer.
SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-01 18:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-02 09:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    0::numeric,
    'closed overnight counts as zero working minutes, not 15 hours');

-- Finishing an hour BEFORE closing is different: that last hour is real
-- working time in which nobody picked the case up. This is the distinction
-- the whole bottleneck report rests on.
SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-01 17:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-02 09:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    60::numeric,
    'the hour before closing still counts; only the closed night is dropped');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-01 10:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-01 14:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    240::numeric,
    'ready at 10:00 and untouched until 14:00 is four hours of real delay');

-- Friday is not a working day: Thursday close to Saturday open is zero.
SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-04 18:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-06 09:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    0::numeric,
    'the weekly day off is not delay');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-01 00:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-02 00:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    540::numeric,
    'a full planned day is 9 hours');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-01 14:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-01 10:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    0::numeric,
    'a backwards interval is zero, not negative');

-- ─── 9-10. Exceptions: holidays and short days ───────────────────────────

INSERT INTO public.work_exceptions
    (calendar_id, exception_date, exception_type, notes)
VALUES ('c1000000-0000-0000-0000-000000000001', DATE '2026-06-03', 'holiday', 'Public holiday');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-02 18:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-04 09:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    0::numeric,
    'a holiday in the middle is not delay');

-- Ramadan-style short day: replaces the shift instead of trimming it.
INSERT INTO public.work_exceptions
    (calendar_id, exception_date, exception_type, start_time, end_time, notes)
VALUES ('c1000000-0000-0000-0000-000000000001', DATE '2026-06-07', 'short_day',
        '10:00', '14:00', 'Short day');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-07 00:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-08 00:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    240::numeric,
    'a short day counts its own hours, not the standard shift');

-- ─── 11-13. Actual sessions override the planned schedule ────────────────

-- Closed early: pressed "we closed" at 17:40 against a planned 18:00.
-- Those 20 minutes are not working time.
INSERT INTO public.work_sessions (calendar_id, opened_at, closed_at, source)
VALUES ('c1000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-01 09:12' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-01 17:40' AT TIME ZONE 'Africa/Cairo',
        'manual');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-01 00:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-02 00:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    508::numeric,
    'closing early shortens the day: the recorded session wins over 09:00-18:00');

-- Ran late: the extra hours past the planned close are real and must count.
INSERT INTO public.work_sessions (calendar_id, opened_at, closed_at, source)
VALUES ('c1000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-02 09:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-02 20:30' AT TIME ZONE 'Africa/Cairo',
        'manual');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-02 00:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-03 00:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    690::numeric,
    'working past the planned close adds the overtime');

-- Came back at night for one urgent case: a second session on the same day.
INSERT INTO public.work_sessions (calendar_id, opened_at, closed_at, source)
VALUES ('c1000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-02 21:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-02 22:00' AT TIME ZONE 'Africa/Cairo',
        'manual');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-02 00:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-03 00:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    750::numeric,
    'a second session the same evening is counted, not ignored');

-- ─── 14-15. Breaks come off both planned days and recorded sessions ───────

INSERT INTO public.work_breaks (shift_id, start_time, end_time, label)
VALUES ('c2000000-0000-0000-0000-000000000001', '13:00', '14:00', 'Lunch');

-- Monday has a recorded session. Nobody presses close/open for lunch, so the
-- break has to be subtracted from the session too -- otherwise every manually
-- recorded day silently gains an hour of phantom work.
SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-01 00:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-02 00:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    448::numeric,
    'the lunch break is subtracted from a recorded session, not just the plan');

INSERT INTO public.work_breaks (shift_id, start_time, end_time, label)
VALUES ('c2000000-0000-0000-0000-000000000004', '13:00', '14:00', 'Lunch');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-04 00:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-05 00:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    480::numeric,
    'the lunch break is subtracted from a planned day');

-- ─── 16-17. Structural guards ────────────────────────────────────────────

-- Two default calendars would make every unqualified duration depend on row
-- order, so numbers would change between refreshes with nothing to blame.
SELECT throws_ok(
    $$INSERT INTO public.work_calendars (name, is_default) VALUES ('Second default', TRUE)$$,
    '23505',
    NULL,
    'a second default calendar is rejected');

SELECT throws_ok(
    $$INSERT INTO public.work_sessions (calendar_id, opened_at)
      VALUES ('c1000000-0000-0000-0000-000000000001',
              TIMESTAMP '2026-06-06 09:00' AT TIME ZONE 'Africa/Cairo'),
             ('c1000000-0000-0000-0000-000000000001',
              TIMESTAMP '2026-06-06 10:00' AT TIME ZONE 'Africa/Cairo')$$,
    '23505',
    NULL,
    'two sessions cannot be open at once');

-- ─── 18-21. Forgetting to close must not bill the night ──────────────────

-- Left open on Saturday and never closed. While it is open, work_windows()
-- runs it to NOW() -- which is exactly the failure mode
-- close_stale_work_sessions() exists to stop.
INSERT INTO public.work_sessions (calendar_id, opened_at, source)
VALUES ('c1000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-06 09:00' AT TIME ZONE 'Africa/Cairo',
        'manual');

SELECT is(
    public.planned_day_close('c1000000-0000-0000-0000-000000000001', DATE '2026-06-06'),
    TIMESTAMP '2026-06-06 18:00' AT TIME ZONE 'Africa/Cairo',
    'planned_day_close ignores the still-open session and answers 18:00');

SELECT set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT ok(
    public.close_stale_work_sessions() >= 1,
    'the stale-session sweep closes a session left open on a past day');

RESET ROLE;

SELECT is(
    (SELECT closed_at FROM public.work_sessions
      WHERE calendar_id = 'c1000000-0000-0000-0000-000000000001'
        AND opened_at = TIMESTAMP '2026-06-06 09:00' AT TIME ZONE 'Africa/Cairo'),
    TIMESTAMP '2026-06-06 18:00' AT TIME ZONE 'Africa/Cairo',
    'it closes at the planned close, not at midnight and not at NOW()');

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-06 00:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-07 00:00' AT TIME ZONE 'Africa/Cairo',
        'c1000000-0000-0000-0000-000000000001'),
    540::numeric,
    'after the sweep the forgotten day is a normal 9 hours, not the whole night');

-- ─── 22-27. The "we opened" / "we closed" buttons ────────────────────────
--
-- Both RPCs are idempotent on purpose. A button that errors on a double tap
-- reads as broken on the lab floor and trains people to stop pressing it --
-- at which point the whole actual-session layer is dead and every duration
-- silently falls back to the planned schedule.

SELECT set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
    $$SELECT public.open_work_session(
        'c1000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-10 09:05' AT TIME ZONE 'Africa/Cairo')$$,
    'an admin can record that the lab opened');

SELECT is(
    public.open_work_session('c1000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-10 09:30' AT TIME ZONE 'Africa/Cairo'),
    (SELECT id FROM public.work_sessions
      WHERE calendar_id = 'c1000000-0000-0000-0000-000000000001'
        AND closed_at IS NULL),
    'pressing "we opened" twice returns the running session instead of erroring');

SELECT is(
    (SELECT COUNT(*)::int FROM public.work_sessions
      WHERE calendar_id = 'c1000000-0000-0000-0000-000000000001'
        AND closed_at IS NULL),
    1,
    'the second press did not create a second session');

SELECT lives_ok(
    $$SELECT public.close_work_session(
        'c1000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-10 17:40' AT TIME ZONE 'Africa/Cairo')$$,
    'an admin can record that the lab closed');

SELECT is(
    public.close_work_session('c1000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-10 18:00' AT TIME ZONE 'Africa/Cairo'),
    NULL::uuid,
    'closing again is a no-op, not an error and not a reopened day');

RESET ROLE;

-- A technician must not be able to declare the lab open or closed: that one
-- press moves every duration in the building.
INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('c9000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'work-calendar-designer@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name)
VALUES ('c3000000-0000-0000-0000-000000000002',
        'c9000000-0000-0000-0000-000000000002',
        'work_calendar_designer', 'designer', 'Work calendar designer');

SELECT set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
    $$SELECT public.open_work_session('c1000000-0000-0000-0000-000000000001')$$,
    '42501',
    NULL,
    'a designer cannot declare the lab open');

RESET ROLE;

-- ─── 28. No calendar configured answers NULL, never a number ─────────────

UPDATE public.work_calendars SET is_default = FALSE WHERE is_default;

SELECT is(
    public.working_minutes_between(
        TIMESTAMP '2026-06-01 10:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-01 14:00' AT TIME ZONE 'Africa/Cairo'),
    NULL::numeric,
    'with no default calendar the answer is NULL, not a silent zero');

SELECT * FROM finish();
ROLLBACK;
