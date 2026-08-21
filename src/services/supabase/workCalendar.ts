/**
 * Work calendar: the planned week, and the actual "we opened / we closed".
 *
 * Backed by 20260821000000_work_calendar_foundation.sql. Nothing here decides
 * what counts as working time -- that lives in one SQL function so the UI and
 * the reports can never disagree about a duration.
 */
import { supabase } from '../../lib/supabase';
import { ErrorHandler } from '../../lib/errorHandler';

export interface WorkCalendar {
    id: string;
    name: string;
    timezone: string;
    isDefault: boolean;
    isActive: boolean;
}

export interface WorkBreak {
    id: string;
    shiftId: string;
    startTime: string;
    endTime: string;
    label?: string | null;
}

export interface WorkShift {
    id: string;
    calendarId: string;
    /** 0 = Sunday .. 6 = Saturday, matching Postgres EXTRACT(DOW). */
    weekday: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
    breaks: WorkBreak[];
}

export type WorkExceptionType = 'holiday' | 'short_day' | 'overtime';

export interface WorkException {
    id: string;
    calendarId: string;
    date: string;
    type: WorkExceptionType;
    startTime?: string | null;
    endTime?: string | null;
    notes?: string | null;
}

export interface WorkSessionStatus {
    calendarId: string | null;
    isOpen: boolean | null;
    sessionId?: string | null;
    openedAt?: string | null;
    openedByName?: string | null;
    source?: string | null;
    /** Set when no calendar is configured at all. */
    reason?: string;
}

export const WEEKDAY_LABELS_AR: Record<number, string> = {
    0: 'الأحد',
    1: 'الإثنين',
    2: 'الثلاثاء',
    3: 'الأربعاء',
    4: 'الخميس',
    5: 'الجمعة',
    6: 'السبت',
};

export const EXCEPTION_LABELS_AR: Record<WorkExceptionType, string> = {
    holiday: 'إجازة',
    short_day: 'يوم قصير',
    overtime: 'يوم إضافي',
};

export async function getDefaultCalendar(): Promise<WorkCalendar | null> {
    const { data, error } = await supabase
        .from('work_calendars')
        .select('*')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();

    if (error) throw ErrorHandler.handle(error, 'getDefaultCalendar');
    if (!data) return null;

    return {
        id: data.id,
        name: data.name,
        timezone: data.timezone,
        isDefault: data.is_default,
        isActive: data.is_active,
    };
}

export async function getShifts(calendarId: string): Promise<WorkShift[]> {
    const { data, error } = await supabase
        .from('work_shifts')
        .select('*, work_breaks(*)')
        .eq('calendar_id', calendarId)
        .order('weekday', { ascending: true });

    if (error) throw ErrorHandler.handle(error, 'getShifts');

    return (data || []).map((row) => ({
        id: row.id as string,
        calendarId: row.calendar_id as string,
        weekday: row.weekday as number,
        startTime: (row.start_time as string).slice(0, 5),
        endTime: (row.end_time as string).slice(0, 5),
        isActive: row.is_active as boolean,
        breaks: ((row.work_breaks as Record<string, unknown>[]) || []).map((b) => ({
            id: b.id as string,
            shiftId: row.id as string,
            startTime: (b.start_time as string).slice(0, 5),
            endTime: (b.end_time as string).slice(0, 5),
            label: (b.label as string) ?? null,
        })),
    }));
}

/**
 * Replaces the whole week in one go. Diffing shift rows would be more
 * surgical, but the week is six rows and a full replace has no partial-update
 * failure mode to reason about.
 */
export async function saveShifts(
    calendarId: string,
    shifts: { weekday: number; startTime: string; endTime: string }[],
): Promise<void> {
    const { error: delError } = await supabase
        .from('work_shifts')
        .delete()
        .eq('calendar_id', calendarId);
    if (delError) throw ErrorHandler.handle(delError, 'saveShifts.delete');

    if (shifts.length === 0) return;

    const { error } = await supabase.from('work_shifts').insert(
        shifts.map((s) => ({
            calendar_id: calendarId,
            weekday: s.weekday,
            start_time: s.startTime,
            end_time: s.endTime,
        })),
    );
    if (error) throw ErrorHandler.handle(error, 'saveShifts.insert');
}

export async function addBreak(
    shiftId: string,
    startTime: string,
    endTime: string,
    label?: string,
): Promise<void> {
    const { error } = await supabase.from('work_breaks').insert({
        shift_id: shiftId,
        start_time: startTime,
        end_time: endTime,
        label: label ?? null,
    });
    if (error) throw ErrorHandler.handle(error, 'addBreak');
}

export async function deleteBreak(id: string): Promise<void> {
    const { error } = await supabase.from('work_breaks').delete().eq('id', id);
    if (error) throw ErrorHandler.handle(error, 'deleteBreak');
}

export async function getExceptions(
    calendarId: string,
    fromDate: string,
): Promise<WorkException[]> {
    const { data, error } = await supabase
        .from('work_exceptions')
        .select('*')
        .eq('calendar_id', calendarId)
        .gte('exception_date', fromDate)
        .order('exception_date', { ascending: true });

    if (error) throw ErrorHandler.handle(error, 'getExceptions');

    return (data || []).map((row) => ({
        id: row.id as string,
        calendarId: row.calendar_id as string,
        date: row.exception_date as string,
        type: row.exception_type as WorkExceptionType,
        startTime: row.start_time ? (row.start_time as string).slice(0, 5) : null,
        endTime: row.end_time ? (row.end_time as string).slice(0, 5) : null,
        notes: (row.notes as string) ?? null,
    }));
}

export async function upsertException(
    calendarId: string,
    date: string,
    type: WorkExceptionType,
    startTime?: string | null,
    endTime?: string | null,
    notes?: string | null,
): Promise<void> {
    const { error } = await supabase.from('work_exceptions').upsert(
        {
            calendar_id: calendarId,
            exception_date: date,
            exception_type: type,
            // A holiday must carry no times; the DB check enforces it.
            start_time: type === 'holiday' ? null : startTime,
            end_time: type === 'holiday' ? null : endTime,
            notes: notes ?? null,
        },
        { onConflict: 'calendar_id,exception_date' },
    );
    if (error) throw ErrorHandler.handle(error, 'upsertException');
}

export async function deleteException(id: string): Promise<void> {
    const { error } = await supabase.from('work_exceptions').delete().eq('id', id);
    if (error) throw ErrorHandler.handle(error, 'deleteException');
}

// ─── The open / closed button ────────────────────────────────────────────

export async function getWorkSessionStatus(): Promise<WorkSessionStatus> {
    const { data, error } = await supabase.rpc('get_work_session_status');
    if (error) throw ErrorHandler.handle(error, 'getWorkSessionStatus');
    return (data || { calendarId: null, isOpen: null }) as WorkSessionStatus;
}

export async function openWorkSession(): Promise<string> {
    const { data, error } = await supabase.rpc('open_work_session');
    if (error) throw ErrorHandler.handle(error, 'openWorkSession');
    return data as string;
}

export async function closeWorkSession(): Promise<string | null> {
    const { data, error } = await supabase.rpc('close_work_session');
    if (error) throw ErrorHandler.handle(error, 'closeWorkSession');
    return (data as string) ?? null;
}

export interface FlaggedWorkSession {
    id: string;
    openedAt: string;
    closedAt: string | null;
    source: string;
    notes: string | null;
}

/** Sessions somebody forgot to close, for the review list. */
export async function getFlaggedSessions(calendarId: string): Promise<FlaggedWorkSession[]> {
    const { data, error } = await supabase
        .from('work_sessions')
        .select('id, opened_at, closed_at, source, notes')
        .eq('calendar_id', calendarId)
        .eq('is_flagged', true)
        .order('opened_at', { ascending: false })
        .limit(50);

    if (error) throw ErrorHandler.handle(error, 'getFlaggedSessions');

    return (data || []).map((r) => ({
        id: r.id as string,
        openedAt: r.opened_at as string,
        closedAt: (r.closed_at as string) ?? null,
        source: r.source as string,
        notes: (r.notes as string) ?? null,
    }));
}

const EXCEPTION_TYPES: readonly WorkExceptionType[] = ['holiday', 'short_day', 'overtime'];

/** Narrows free text (a prompt, a URL param) without an assertion. */
export function isWorkExceptionType(value: string): value is WorkExceptionType {
    return (EXCEPTION_TYPES as readonly string[]).includes(value);
}
