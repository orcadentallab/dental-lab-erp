/**
 * The technician's screen. Plan section 7.
 *
 * The whole design target is TWO TAPS: start, then finish. Everything a
 * technician needs to work is on the card already -- if they have to open
 * something to know what to do, the card has failed. The only mandatory input
 * anywhere is a cause code when a unit fails, and that is big buttons, not a
 * form.
 *
 * Pull, not push: this is the shared queue, not a personal assignment list.
 * The first card is marked as recommended (urgent, then nearest promise, then
 * longest waiting); taking a different one is allowed and simply visible,
 * because blocking it would only push people to work around the system.
 */
import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
    getMyTasks, startStageRun, completeStageRun, blockStageRun,
    type StageRunCard, type BlockReason,
} from '../../services/supabase/production';
import { ISSUE_CAUSE } from '../../constants/issueCauses';
import { Play, Check, RefreshCw, Clock, Star } from 'lucide-react';

const BLOCK_REASONS: { code: BlockReason; label: string }[] = [
    { code: 'machine_down', label: 'الجهاز واقف' },
    { code: 'material_out', label: 'الخامة خلصت' },
    { code: 'waiting_doctor', label: 'مستني الطبيب' },
    { code: 'other', label: 'سبب آخر' },
];

/** The causes a bench technician actually picks from, out of the full taxonomy. */
const QC_CAUSES = ['fit', 'contact', 'occlusion', 'shade', 'crack', 'finish', 'glaze', 'material'] as const;

function waitingLabel(since: string | null): string {
    if (!since) return '—';
    const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
    if (mins < 60) return `${mins} دقيقة`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ساعة`;
    return `${Math.floor(hours / 24)} يوم`;
}

function dueLabel(date: string | null): { text: string; late: boolean } {
    if (!date) return { text: 'بدون موعد', late: false };
    const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
    if (days < 0) return { text: `متأخر ${Math.abs(days)} يوم`, late: true };
    if (days === 0) return { text: 'النهارده', late: true };
    return { text: `فاضل ${days} يوم`, late: days <= 1 };
}

export default function MyTasks() {
    const { user } = useAuth();
    const { success, error: toastError } = useToast();
    const [tasks, setTasks] = useState<StageRunCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [failFor, setFailFor] = useState<StageRunCard | null>(null);
    const [blockFor, setBlockFor] = useState<StageRunCard | null>(null);

    const load = useCallback(async () => {
        if (!user?.id) return;
        try {
            setTasks(await getMyTasks(user.id));
        } catch (e) {
            console.error('[MyTasks] load failed', e);
            toastError('تعذّر تحميل المهام');
        } finally {
            setLoading(false);
        }
    }, [user?.id, toastError]);

    useEffect(() => { void load(); }, [load]);

    // The queue changes under people's hands all day; a quiet refresh keeps two
    // technicians from both starting the same case.
    useEffect(() => {
        const timer = setInterval(() => { void load(); }, 60_000);
        return () => clearInterval(timer);
    }, [load]);

    const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
        setBusyId(id);
        try {
            await fn();
            success(done);
            await load();
        } catch (e) {
            console.error('[MyTasks] action failed', e);
            toastError(e instanceof Error ? e.message : 'تعذّر تنفيذ العملية');
        } finally {
            setBusyId(null);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-slate-500">جارِ التحميل…</div>;
    }

    return (
        <div className="max-w-5xl mx-auto space-y-4" dir="rtl">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">مهامي</h1>
                    <p className="text-sm text-slate-500">
                        {tasks.length} حالة في الطابور — الأولى هي الموصى بيها
                    </p>
                </div>
                <button
                    onClick={() => void load()}
                    className="p-3 rounded-xl bg-white border border-slate-200 text-slate-600"
                    aria-label="تحديث"
                >
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {tasks.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <p className="text-lg text-slate-600">مفيش حالات في الطابور دلوقتي</p>
                    <p className="text-sm text-slate-400 mt-1">
                        أول ما حالة توصل مرحلتك هتظهر هنا تلقائيًا
                    </p>
                </div>
            )}

            {tasks.map((t, i) => {
                const due = dueLabel(t.deliveryDate);
                const mine = t.status === 'in_progress' && t.assigneeId === user?.id;
                const recommended = i === 0 && t.status === 'ready';

                return (
                    <div
                        key={t.id}
                        className={`bg-white rounded-2xl border-2 p-5 ${
                            recommended ? 'border-brand-blue shadow-md'
                                : mine ? 'border-emerald-400'
                                : 'border-slate-200'
                        }`}
                    >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    {recommended && (
                                        <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg bg-brand-blue text-white">
                                            <Star className="w-3 h-3" /> ابدأ بيها
                                        </span>
                                    )}
                                    {t.priority === 'Urgent' && (
                                        <span className="text-xs font-bold px-2 py-1 rounded-lg bg-red-100 text-red-700">
                                            مستعجل
                                        </span>
                                    )}
                                    {t.isRework && (
                                        <span className="text-xs font-bold px-2 py-1 rounded-lg bg-amber-100 text-amber-800">
                                            إعادة شغل
                                        </span>
                                    )}
                                    <span className="text-lg font-bold text-slate-800">{t.caseId}</span>
                                    <span className="text-sm text-slate-500">{t.stageNameAr}</span>
                                </div>

                                {/* Everything needed to work, with no further clicks. */}
                                <div className="text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                                    <span>د. {t.doctorName}</span>
                                    <span>{t.patientName}</span>
                                    <span>{t.unitsIn} وحدة</span>
                                    {t.shade && <span>اللون: <b>{t.shade}</b></span>}
                                    {t.teeth.length > 0 && <span>الأسنان: {t.teeth.join('، ')}</span>}
                                    {t.services.length > 0 && <span>{t.services.join('، ')}</span>}
                                </div>

                                {t.instructions && (
                                    <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2 mt-1">
                                        {t.instructions}
                                    </p>
                                )}

                                <div className="flex items-center gap-4 text-xs text-slate-500 pt-1 flex-wrap">
                                    <span className="inline-flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> مستنية {waitingLabel(t.queuedAt)}
                                    </span>
                                    <span className={due.late ? 'text-red-600 font-bold' : ''}>{due.text}</span>
                                    {(t.designUrl || t.stlUrl) && (
                                        <a
                                            href={t.designUrl || t.stlUrl || '#'}
                                            target="_blank" rel="noreferrer"
                                            className="text-brand-blue underline"
                                        >
                                            ملف التصميم
                                        </a>
                                    )}
                                    {t.blockedReason && (
                                        <span className="text-amber-700 font-bold">
                                            موقوفة: {BLOCK_REASONS.find(b => b.code === t.blockedReason)?.label}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Two taps. Large targets: this runs on a tablet, with gloves. */}
                            <div className="flex flex-col gap-2 min-w-[140px]">
                                {t.status === 'ready' && (
                                    <button
                                        disabled={busyId === t.id}
                                        onClick={() => void run(t.id, () => startStageRun(t.id), 'بدأت الشغل')}
                                        className="flex items-center justify-center gap-2 px-5 py-4 rounded-xl bg-brand-blue text-white font-bold text-lg disabled:opacity-50"
                                    >
                                        <Play className="w-5 h-5" /> ابدأ
                                    </button>
                                )}

                                {t.status === 'in_progress' && (
                                    <>
                                        <button
                                            disabled={busyId === t.id}
                                            onClick={() => void run(t.id, () => completeStageRun(t.id), 'خلصت الحالة')}
                                            className="flex items-center justify-center gap-2 px-5 py-4 rounded-xl bg-emerald-600 text-white font-bold text-lg disabled:opacity-50"
                                        >
                                            <Check className="w-5 h-5" /> خلصت
                                        </button>
                                        <button
                                            onClick={() => setFailFor(t)}
                                            className="px-4 py-2 rounded-xl border border-amber-300 text-amber-800 text-sm"
                                        >
                                            فيه وحدة باظت
                                        </button>
                                    </>
                                )}

                                <button
                                    onClick={() => setBlockFor(t)}
                                    className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm"
                                >
                                    بلّغ عن مشكلة
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}

            {/* The one mandatory input in the whole flow: why a unit failed. */}
            {failFor && (
                <Modal title={`إيه اللي حصل في ${failFor.caseId}؟`} onClose={() => setFailFor(null)}>
                    <p className="text-sm text-slate-500 mb-3">
                        اختار السبب — ده الرقم اللي هيقول لنا نصلّح إيه.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        {QC_CAUSES.map((code) => (
                            <button
                                key={code}
                                onClick={() => {
                                    const target = failFor;
                                    setFailFor(null);
                                    void run(target.id,
                                        () => completeStageRun(target.id, {
                                            unitsPassed: Math.max(target.unitsIn - 1, 0),
                                            unitsFailed: 1,
                                            causeCode: code,
                                        }),
                                        'اتسجّلت وراحت لإعادة الشغل');
                                }}
                                className="px-4 py-4 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50"
                            >
                                {ISSUE_CAUSE[code]}
                            </button>
                        ))}
                    </div>
                </Modal>
            )}

            {blockFor && (
                <Modal title={`الحالة ${blockFor.caseId} واقفة ليه؟`} onClose={() => setBlockFor(null)}>
                    <div className="grid grid-cols-2 gap-2">
                        {BLOCK_REASONS.map((r) => (
                            <button
                                key={r.code}
                                onClick={() => {
                                    const target = blockFor;
                                    setBlockFor(null);
                                    void run(target.id,
                                        () => blockStageRun(target.id, r.code),
                                        'اتبلّغ — المدير هيشوفها');
                                }}
                                className="px-4 py-4 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50"
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-3">
                        وقت الوقفة بسبب عطل بيتحسب على الجهاز، مش عليك.
                    </p>
                </Modal>
            )}
        </div>
    );
}

function Modal({ title, children, onClose }: {
    title: string; children: ReactNode; onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" dir="rtl">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-slate-800">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 text-xl px-2">×</button>
                </div>
                {children}
                <button
                    onClick={onClose}
                    className="mt-4 w-full py-3 rounded-xl border border-slate-200 text-slate-600"
                >
                    إلغاء
                </button>
            </div>
        </div>
    );
}
