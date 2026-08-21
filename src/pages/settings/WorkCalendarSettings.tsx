/**
 * Working hours. Plan section 6.
 *
 * Two layers, and the difference matters:
 *   the PLANNED week (here) is what the system assumes when nobody says
 *   otherwise, and the ACTUAL sessions ("we opened" / "we closed") override it
 *   on any day somebody presses the button. Fixed hours alone would be rote --
 *   some days close early, some run late.
 *
 * Nothing about these hours is compiled in. The migration seeds a starting
 * week; this screen is where it becomes true.
 */
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../context/ToastContext';
import {
    getDefaultCalendar, getShifts, saveShifts, addBreak, deleteBreak,
    getExceptions, upsertException, deleteException,
    getWorkSessionStatus, openWorkSession, closeWorkSession, getFlaggedSessions,
    isWorkExceptionType, WEEKDAY_LABELS_AR, EXCEPTION_LABELS_AR,
    type WorkCalendar, type WorkShift, type WorkException,
    type WorkSessionStatus, type FlaggedWorkSession,
} from '../../services/supabase/workCalendar';
import { Save, Plus, Trash2, AlertTriangle } from 'lucide-react';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

interface DayDraft {
    enabled: boolean;
    start: string;
    end: string;
}

export default function WorkCalendarSettings() {
    const { success, error: toastError } = useToast();
    const [calendar, setCalendar] = useState<WorkCalendar | null>(null);
    const [shifts, setShifts] = useState<WorkShift[]>([]);
    const [draft, setDraft] = useState<Record<number, DayDraft>>({});
    const [exceptions, setExceptions] = useState<WorkException[]>([]);
    const [status, setStatus] = useState<WorkSessionStatus | null>(null);
    const [flagged, setFlagged] = useState<FlaggedWorkSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const today = new Date().toISOString().slice(0, 10);

    const load = useCallback(async () => {
        try {
            const cal = await getDefaultCalendar();
            setCalendar(cal);
            if (!cal) return;

            const [s, ex, st, fl] = await Promise.all([
                getShifts(cal.id),
                getExceptions(cal.id, new Date().toISOString().slice(0, 10)),
                getWorkSessionStatus(),
                getFlaggedSessions(cal.id),
            ]);

            setShifts(s);
            setExceptions(ex);
            setStatus(st);
            setFlagged(fl);

            const d: Record<number, DayDraft> = {};
            WEEKDAYS.forEach((w) => {
                const shift = s.find((x) => x.weekday === w);
                d[w] = shift
                    ? { enabled: true, start: shift.startTime, end: shift.endTime }
                    : { enabled: false, start: '09:00', end: '18:00' };
            });
            setDraft(d);
        } catch (e) {
            console.error('[WorkCalendar] load failed', e);
            toastError('تعذّر تحميل مواعيد العمل');
        } finally {
            setLoading(false);
        }
    }, [toastError]);

    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        if (!calendar) return;
        setSaving(true);
        try {
            await saveShifts(
                calendar.id,
                WEEKDAYS.filter((w) => draft[w]?.enabled)
                    .map((w) => ({ weekday: w, startTime: draft[w].start, endTime: draft[w].end })),
            );
            await load();
            success('المواعيد اتحفظت');
        } catch (e) {
            console.error('[WorkCalendar] save failed', e);
            toastError(e instanceof Error ? e.message : 'تعذّر الحفظ');
        } finally {
            setSaving(false);
        }
    };

    const toggleSession = async () => {
        try {
            if (status?.isOpen) {
                await closeWorkSession();
                success('اتسجّل إن المعمل قفل');
            } else {
                await openWorkSession();
                success('اتسجّل إن المعمل فتح');
            }
            setStatus(await getWorkSessionStatus());
        } catch (e) {
            console.error('[WorkCalendar] session toggle failed', e);
            toastError('تعذّر تسجيل الفتح/القفل');
        }
    };

    const addExceptionRow = async () => {
        if (!calendar) return;
        const date = window.prompt('تاريخ الاستثناء (YYYY-MM-DD)');
        if (!date?.trim()) return;
        const kind = window.prompt('النوع: holiday / short_day / overtime', 'holiday');
        // A type guard rather than an assertion: this value came from a text
        // prompt, so it genuinely has to be checked, not just re-labelled.
        if (!kind || !isWorkExceptionType(kind)) return;

        let start: string | null = null;
        let end: string | null = null;
        if (kind !== 'holiday') {
            start = window.prompt('من (HH:MM)', '10:00');
            end = window.prompt('لـ (HH:MM)', '14:00');
            if (!start || !end) return;
        }

        try {
            await upsertException(calendar.id, date.trim(), kind, start, end);
            setExceptions(await getExceptions(calendar.id, today));
            success('اتسجّل');
        } catch (e) {
            console.error('[WorkCalendar] exception failed', e);
            toastError(e instanceof Error ? e.message : 'تعذّر التسجيل');
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">جارِ التحميل…</div>;

    if (!calendar) {
        return (
            <div className="max-w-3xl mx-auto p-8 text-center" dir="rtl">
                <p className="text-slate-600">مفيش تقويم عمل مضبوط.</p>
                <p className="text-sm text-slate-400 mt-2">
                    من غيره كل مدة في السيستم هتظهر «غير قابلة للقياس» بدل رقم — وده مقصود،
                    عشان مفيش رقم يتخترع.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
            <div>
                <h1 className="text-2xl font-bold text-slate-800">مواعيد العمل</h1>
                <p className="text-sm text-slate-500">
                    كل مدة في السيستم بتتحسب على أساس دي — الساعات اللي المعمل مقفول فيها
                    مبتتحسبش تأخير.
                </p>
            </div>

            {/* Actual open/close. Overrides the planned week for the day it covers. */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <div className="font-bold text-slate-800">
                        {status?.isOpen ? '🟢 المعمل مفتوح' : '🔴 المعمل مقفول'}
                    </div>
                    <div className="text-xs text-slate-500">
                        {status?.isOpen && status.openedAt
                            ? `من ${new Date(status.openedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`
                            : 'الحساب هيقع على المواعيد المبدئية لحد ما تدوس فتحنا'}
                        {status?.openedByName ? ` · ${status.openedByName}` : ''}
                    </div>
                </div>
                <button
                    onClick={() => void toggleSession()}
                    className={`px-5 py-3 rounded-xl font-bold text-white ${
                        status?.isOpen ? 'bg-slate-700' : 'bg-emerald-600'
                    }`}
                >
                    {status?.isOpen ? 'قفلنا' : 'فتحنا'}
                </button>
            </div>

            {/* The planned week. */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="font-bold text-slate-700">الأسبوع المبدئي</h2>
                    <button
                        disabled={saving}
                        onClick={() => void save()}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-blue text-white disabled:opacity-50"
                    >
                        <Save className="w-4 h-4" /> حفظ
                    </button>
                </div>

                {WEEKDAYS.map((w) => {
                    const d = draft[w] ?? { enabled: false, start: '09:00', end: '18:00' };
                    const shift = shifts.find((s) => s.weekday === w);

                    return (
                        <div key={w} className="border border-slate-100 rounded-xl p-3">
                            <div className="flex items-center gap-3 flex-wrap">
                                <label className="flex items-center gap-2 w-28 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={d.enabled}
                                        onChange={(e) =>
                                            setDraft({ ...draft, [w]: { ...d, enabled: e.target.checked } })}
                                        className="w-4 h-4 accent-brand-blue"
                                    />
                                    <span className="text-slate-700">{WEEKDAY_LABELS_AR[w]}</span>
                                </label>

                                {d.enabled ? (
                                    <>
                                        <input
                                            type="time" value={d.start}
                                            onChange={(e) => setDraft({ ...draft, [w]: { ...d, start: e.target.value } })}
                                            className="border border-slate-200 rounded-lg px-2 py-1"
                                        />
                                        <span className="text-slate-400">لـ</span>
                                        <input
                                            type="time" value={d.end}
                                            onChange={(e) => setDraft({ ...draft, [w]: { ...d, end: e.target.value } })}
                                            className="border border-slate-200 rounded-lg px-2 py-1"
                                        />
                                    </>
                                ) : (
                                    <span className="text-sm text-slate-400">إجازة أسبوعية</span>
                                )}
                            </div>

                            {/* Breaks come off both the plan and any recorded session:
                                nobody presses close/open for lunch. */}
                            {shift && (
                                <div className="flex items-center gap-2 flex-wrap mt-2 pr-8 text-xs">
                                    {shift.breaks.map((b) => (
                                        <span key={b.id}
                                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-600">
                                            {b.label ?? 'راحة'} {b.startTime}–{b.endTime}
                                            <button
                                                onClick={async () => {
                                                    await deleteBreak(b.id);
                                                    await load();
                                                }}
                                                className="text-slate-400 hover:text-red-600"
                                                aria-label="حذف"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </span>
                                    ))}
                                    <button
                                        onClick={async () => {
                                            const from = window.prompt('بداية الراحة (HH:MM)', '13:00');
                                            const to = from ? window.prompt('نهاية الراحة (HH:MM)', '14:00') : null;
                                            if (!from || !to) return;
                                            try {
                                                await addBreak(shift.id, from, to, 'راحة');
                                                await load();
                                            } catch (e) {
                                                console.error('[WorkCalendar] break failed', e);
                                                toastError('تعذّر إضافة الراحة');
                                            }
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-slate-500"
                                    >
                                        <Plus className="w-3 h-3" /> راحة
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}

                <p className="text-xs text-slate-400">
                    الراحات بتتشال من وقت العمل حتى لو اليوم اتسجّل بفتحنا/قفلنا — محدش بيدوس
                    قفل عشان الغدا.
                </p>
            </div>

            {/* Holidays and short days. */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="flex items-center justify-between">
                    <h2 className="font-bold text-slate-700">الإجازات والأيام الاستثنائية</h2>
                    <button
                        onClick={() => void addExceptionRow()}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm"
                    >
                        <Plus className="w-4 h-4" /> إضافة
                    </button>
                </div>

                {exceptions.length === 0 && (
                    <p className="text-sm text-slate-400 py-2">مفيش استثناءات قادمة</p>
                )}

                {exceptions.map((ex) => (
                    <div key={ex.id} className="flex items-center justify-between text-sm border-b border-slate-100 py-2">
                        <span className="text-slate-700">
                            {ex.date} · {EXCEPTION_LABELS_AR[ex.type]}
                            {ex.startTime && ` · ${ex.startTime}–${ex.endTime}`}
                        </span>
                        <button
                            onClick={async () => {
                                await deleteException(ex.id);
                                setExceptions(await getExceptions(calendar.id, today));
                            }}
                            className="text-slate-400 hover:text-red-600"
                            aria-label="حذف"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Sessions the system had to close on somebody's behalf. */}
            {flagged.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                    <h2 className="font-bold text-amber-900 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> جلسات محتاجة مراجعة
                    </h2>
                    <p className="text-xs text-amber-800 mb-2">
                        اتقفلت تلقائيًا لأن محدش دوس «قفلنا». راجعها لو الوقت مش مظبوط.
                    </p>
                    {flagged.slice(0, 10).map((s) => (
                        <div key={s.id} className="text-sm text-amber-900 border-b border-amber-100 py-1">
                            {new Date(s.openedAt).toLocaleString('ar-EG')}
                            {' → '}
                            {s.closedAt ? new Date(s.closedAt).toLocaleString('ar-EG') : 'لسه مفتوحة'}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
