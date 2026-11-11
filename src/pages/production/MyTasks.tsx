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
import { refreshNavBadges } from '../../hooks/useNavBadges';
import { useToast } from '../../context/ToastContext';
import {openDesignExecution} from '../../services/supabase/designQc';
import {
    Disc, ChevronUp, ChevronDown, RefreshCw, Layers, CheckCircle2, Play, Star, Clock, Check
} from 'lucide-react';
import {
    getMyTasks, startStageRun, completeStageRun, blockStageRun, isExplicitProductionRoute, recordMixedPhysicalQcAction,
    type StageRunCard, type BlockReason, type MixedPhysicalQcAction,
} from '../../services/supabase/production';
import { ISSUE_CAUSE, issueCauseLabel } from '../../constants/issueCauses';
import CaseAttachments from '../../components/orders/CaseAttachments';
import { materialService, type MaterialBatch } from '../../services/supabase/materialService';
import { getMachines, type Machine } from '../../services/supabase/machines';

const BLOCK_REASONS: { code: BlockReason; label: string }[] = [
    { code: 'machine_down', label: 'الجهاز واقف' },
    { code: 'material_out', label: 'الخامة خلصت' },
    { code: 'waiting_doctor', label: 'مستني الطبيب' },
    { code: 'other', label: 'سبب آخر' },
];

/** The causes a bench technician actually picks from, out of the full taxonomy. */
const QC_CAUSES = ['fit', 'contact', 'occlusion', 'shade', 'crack', 'finish', 'glaze', 'material'] as const;
const GROUP_NAMES: Record<string, string> = {
    printing: 'الطباعة', qc: 'الفحص الداخلي', failed_qc: 'فحص يحتاج إجراء', packaging: 'التغليف',
};
const QC_ACTIONS: Record<MixedPhysicalQcAction, { label: string; success: string }> = {
    retry: { label: 'إعادة الفحص', success: 'تمت إعادة الحالة إلى طابور الفحص' },
    return_design: { label: 'إرجاع للتصميم', success: 'تم إرجاع الحالة للمصمم للتعديل' },
    return_lab: { label: 'إرجاع للمعمل الخارجي', success: 'الحالة جاهزة لإعادة الإرسال لنفس المعمل من الشغل الخارجي' },
    replace_lab: { label: 'إرسال لمعمل بديل', success: 'الحالة جاهزة لاختيار معمل بديل من الشغل الخارجي' },
    bypass: { label: 'تخطي الفحص مع السبب', success: 'تم تسجيل التخطي وانتقلت الحالة للشحن' },
};

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
    const isCoordinator = user?.role === 'coordinator';
    const { success, error: toastError } = useToast();
    const [tasks, setTasks] = useState<StageRunCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [failFor, setFailFor] = useState<StageRunCard | null>(null);
    const [qcAction, setQcAction] = useState<{ task: StageRunCard; action: MixedPhysicalQcAction; reason: string } | null>(null);
    const [failedUnitsCount, setFailedUnitsCount] = useState<number>(1);
    const [blockFor, setBlockFor] = useState<StageRunCard | null>(null);
    const [openBatches, setOpenBatches] = useState<MaterialBatch[]>([]);
    const [sealedBatches, setSealedBatches] = useState<MaterialBatch[]>([]);
    const [showMaterialsPanel, setShowMaterialsPanel] = useState(false);
    const [machines, setMachines] = useState<Machine[]>([]);
    const [pickMachineFor, setPickMachineFor] = useState<{ task: StageRunCard; availableMachines: Machine[] } | null>(null);
    const caseFilter = new URLSearchParams(window.location.search).get('case');
    const visibleTasks = caseFilter ? tasks.filter(task => task.caseId === caseFilter) : tasks;
    const taskGroups = new Map<string, { label: string; tasks: StageRunCard[] }>();
    for (const task of visibleTasks) {
        const key = task.failedPhysicalQc ? 'failed_qc' : task.stageCode || task.stageNameAr;
        const group = taskGroups.get(key);
        if (group) group.tasks.push(task);
        else taskGroups.set(key, { label: GROUP_NAMES[key] ?? task.stageNameAr, tasks: [task] });
    }

    const loadBatches = useCallback(async () => {
        try {
            const batches = await materialService.getBatches(['open', 'sealed']);
            setOpenBatches(batches.filter(b => b.status === 'open'));
            setSealedBatches(batches.filter(b => b.status === 'sealed'));
        } catch {
            // Silently fail if user role cannot read batches or internal lab disabled
        }
    }, []);

    const load = useCallback(async () => {
        if (!user?.id) return;
        try {
            const [taskList, machineList] = await Promise.all([
                getMyTasks(user.id, user.role === 'admin' || isCoordinator),
                getMachines().catch((): Machine[] => []),
                isCoordinator ? undefined : loadBatches()
            ]);
            setTasks(taskList);
            setMachines(machineList);
        } catch (e) {
            console.error('[MyTasks] load failed', e);
            toastError('تعذّر تحميل المهام');
        } finally {
            setLoading(false);
        }
    }, [user?.id, user?.role, isCoordinator, toastError, loadBatches]);

    useEffect(() => { void load(); }, [load]);

    // The queue changes under people's hands all day; a quiet refresh keeps two
    // technicians from both starting the same case.
    useEffect(() => {
        const timer = setInterval(() => { void load(); }, 60_000);
        return () => clearInterval(timer);
    }, [load]);

    const handleOpenBatch = async (batchId: string) => {
        try {
            await materialService.openBatch(batchId);
            success('تم فتح الخامة / الديسك وبدء العمل بها');
            await loadBatches();
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'تعذر فتح الخامة');
        }
    };

    const handleDepleteBatch = async (batchId: string) => {
        try {
            await materialService.depleteBatch(batchId);
            success('تم استنفاد الديسك وتسجيل الاستهلاك في السجل');
            await loadBatches();
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'تعذر استنفاد الخامة');
        }
    };

    const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
        setBusyId(id);
        try {
            await fn();
            success(done);
            refreshNavBadges();
            await load();
        } catch (e) {
            console.error('[MyTasks] action failed', e);
            toastError(e instanceof Error ? e.message : 'تعذّر تنفيذ العملية');
        } finally {
            setBusyId(null);
        }
    };

    const handleStartTask = (t: StageRunCard) => {
        // Find active machines configured for this stage
        const stageMachines = machines.filter(m => m.stageId === t.stageId && m.isActive && m.status !== 'retired');

        // Rule 1: 0 machines -> start directly without any prompt (0 extra clicks)
        if (stageMachines.length === 0) {
            void run(t.id, () => startStageRun(t.id), 'بدأت الشغل');
            return;
        }

        // Rule 2: exactly 1 machine -> auto-assign machine_id (0 extra clicks)
        if (stageMachines.length === 1) {
            const onlyMachine = stageMachines[0];
            if (onlyMachine.status === 'down') {
                toastError(`تنبيه: الجهاز "${onlyMachine.nameAr}" مسجل كمتوقف/معطل حالياً!`);
            }
            void run(t.id, () => startStageRun(t.id, onlyMachine.id), `بدأت الشغل (${onlyMachine.nameAr})`);
            return;
        }

        // Rule 3: > 1 machine -> prompt selection so technician taps the one in use
        setPickMachineFor({ task: t, availableMachines: stageMachines });
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
                        {tasks.length} حالة في الطابور
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {(openBatches.length > 0 || sealedBatches.length > 0) && (
                        <button
                            onClick={() => setShowMaterialsPanel(p => !p)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold ${
                                openBatches.length > 0
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                    : 'bg-white border-slate-200 text-slate-700'
                            }`}
                        >
                            <Disc className="w-4 h-4 text-emerald-600" />
                            <span>الخامات المفتوحة ({openBatches.length})</span>
                            {showMaterialsPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                    )}
                    <button
                        onClick={() => void load()}
                        className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                        aria-label="تحديث"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* 2-Tap Material Batch Bar (Plan 7.7) */}
            {showMaterialsPanel && (openBatches.length > 0 || sealedBatches.length > 0) && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                            <Layers className="w-4 h-4 text-brand-blue" />
                            الخامات والديسكات الحالية على الماكينات / المحطات:
                        </span>
                        <span className="text-[11px] text-slate-500">
                            ضغطة واحدة لفتح خامة جديدة أو إغلاق خامة مستنفدة
                        </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                        {/* Currently Open Batches */}
                        {openBatches.map(b => (
                            <div key={b.id} className="bg-white border border-emerald-300 rounded-xl p-3 flex flex-col justify-between shadow-xs">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-bold text-xs text-slate-800">{b.materialName}</span>
                                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded">مفتوح للتشغيل</span>
                                    </div>
                                    <p className="text-[11px] font-mono text-slate-500">{b.batchCode}</p>
                                    <p className="text-[10px] text-slate-400">متبقي: {b.qtyRemaining} {b.materialUnit}</p>
                                </div>
                                <button
                                    onClick={() => handleDepleteBatch(b.id)}
                                    className="mt-2.5 w-full py-1.5 bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 hover:border-red-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    خلص واستنفد الديسك
                                </button>
                            </div>
                        ))}

                        {/* Sealed Batches Available to Open */}
                        {sealedBatches.slice(0, 4).map(b => (
                            <div key={b.id} className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-bold text-xs text-slate-700">{b.materialName}</span>
                                        <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded">مغلق</span>
                                    </div>
                                    <p className="text-[11px] font-mono text-slate-500">{b.batchCode}</p>
                                </div>
                                <button
                                    onClick={() => handleOpenBatch(b.id)}
                                    className="mt-2.5 w-full py-1.5 bg-brand-blue text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 hover:bg-blue-700"
                                >
                                    <Play className="w-3 h-3" />
                                    فتح واستخدام ديسك جديد
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {visibleTasks.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <p className="text-lg text-slate-600">مفيش حالات في الطابور دلوقتي</p>
                    <p className="text-sm text-slate-400 mt-1">
                        أول ما حالة توصل مرحلتك هتظهر هنا تلقائيًا
                    </p>
                </div>
            )}

            {Array.from(taskGroups, ([stageKey, { label: stageName, tasks: stageTasks }]) => {
                return <section key={stageKey} aria-label={stageName} className="space-y-3">
                    <h2 className="flex items-center gap-3 border-b border-slate-200 pb-2 text-lg font-bold text-slate-900">
                        {stageName} <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-600">{stageTasks.length}</span>
                    </h2>
                    {stageTasks.map((t, i) => {
                const due = dueLabel(t.deliveryDate);
                const mine = t.status === 'in_progress' && t.assigneeId === user?.id;
                const canExecute = t.canExecute ?? true;
                const recommended = canExecute && i === 0 && t.status === 'ready';
                const isMixedQc = isExplicitProductionRoute(t.routeId) && t.stageCode === 'qc';
                const qcActions: MixedPhysicalQcAction[] = [];
                if (isMixedQc && t.failedPhysicalQc && canExecute && user?.role === 'admin') {
                    qcActions.push('return_design');
                    if (t.seq >= 50 && t.supplierId) qcActions.push('return_lab', 'replace_lab');
                    qcActions.push('retry');
                }
                if (isMixedQc && !t.failedPhysicalQc && (t.status === 'ready' || t.status === 'in_progress')
                    && (user?.role === 'admin' || isCoordinator)) {
                    qcActions.push('bypass');
                }

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
                                    {t.isRework && t.stageCode !== 'printing' && (
                                        <span className="text-xs font-bold px-2 py-1 rounded-lg bg-amber-100 text-amber-800">
                                            إعادة شغل
                                        </span>
                                    )}
                                    <span className="text-lg font-bold text-slate-800">{t.caseId}</span>
                                    <span className="rounded-md bg-cyan-50 px-2 py-1 text-sm font-semibold text-cyan-900">{t.stageNameAr}</span>
                                    {t.failedPhysicalQc && <span className="rounded-md bg-rose-50 px-2 py-1 text-sm font-semibold text-rose-800">
                                        لم يجتز الفحص · {issueCauseLabel(t.failedPhysicalQc)}
                                    </span>}
                                    {/* One printer, three resins. Which one is
                                        the difference between a usable print
                                        and a wasted plate, so it goes on the
                                        card rather than somewhere to look up. */}
                                    {t.variantLabel && (
                                        <span className="text-sm font-bold px-2 py-1 rounded-lg bg-indigo-100 text-indigo-800">
                                            {t.variantLabel}
                                        </span>
                                    )}
                                </div>

                                {/* Everything needed to work, with no further clicks. */}
                                <div className="text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                                    <span>د. {t.doctorName}</span>
                                    <span>{t.patientName}</span>
                                    <span>{t.unitsIn} وحدة</span>
                                    {t.shade && <span>اللون: <b>{t.shade}</b></span>}
                                    {t.teeth.length > 0 && <span>{t.isRework && t.stageCode === 'printing' ? 'أسنان الحالة' : 'الأسنان'}: {t.teeth.join('، ')}</span>}
                                    {t.services.length > 0 && <span>{t.services.join('، ')}</span>}
                                </div>

                                {t.doctorLabInstructions && (
                                    <div className="text-xs text-indigo-900 bg-indigo-50 border border-indigo-100 rounded-lg p-2 mt-1">
                                        <span className="font-bold block mb-0.5">تعليمات الطبيب الدائمة للمعمل:</span>
                                        {t.doctorLabInstructions}
                                    </div>
                                )}

                                {t.instructions && (
                                    <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2 mt-1">
                                        {t.instructions}
                                    </p>
                                )}

                                {/* The instruction photos sit here on purpose:
                                    above the start button, so the technician
                                    understands the case before committing to
                                    it rather than after. */}
                                <CaseAttachments
                                    orderId={t.orderId}
                                    kind="instruction"
                                    compact
                                />

                                {/* Evidence, and only where it settles a real
                                    dispute: what left the lab looking like.
                                    Optional -- making it mandatory would break
                                    the two-tap rule for every single case. */}
                                {t.status === 'in_progress'
                                    && (t.stageCode === 'qc' || t.stageCode === 'packaging') && (
                                    <CaseAttachments
                                        orderId={t.orderId}
                                        kind={t.stageCode === 'qc' ? 'qc' : 'packaging'}
                                        stageRunId={t.id}
                                        canUpload
                                        useCamera
                                        compact
                                        label="صوّر الحالة (اختياري)"
                                    />
                                )}

                                <div className="flex items-center gap-4 text-xs text-slate-500 pt-1 flex-wrap">
                                    <span className="inline-flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> مستنية {waitingLabel(t.queuedAt)}
                                    </span>
                                    <span className={due.late ? 'text-red-600 font-bold' : ''}>{due.text}</span>
                                    {(t.designUrl || t.designRevisionId || t.stlUrl) && (
                                        <a
                                            href={t.designUrl || t.stlUrl || '#'}
                                            onClick={e=>{if(t.designUrl || t.designRevisionId){e.preventDefault();void openDesignExecution(t.orderId,t.designUrl||undefined,t.id).catch(err=>toastError(err.message));}}}
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
                            {canExecute || qcActions.length > 0 ? <div className="flex flex-col gap-2 min-w-[140px]">
                                {canExecute && t.status === 'ready' && (
                                    <button
                                        disabled={busyId === t.id}
                                        onClick={() => handleStartTask(t)}
                                        className="flex items-center justify-center gap-2 px-5 py-4 rounded-xl bg-brand-blue text-white font-bold text-lg disabled:opacity-50"
                                    >
                                        <Play className="w-5 h-5" /> ابدأ
                                    </button>
                                )}

                                {canExecute && t.status === 'in_progress' && (
                                    <>
                                        <button
                                            disabled={busyId === t.id}
                                            onClick={() => void run(t.id, () => completeStageRun(t.id), 'خلصت الحالة')}
                                            className="flex items-center justify-center gap-2 px-5 py-4 rounded-xl bg-emerald-600 text-white font-bold text-lg disabled:opacity-50"
                                        >
                                            <Check className="w-5 h-5" /> خلصت
                                        </button>
                                        <button
                                            onClick={() => {
                                                setFailFor(t);
                                                setFailedUnitsCount(isExplicitProductionRoute(t.routeId) && t.stageCode === 'qc' ? t.unitsIn : 1);
                                            }}
                                            className="px-4 py-2 rounded-xl border border-amber-300 text-amber-800 text-sm"
                                        >
                                            {isExplicitProductionRoute(t.routeId) && t.stageCode === 'qc' ? 'الحالة لم تجتز الفحص' : 'فيه وحدة باظت'}
                                        </button>
                                    </>
                                )}

                                {qcActions.map(action => <button
                                    key={action}
                                    disabled={busyId === t.id}
                                    onClick={() => setQcAction({ task: t, action, reason: '' })}
                                    className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900"
                                >
                                    {QC_ACTIONS[action].label}
                                </button>)}
                                {canExecute && !t.failedPhysicalQc && <button
                                    onClick={() => setBlockFor(t)}
                                    className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm"
                                >
                                    بلّغ عن مشكلة
                                </button>}
                            </div> : <span className="self-start rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">للمتابعة</span>}
                        </div>
                    </div>
                );
                    })}
                </section>;
            })}

            {qcAction && <Modal title={QC_ACTIONS[qcAction.action].label} onClose={() => setQcAction(null)}>
                <form className="space-y-3" onSubmit={event => {
                    event.preventDefault();
                    const { task, action, reason } = qcAction;
                    if (!reason.trim()) return;
                    setQcAction(null);
                    void run(task.id, () => recordMixedPhysicalQcAction(task.id, action, reason),
                        QC_ACTIONS[action].success);
                }}>
                    {qcAction.action === 'return_lab' && <p className="text-sm text-slate-600">هتلاقي الحالة تحت جاهزة للإرسال في الشغل الخارجي. استلامها هناك بيفتح فحص جديد.</p>}
                    <label className="block text-sm font-semibold">السبب
                        <textarea required maxLength={1000} value={qcAction.reason} onChange={event => setQcAction({ ...qcAction, reason: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 p-3" />
                    </label>
                    <button type="submit" disabled={!qcAction.reason.trim()} className="min-h-11 rounded-xl bg-cyan-700 px-4 font-semibold text-white disabled:opacity-50">تأكيد</button>
                </form>
            </Modal>}

            {/* The one mandatory input in the whole flow: why a unit failed. */}
            {failFor && (
                <Modal title={`إيه اللي حصل في ${failFor.caseId}؟`} onClose={() => setFailFor(null)}>
                    {failFor.unitsIn > 1 && !(isExplicitProductionRoute(failFor.routeId) && failFor.stageCode === 'qc') && (
                        <div className="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                عدد الوحدات التالفة / الراسبة (من إجمالي {failFor.unitsIn} وحدة):
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="number"
                                    min={1}
                                    max={failFor.unitsIn}
                                    value={failedUnitsCount}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value, 10);
                                        setFailedUnitsCount(isNaN(val) ? 1 : Math.min(failFor.unitsIn, Math.max(1, val)));
                                    }}
                                    className="w-24 px-3 py-1.5 text-center text-sm font-bold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                                <span className="text-xs text-slate-500">
                                    (الوحدات السليمة التي ستمر: {Math.max(0, failFor.unitsIn - failedUnitsCount)})
                                </span>
                            </div>
                        </div>
                    )}
                    <p className="text-sm text-slate-500 mb-3">
                        {failFor.reprintsFailedUnits
                            ? 'اختار سبب التلف. الوحدات التالفة هتظهر في إعادة الطباعة، والحالة هتستنى لحد ما تكتمل.'
                            : isExplicitProductionRoute(failFor.routeId) && failFor.stageCode === 'qc'
                            ? 'اختار سبب الرسوب لإيقاف الحالة قبل التغليف والشحن.'
                            : 'اختار السبب — ده الرقم اللي هيقول لنا نصلّح إيه.'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        {QC_CAUSES.map((code) => (
                            <button
                                key={code}
                                onClick={() => {
                                    const target = failFor;
                                    const actualFailed = target.unitsIn > 1 ? Math.min(target.unitsIn, Math.max(1, failedUnitsCount)) : 1;
                                    const actualPassed = Math.max(0, target.unitsIn - actualFailed);
                                    setFailFor(null);
                                    void run(target.id,
                                        () => completeStageRun(target.id, {
                                            unitsPassed: actualPassed,
                                            unitsFailed: actualFailed,
                                            causeCode: code,
                                        }),
                                        target.reprintsFailedUnits ? 'الوحدات التالفة ظهرت في إعادة الطباعة'
                                            : isExplicitProductionRoute(target.routeId) && target.stageCode === 'qc'
                                            ? 'تم تسجيل نتيجة الفحص وإيقاف الحالة'
                                            : 'اتسجّلت وراحت لإعادة الشغل');
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

            {/* Quick machine selector when stage has multiple active machines */}
            {pickMachineFor && (
                <Modal title={`اختر الجهاز المستخدم لمرحلة ${pickMachineFor.task.stageNameAr}`} onClose={() => setPickMachineFor(null)}>
                    <p className="text-sm text-slate-500 mb-3">
                        اضغط على الجهاز اللي شغال عليه دلوقتي:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {pickMachineFor.availableMachines.map((m) => {
                            const isDown = m.status === 'down';
                            return (
                                <button
                                    key={m.id}
                                    disabled={isDown}
                                    onClick={() => {
                                        const target = pickMachineFor.task;
                                        setPickMachineFor(null);
                                        void run(target.id, () => startStageRun(target.id, m.id), `بدأت الشغل (${m.nameAr})`);
                                    }}
                                    className={`p-4 rounded-xl text-right border transition-all flex flex-col justify-between ${
                                        isDown
                                            ? 'bg-slate-50 border-slate-200 opacity-50 cursor-not-allowed'
                                            : 'bg-white border-slate-200 hover:border-primary-500 hover:bg-primary-50/50 shadow-sm'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold text-slate-900 text-base">{m.nameAr}</span>
                                        <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold">{m.code}</span>
                                    </div>
                                    {isDown ? (
                                        <span className="text-xs text-red-600 font-bold mt-2 flex items-center gap-1">
                                            متوقف / معطل
                                        </span>
                                    ) : (
                                        <span className="text-xs text-emerald-600 font-semibold mt-2">
                                            جاهز للعمل
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
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
