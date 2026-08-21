-- Work calendar foundation — internal lab plan, phase 0, item 1.
-- Plan: docs/INTERNAL_LAB_PLAN_AR.md section 6.
--
-- WHY THIS GOES FIRST, BEFORE ANY PRODUCTION TABLE
--   Every duration the internal lab will report -- stage wait, touch time,
--   cycle time, bottleneck ranking, technician productivity, promised delivery
--   dates -- is computed from a pair of timestamps. If those subtractions count
--   the hours the lab is CLOSED, every one of those numbers is wrong, and we
--   would be chasing technicians over nights and holidays. Building this after
--   the production tables would mean rewriting every report that already reads
--   them. So it lands first, alone, with its own tests.
--
-- THE MODEL: PLANNED SCHEDULE + ACTUAL SESSIONS, ACTUAL WINS
--   work_shifts/work_breaks/work_exceptions describe the INTENDED week.
--   work_sessions records what actually happened -- someone pressed "we opened"
--   at 9:12 and "we closed" at 17:40. A fixed schedule alone is rote: we close
--   early some days and run late on others.
--
--   Resolution rule, implemented in work_windows():
--     * A day on which a session STARTS is driven by its sessions only.
--     * A day with no session falls back to the planned shifts.
--     * The two are UNIONed, so a session that runs past midnight adds its
--       after-midnight tail to the next day without erasing that day's
--       planned shift.
--     * Breaks are subtracted from BOTH. Nobody will press close/open for
--       lunch, so a planned break stays non-working time even inside a
--       manually recorded session.
--
--   The button is therefore an IMPROVEMENT, never a prerequisite: if nobody
--   presses anything, the planned schedule answers. Forgetting to close is
--   handled by close_stale_work_sessions() so an open session can never bill
--   the whole night as work.
--
-- KNOWN LIMIT, DELIBERATE: a PLANNED shift may not cross midnight
--   (end_time > start_time is enforced). A dental lab's planned week is a day
--   shift; real late work is recorded as an actual session, which has no such
--   restriction. Supporting overnight planned shifts would double the window
--   maths for a case that does not exist here.
--
-- NOT IN SCOPE HERE: external stages. Per plan section 6.2, a stage sent to an
--   outside milling house is measured in raw wall-clock time and must NEVER be
--   passed through this function -- the vendor's opening hours are not ours.
--   That rule is enforced at the call site, in the stage-run migration.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.work_calendars (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    timezone   TEXT NOT NULL DEFAULT 'Africa/Cairo',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one default calendar. working_minutes_between() resolves to it when
-- no calendar is named, so two defaults would make durations depend on row
-- order -- a bug that would surface as numbers that change between refreshes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_calendars_single_default
    ON public.work_calendars (is_default) WHERE is_default;

-- weekday follows EXTRACT(DOW): 0 = Sunday .. 6 = Saturday.
CREATE TABLE IF NOT EXISTS public.work_shifts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id UUID NOT NULL REFERENCES public.work_calendars(id) ON DELETE CASCADE,
    weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_work_shifts_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_work_shifts_calendar_weekday
    ON public.work_shifts (calendar_id, weekday) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.work_breaks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id   UUID NOT NULL REFERENCES public.work_shifts(id) ON DELETE CASCADE,
    start_time TIME NOT NULL,
    end_time   TIME NOT NULL,
    label      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_work_breaks_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_work_breaks_shift ON public.work_breaks (shift_id);

-- holiday    -> the whole day is non-working; times must be NULL.
-- short_day  -> Ramadan / half days: replaces the planned shifts entirely.
-- overtime   -> a planned extra day (e.g. an open Friday); also replaces.
CREATE TABLE IF NOT EXISTS public.work_exceptions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id    UUID NOT NULL REFERENCES public.work_calendars(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    exception_type TEXT NOT NULL CHECK (exception_type IN ('holiday', 'short_day', 'overtime')),
    start_time     TIME,
    end_time       TIME,
    notes          TEXT,
    created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_work_exceptions_day UNIQUE (calendar_id, exception_date),
    CONSTRAINT chk_work_exceptions_times CHECK (
        (exception_type = 'holiday'  AND start_time IS NULL AND end_time IS NULL)
        OR (exception_type <> 'holiday' AND start_time IS NOT NULL
            AND end_time IS NOT NULL AND end_time > start_time)
    )
);

-- source:
--   manual           -> a human pressed the button. The truth.
--   auto_inferred    -> the system opened or closed it on their behalf
--                       (first activity of the day / stale-session sweep).
--                       Always paired with is_flagged so it surfaces for review.
--   planned_fallback -> reserved for backfill that materialises historical
--                       planned days as sessions. Not written by the RPCs.
CREATE TABLE IF NOT EXISTS public.work_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id UUID NOT NULL REFERENCES public.work_calendars(id) ON DELETE CASCADE,
    opened_at   TIMESTAMPTZ NOT NULL,
    opened_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    closed_at   TIMESTAMPTZ,
    closed_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual', 'auto_inferred', 'planned_fallback')),
    is_flagged  BOOLEAN NOT NULL DEFAULT FALSE,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_work_sessions_order CHECK (closed_at IS NULL OR closed_at > opened_at)
);

-- One lab, one open session at a time. Two concurrent open sessions would
-- double-count the overlap into every technician's working time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_sessions_one_open
    ON public.work_sessions (calendar_id) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_sessions_calendar_opened
    ON public.work_sessions (calendar_id, opened_at DESC);

DROP TRIGGER IF EXISTS update_work_calendars_updated_at ON public.work_calendars;
CREATE TRIGGER update_work_calendars_updated_at BEFORE UPDATE ON public.work_calendars
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_work_sessions_updated_at ON public.work_sessions;
CREATE TRIGGER update_work_sessions_updated_at BEFORE UPDATE ON public.work_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. work_windows() — the single place the resolution rule lives
-- ─────────────────────────────────────────────────────────────────────────
--
-- Returns the working intervals of [p_from, p_to) as a tstzmultirange.
-- Multirange arithmetic (union / difference / intersection) does the interval
-- algebra, so there is no hand-rolled overlap merging to get wrong.

CREATE OR REPLACE FUNCTION public.work_windows(
    p_calendar_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS tstzmultirange
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz        TEXT;
    v_from_date DATE;
    v_to_date   DATE;
    v_sessions  tstzmultirange := '{}'::tstzmultirange;
    v_planned   tstzmultirange := '{}'::tstzmultirange;
    v_breaks    tstzmultirange := '{}'::tstzmultirange;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RETURN '{}'::tstzmultirange;
    END IF;

    SELECT wc.timezone INTO v_tz
      FROM public.work_calendars wc
     WHERE wc.id = p_calendar_id AND wc.is_active;

    IF v_tz IS NULL THEN
        RETURN '{}'::tstzmultirange;
    END IF;

    -- One day of slack on each side: a session or shift may start before
    -- p_from or end after p_to and still overlap the window.
    v_from_date := (p_from AT TIME ZONE v_tz)::date - 1;
    v_to_date   := (p_to   AT TIME ZONE v_tz)::date + 1;

    -- Actual sessions. A session still open is treated as running up to NOW();
    -- close_stale_work_sessions() is what stops that from meaning "all night".
    SELECT COALESCE(
               range_agg(tstzrange(ws.opened_at, COALESCE(ws.closed_at, NOW()), '[)')),
               '{}'::tstzmultirange)
      INTO v_sessions
      FROM public.work_sessions ws
     WHERE ws.calendar_id = p_calendar_id
       AND COALESCE(ws.closed_at, NOW()) > ws.opened_at
       AND tstzrange(ws.opened_at, COALESCE(ws.closed_at, NOW()), '[)')
           && tstzrange(p_from, p_to, '[)');

    -- Planned windows, but only for days on which no session STARTS.
    -- "Starts", not "overlaps": a shift that ran to 02:00 must not delete the
    -- next day's normal 09:00-18:00 planned window.
    WITH days AS (
        SELECT g.ts::date AS day
          FROM generate_series(v_from_date, v_to_date, INTERVAL '1 day') AS g(ts)
    ),
    uncovered AS (
        SELECT d.day
          FROM days d
         WHERE NOT EXISTS (
               SELECT 1 FROM public.work_sessions ws
                WHERE ws.calendar_id = p_calendar_id
                  AND (ws.opened_at AT TIME ZONE v_tz)::date = d.day)
    ),
    exc AS (
        SELECT e.exception_date AS day, e.exception_type, e.start_time, e.end_time
          FROM public.work_exceptions e
         WHERE e.calendar_id = p_calendar_id
           AND e.exception_date BETWEEN v_from_date AND v_to_date
    ),
    -- short_day / overtime REPLACE the day's shifts; holiday contributes none.
    from_exceptions AS (
        SELECT u.day, x.start_time, x.end_time
          FROM uncovered u
          JOIN exc x ON x.day = u.day
         WHERE x.exception_type <> 'holiday'
    ),
    from_shifts AS (
        SELECT u.day, s.start_time, s.end_time
          FROM uncovered u
          JOIN public.work_shifts s
            ON s.calendar_id = p_calendar_id
           AND s.is_active
           AND s.weekday = EXTRACT(DOW FROM u.day)::smallint
         WHERE NOT EXISTS (SELECT 1 FROM exc x WHERE x.day = u.day)
    ),
    all_planned AS (
        SELECT * FROM from_exceptions
        UNION ALL
        SELECT * FROM from_shifts
    )
    SELECT COALESCE(
               range_agg(tstzrange(
                   (p.day + p.start_time) AT TIME ZONE v_tz,
                   (p.day + p.end_time)   AT TIME ZONE v_tz, '[)')),
               '{}'::tstzmultirange)
      INTO v_planned
      FROM all_planned p;

    -- Breaks apply to actual sessions too: nobody presses close/open for lunch.
    SELECT COALESCE(
               range_agg(tstzrange(
                   (d.day + b.start_time) AT TIME ZONE v_tz,
                   (d.day + b.end_time)   AT TIME ZONE v_tz, '[)')),
               '{}'::tstzmultirange)
      INTO v_breaks
      FROM (SELECT g.ts::date AS day
              FROM generate_series(v_from_date, v_to_date, INTERVAL '1 day') AS g(ts)) d
      JOIN public.work_shifts s
        ON s.calendar_id = p_calendar_id
       AND s.is_active
       AND s.weekday = EXTRACT(DOW FROM d.day)::smallint
      JOIN public.work_breaks b ON b.shift_id = s.id;

    RETURN ((v_sessions + v_planned) - v_breaks)
           * tstzmultirange(tstzrange(p_from, p_to, '[)'));
END;
$$;

COMMENT ON FUNCTION public.work_windows(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
'Working intervals of [from,to) for a calendar. Actual sessions win over the planned schedule on any day a session starts; breaks are subtracted from both. Never call this for external stages (plan 6.2).';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. working_minutes_between() — the one function every metric calls
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.working_minutes_between(
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ,
    p_calendar_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cal   UUID;
    v_total NUMERIC;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RETURN 0;
    END IF;

    v_cal := COALESCE(
        p_calendar_id,
        (SELECT wc.id FROM public.work_calendars wc
          WHERE wc.is_default AND wc.is_active LIMIT 1));

    -- No calendar configured: return NULL, never a number. A silent 0 would
    -- read as "instant", and falling back to wall-clock would reintroduce the
    -- exact bug this migration exists to prevent. Callers must render NULL as
    -- "not measurable yet" -- the reporting plan forbids invented numbers.
    IF v_cal IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (upper(r) - lower(r))) / 60.0), 0)
      INTO v_total
      FROM unnest(public.work_windows(v_cal, p_from, p_to)) AS r;

    RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.working_minutes_between(TIMESTAMPTZ, TIMESTAMPTZ, UUID) IS
'Minutes of working time between two instants. Returns NULL when no calendar is configured -- callers must show that as unmeasurable, not as zero.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Session control RPCs
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_work_session_status(
    p_calendar_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_cal    UUID;
    v_result JSONB;
BEGIN
    IF public.get_my_role() IS NULL THEN
        RAISE EXCEPTION 'forbidden: authentication required' USING ERRCODE = '42501';
    END IF;

    v_cal := COALESCE(
        p_calendar_id,
        (SELECT wc.id FROM public.work_calendars wc
          WHERE wc.is_default AND wc.is_active LIMIT 1));

    IF v_cal IS NULL THEN
        RETURN jsonb_build_object('calendarId', NULL, 'isOpen', NULL,
                                  'reason', 'no_calendar_configured');
    END IF;

    SELECT jsonb_build_object(
               'calendarId',   v_cal,
               'isOpen',       ws.id IS NOT NULL,
               'sessionId',    ws.id,
               'openedAt',     ws.opened_at,
               'openedByName', u.name,
               'source',       ws.source)
      INTO v_result
      FROM (SELECT v_cal AS cal) base
      LEFT JOIN public.work_sessions ws
             ON ws.calendar_id = base.cal AND ws.closed_at IS NULL
      LEFT JOIN public.users u ON u.id = ws.opened_by;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_work_session(
    p_calendar_id UUID        DEFAULT NULL,
    p_at          TIMESTAMPTZ DEFAULT NULL,
    p_source      TEXT        DEFAULT 'manual',
    p_notes       TEXT        DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_cal     UUID;
    v_at      TIMESTAMPTZ := COALESCE(p_at, NOW());
    v_open_id UUID;
    v_new_id  UUID;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'lab') THEN
        RAISE EXCEPTION 'forbidden: admin or lab role required' USING ERRCODE = '42501';
    END IF;

    IF p_source NOT IN ('manual', 'auto_inferred') THEN
        RAISE EXCEPTION 'invalid source: %', p_source USING ERRCODE = '22023';
    END IF;

    v_cal := COALESCE(
        p_calendar_id,
        (SELECT wc.id FROM public.work_calendars wc
          WHERE wc.is_default AND wc.is_active LIMIT 1));

    IF v_cal IS NULL THEN
        RAISE EXCEPTION 'no active work calendar configured' USING ERRCODE = '22023';
    END IF;

    -- Idempotent: pressing "we opened" twice returns the running session
    -- rather than erroring. A blocked button on the lab floor reads as a
    -- broken system and trains people to stop using it.
    SELECT ws.id INTO v_open_id
      FROM public.work_sessions ws
     WHERE ws.calendar_id = v_cal AND ws.closed_at IS NULL
     LIMIT 1;

    IF v_open_id IS NOT NULL THEN
        RETURN v_open_id;
    END IF;

    INSERT INTO public.work_sessions
        (calendar_id, opened_at, opened_by, source, is_flagged, notes)
    VALUES
        (v_cal, v_at, public.get_my_user_id(), p_source,
         p_source = 'auto_inferred', p_notes)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_work_session(
    p_calendar_id UUID        DEFAULT NULL,
    p_at          TIMESTAMPTZ DEFAULT NULL,
    p_notes       TEXT        DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_cal     UUID;
    v_at      TIMESTAMPTZ := COALESCE(p_at, NOW());
    v_id      UUID;
    v_opened  TIMESTAMPTZ;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'lab') THEN
        RAISE EXCEPTION 'forbidden: admin or lab role required' USING ERRCODE = '42501';
    END IF;

    v_cal := COALESCE(
        p_calendar_id,
        (SELECT wc.id FROM public.work_calendars wc
          WHERE wc.is_default AND wc.is_active LIMIT 1));

    SELECT ws.id, ws.opened_at INTO v_id, v_opened
      FROM public.work_sessions ws
     WHERE ws.calendar_id = v_cal AND ws.closed_at IS NULL
     FOR UPDATE;

    -- Idempotent in the same spirit as open_work_session.
    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_at <= v_opened THEN
        RAISE EXCEPTION 'close time % is not after open time %', v_at, v_opened
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.work_sessions
       SET closed_at = v_at,
           closed_by = public.get_my_user_id(),
           notes     = COALESCE(p_notes, notes)
     WHERE id = v_id;

    RETURN v_id;
END;
$$;

-- Planned end-of-day for one date, reading ONLY the schedule.
--
-- Deliberately does NOT go through work_windows(): the caller below needs the
-- planned close of a day that has an OPEN session on it, and work_windows()
-- would fold that still-running session in and answer midnight instead of
-- 18:00. Sessions are excluded here by construction.
CREATE OR REPLACE FUNCTION public.planned_day_close(
    p_calendar_id UUID,
    p_day         DATE
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz    TEXT;
    v_close TIMESTAMPTZ;
BEGIN
    SELECT wc.timezone INTO v_tz
      FROM public.work_calendars wc
     WHERE wc.id = p_calendar_id AND wc.is_active;

    IF v_tz IS NULL OR p_day IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT MAX(x.end_ts) INTO v_close
      FROM (
            -- short_day / overtime replace the day's shifts; holiday yields none.
            SELECT (p_day + e.end_time) AT TIME ZONE v_tz AS end_ts
              FROM public.work_exceptions e
             WHERE e.calendar_id = p_calendar_id
               AND e.exception_date = p_day
               AND e.exception_type <> 'holiday'
            UNION ALL
            SELECT (p_day + s.end_time) AT TIME ZONE v_tz
              FROM public.work_shifts s
             WHERE s.calendar_id = p_calendar_id
               AND s.is_active
               AND s.weekday = EXTRACT(DOW FROM p_day)::smallint
               AND NOT EXISTS (SELECT 1 FROM public.work_exceptions e
                                WHERE e.calendar_id = p_calendar_id
                                  AND e.exception_date = p_day)
           ) x;

    RETURN v_close;
END;
$$;

COMMENT ON FUNCTION public.planned_day_close(UUID, DATE) IS
'Scheduled end of a working day, ignoring actual sessions. NULL on a non-working day.';

-- Someone forgets to press "we closed". Without this, the session stays open,
-- work_windows() runs it to NOW(), and the whole night bills as working time --
-- strictly worse than having no button at all. So: any session still open from
-- a PREVIOUS day is closed at that day's planned close (or one minute after it
-- opened, if that day had no planned window), and flagged for review.
--
-- REFINEMENT PENDING: once production_stage_runs exists, the close time
-- becomes GREATEST(planned close, last recorded activity + grace) so a genuine
-- late shift is not truncated. Until there is an activity source to read, the
-- planned close is the only honest bound.
CREATE OR REPLACE FUNCTION public.close_stale_work_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_count INTEGER := 0;
    r       RECORD;
    v_close TIMESTAMPTZ;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'lab') THEN
        RAISE EXCEPTION 'forbidden: admin or lab role required' USING ERRCODE = '42501';
    END IF;

    FOR r IN
        SELECT ws.id, ws.opened_at, ws.calendar_id, wc.timezone
          FROM public.work_sessions ws
          JOIN public.work_calendars wc ON wc.id = ws.calendar_id
         WHERE ws.closed_at IS NULL
           AND (ws.opened_at AT TIME ZONE wc.timezone)::date
               < (NOW() AT TIME ZONE wc.timezone)::date
    LOOP
        v_close := public.planned_day_close(
                       r.calendar_id,
                       (r.opened_at AT TIME ZONE r.timezone)::date);

        -- A session opened after the planned close, or on a day off, still has
        -- to end somewhere. One minute is the smallest honest non-zero span:
        -- it records that the day happened without inventing hours of work.
        v_close := GREATEST(COALESCE(v_close, r.opened_at + INTERVAL '1 minute'),
                            r.opened_at + INTERVAL '1 minute');

        UPDATE public.work_sessions
           SET closed_at  = v_close,
               source     = 'auto_inferred',
               is_flagged = TRUE,
               notes      = COALESCE(notes || ' | ', '')
                            || 'auto-closed: no close was recorded'
         WHERE id = r.id;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────────
-- Everyone signed in may READ the calendar: the technician's screen shows
-- "the lab is open since 9:12". Only admin writes the schedule. Sessions are
-- written through the SECURITY DEFINER RPCs above, which enforce admin/lab;
-- the direct-write policy exists so an admin can correct a wrong session.

ALTER TABLE public.work_calendars  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_shifts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_breaks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_sessions   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['work_calendars', 'work_shifts', 'work_breaks',
                             'work_exceptions', 'work_sessions']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'read_' || t, t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.get_my_role() IS NOT NULL)',
            'read_' || t, t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admin_manage_' || t, t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.get_my_role() = ''admin'') WITH CHECK (public.get_my_role() = ''admin'')',
            'admin_manage_' || t, t);
    END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Grants — SECURITY DEFINER functions are PUBLIC-executable by default.
--    security_definer_rpc_grants.test.sql is catalog-driven and fails on any
--    new one that is not revoked here.
-- ─────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.work_windows(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_windows(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.working_minutes_between(TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.working_minutes_between(TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.planned_day_close(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planned_day_close(UUID, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.get_work_session_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_work_session_status(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.open_work_session(UUID, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_work_session(UUID, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.close_work_session(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_work_session(UUID, TIMESTAMPTZ, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.close_stale_work_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_stale_work_sessions() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Seed — a STARTING POINT to be corrected in the UI, not a fact.
--    Saturday-Thursday 09:00-18:00, Friday off. If the real week differs,
--    edit the rows; nothing in the code assumes these particular hours.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO public.work_calendars (name, timezone, is_default, is_active)
SELECT 'المعمل', 'Africa/Cairo', TRUE, TRUE
 WHERE NOT EXISTS (SELECT 1 FROM public.work_calendars);

INSERT INTO public.work_shifts (calendar_id, weekday, start_time, end_time)
SELECT wc.id, d.weekday, TIME '09:00', TIME '18:00'
  FROM public.work_calendars wc
  CROSS JOIN (VALUES (0), (1), (2), (3), (4), (6)) AS d(weekday)
 WHERE wc.is_default
   AND NOT EXISTS (SELECT 1 FROM public.work_shifts s WHERE s.calendar_id = wc.id);

COMMIT;
