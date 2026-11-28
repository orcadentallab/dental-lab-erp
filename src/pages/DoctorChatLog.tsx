import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { doctorPortalService, type DoctorChatLogEntry } from '../services/doctorPortalService';

const labels = { general: 'عام', design: 'تصميم', try_in: 'بروفة' };
const dateFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Cairo' });
const clock = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', timeStyle: 'short' });

export default function DoctorChatLog() {
    const [day, setDay] = useState(() => dateFormat.format(new Date()));
    const [context, setContext] = useState('');
    const [entries, setEntries] = useState<DoctorChatLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [mutating, setMutating] = useState(false);
    const [failed, setFailed] = useState(false);
    const refresh = useCallback(async () => {
        if (!day) { setEntries([]); return; }
        setLoading(true);
        setFailed(false);
        try { setEntries(await doctorPortalService.chatLog(day, context)); }
        catch { setFailed(true); }
        finally { setLoading(false); }
    }, [day, context]);
    useEffect(() => { void refresh(); }, [refresh]);
    async function review(id?: string) {
        setMutating(true);
        setFailed(false);
        try {
            await doctorPortalService.reviewChatLog(day, id);
            await refresh();
        } catch { setFailed(true); }
        finally { setMutating(false); }
    }
    return <main dir="rtl" className="mx-auto max-w-7xl space-y-4 px-3 py-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-xl font-bold">سجل نهاية اليوم</h1>
            <button type="button" onClick={() => void review()} disabled={mutating || loading || !day}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                <ClipboardCheck size={17} /> اعتماد مراجعة اليوم بالكامل
            </button>
        </header>
        <div className="flex flex-wrap gap-3 rounded-xl border border-surface-200 bg-surface-0 p-3 text-sm">
            <label className="flex items-center gap-2">اليوم <input type="date" className="rounded-lg border border-surface-200 bg-surface-0 p-2"
                value={day} onChange={event => setDay(event.target.value)} /></label>
            <label className="flex items-center gap-2">النوع <select className="rounded-lg border border-surface-200 bg-surface-0 p-2"
                value={context} onChange={event => setContext(event.target.value)}>
                <option value="">الكل</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
        </div>
        {failed && <p role="alert" className="text-sm text-red-700">تعذّر تحديث السجل.</p>}
        {loading ? <p role="status">جاري تحميل السجل…</p> : !entries.length ? <p className="text-surface-500">مفيش رسائل بالفلاتر دي.</p>
            : <div className="overflow-x-auto rounded-xl border border-surface-200 bg-surface-0">
                <table className="w-full min-w-[720px] text-right text-sm">
                    <thead className="bg-surface-50"><tr>{['الوقت', 'النوع', 'الطبيب والحالة', 'مين اتبلّغ', 'رد المعمل', 'المراجعة'].map(label =>
                        <th key={label} scope="col" className="px-3 py-2">{label}</th>)}</tr></thead>
                    <tbody>{entries.map(entry => <tr key={entry.id} className="border-t border-surface-200 align-top">
                        <td className="px-3 py-3 whitespace-nowrap">{clock.format(new Date(entry.time))}</td>
                        <td className="px-3 py-3">{labels[entry.context]}</td>
                        <td className="px-3 py-3"><Link to={`/directory/doctor-chat?thread=${entry.thread_id}`} className="font-semibold text-teal-700 dark:text-teal-300">
                            {entry.doctor} <bdi>{entry.case_id}</bdi>
                        </Link></td>
                        <td className="px-3 py-3">{entry.recipients.map(recipient => recipient.name).join('، ') || '—'}
                            {entry.designer_missing && <p className="text-xs text-amber-700">لا يوجد مصمم مكلّف</p>}</td>
                        <td className="px-3 py-3">{entry.first_reply_at ? `نعم · ${clock.format(new Date(entry.first_reply_at))}` : 'بانتظار الرد'}</td>
                        <td className="px-3 py-3">{entry.reviewed_at
                            ? <span className="text-teal-700 dark:text-teal-300">تمت المراجعة · {entry.reviewed_by} · {clock.format(new Date(entry.reviewed_at))}</span>
                            : <button type="button" className="rounded-lg border border-surface-200 px-2 py-1 font-semibold" disabled={mutating} onClick={() => void review(entry.id)}>تمت المراجعة</button>}</td>
                    </tr>)}</tbody>
                </table>
            </div>}
    </main>;
}
