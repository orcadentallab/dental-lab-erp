import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { DESIGN_QC_CHANGED, formatDesignQcAge } from '../../lib/designQcQueue';
import { bypassAndReleaseDesignRevision, getDesignQcQueue, type DesignQueueItem } from '../../services/supabase/designQc';

const button = 'min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-cyan-600 disabled:opacity-50 dark:border-slate-700';

export default function CoordinatorDesignQc() {
    const [queue, setQueue] = useState<DesignQueueItem[]>([]);
    const [selected, setSelected] = useState<DesignQueueItem | null>(null);
    const [requestingBypass, setRequestingBypass] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [now, setNow] = useState(Date.now);
    const dialog = useRef<HTMLDialogElement>(null);

    const refresh = useCallback(async () => {
        setQueue(await getDesignQcQueue());
        setNow(Date.now());
    }, []);

    useEffect(() => {
        const update = () => void refresh().catch(() => setError('تعذّر تحميل الحالات المنتظرة.'));
        update();
        const timer = window.setInterval(update, 30_000);
        window.addEventListener('focus', update);
        window.addEventListener(DESIGN_QC_CHANGED, update);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', update);
            window.removeEventListener(DESIGN_QC_CHANGED, update);
        };
    }, [refresh]);

    useEffect(() => {
        if (selected) dialog.current?.showModal();
        else dialog.current?.close();
    }, [selected]);

    function open(item: DesignQueueItem) {
        setError('');
        setReason('');
        setMessage('');
        setRequestingBypass(false);
        setSelected(item);
    }

    async function bypass() {
        if (!selected?.revisionId || !reason.trim() || busy) return;
        setBusy(true);
        setError('');
        try {
            await bypassAndReleaseDesignRevision(selected.revisionId, reason);
            setQueue(items => items.filter(item => item.id !== selected.id));
            setSelected(null);
            setMessage(`تم توثيق التخطي وإرسال ${selected.caseId} للتنفيذ.`);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'تعذّر إرسال الحالة للتنفيذ.');
        } finally {
            setBusy(false);
        }
    }

    const waiting = queue.filter(item => item.canBypass);
    const followups = queue.filter(item => item.needsFollowup);
    return (
        <section dir="rtl" aria-labelledby="coordinator-qc-title" className="mx-auto mb-4 max-w-7xl rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h2 id="coordinator-qc-title" className="font-bold">حالات بانتظار مراجعة التصميم <span className="ms-2 rounded-full bg-amber-100 px-2 text-amber-950">{waiting.length}</span></h2>
            {message && <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
            {error && !selected && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
            {!waiting.length && !error && <p className="mt-2 text-sm text-slate-500">لا توجد حالات تنتظر المراجعة حاليًا.</p>}
            <ul className="mt-3 space-y-2">
                {waiting.map(item => <li key={item.id}><button type="button" onClick={() => open(item)} className={`${button} flex w-full flex-wrap items-center justify-between gap-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800`}>
                    <span className="break-all">{item.caseId}</span>
                    <span className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300"><Clock3 size={14} />{formatDesignQcAge(item.submittedAt, now)}</span>
                </button></li>)}
            </ul>
            {followups.length > 0 && <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                <h3 className="text-sm font-semibold">رفض بعد التخطي · متابعة المنسق</h3>
                <ul className="mt-2 space-y-2 text-sm">{followups.map(item => <li key={item.id}><strong>{item.caseId}</strong> · {item.feedback}</li>)}</ul>
            </div>}
            <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) setSelected(null); }} aria-labelledby="coordinator-qc-dialog-title" className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/50 dark:bg-slate-900 dark:text-slate-100">
                {selected && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void bypass(); }}>
                    <h3 id="coordinator-qc-dialog-title" className="break-all font-bold">{requestingBypass ? 'تخطي مراجعة التصميم' : 'حالة بانتظار المراجعة'} · {selected.caseId}</h3>
                    {requestingBypass && <label className="block text-sm font-semibold">سبب تخطي QC
                        <textarea required rows={3} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 bg-transparent p-3" />
                    </label>}
                    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
                    <div className="flex flex-wrap gap-2">
                        {requestingBypass ? <button type="submit" disabled={busy || !reason.trim()} className={`${button} bg-cyan-700 text-white`}>{busy ? 'جاري الإرسال…' : 'تأكيد التخطي والإرسال للتنفيذ'}</button> : <button type="button" className={`${button} bg-cyan-700 text-white`} onClick={() => setRequestingBypass(true)}>تخطي QC</button>}
                        <button type="button" disabled={busy} className={button} onClick={() => { setError(''); setSelected(null); }}>إغلاق</button>
                    </div>
                </form>}
            </dialog>
        </section>
    );
}
