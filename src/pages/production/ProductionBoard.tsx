/**
 * The production board: every case on the floor, in the stage it is sitting in.
 *
 * One column per stage the lab performs. The age counter on each card is the
 * point of the screen -- a case that has been in a column for two days is the
 * bottleneck signal, and it is meant to be visible without anyone running a
 * report.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useToast } from '../../context/ToastContext';
import {
    getOpenStageRuns, getStages,
    type StageRunCard, type ProductionStage,
} from '../../services/supabase/production';
import { RefreshCw, AlertTriangle, Building2 } from 'lucide-react';

/** Anything sitting longer than this is called out rather than left to blend in. */
const STALE_HOURS = 24;

function ageHours(since: string | null): number | null {
    if (!since) return null;
    return (Date.now() - new Date(since).getTime()) / 3_600_000;
}

function ageLabel(since: string | null): string {
    const h = ageHours(since);
    if (h === null) return '—';
    if (h < 1) return `${Math.round(h * 60)} د`;
    if (h < 24) return `${Math.round(h)} س`;
    return `${Math.floor(h / 24)} يوم`;
}

export default function ProductionBoard() {
    const { error: toastError } = useToast();
    const [runs, setRuns] = useState<StageRunCard[]>([]);
    const [stages, setStages] = useState<ProductionStage[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const [r, s] = await Promise.all([getOpenStageRuns(), getStages()]);
            setRuns(r);
            setStages(s);
        } catch (e) {
            console.error('[ProductionBoard] load failed', e);
            toastError('تعذّر تحميل لوحة الإنتاج');
        } finally {
            setLoading(false);
        }
    }, [toastError]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const timer = setInterval(() => { void load(); }, 60_000);
        return () => clearInterval(timer);
    }, [load]);

    // Show every stage that has work, plus every stage the lab always performs,
    // so an empty queue reads as empty rather than as missing.
    const columns = useMemo(() => {
        const withWork = new Set(runs.map((r) => r.stageId));
        return stages.filter((s) => withWork.has(s.id) || s.scope === 'global');
    }, [stages, runs]);

    const stale = runs.filter((r) => (ageHours(r.queuedAt) ?? 0) > STALE_HOURS).length;

    if (loading) return <div className="p-8 text-center text-slate-500">جارِ التحميل…</div>;

    return (
        <div className="space-y-4" dir="rtl">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">لوحة الإنتاج</h1>
                    <p className="text-sm text-slate-500">
                        {runs.length} حالة على الأرض
                        {stale > 0 && (
                            <span className="text-amber-700 font-bold">
                                {' '}· {stale} قاعدة أكتر من يوم
                            </span>
                        )}
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

            {runs.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <p className="text-lg text-slate-600">مفيش حالات في الإنتاج دلوقتي</p>
                    <p className="text-sm text-slate-400 mt-1">
                        الحالات بتظهر هنا أول ما تدخل الإنتاج
                    </p>
                </div>
            )}

            <div className="flex gap-4 overflow-x-auto pb-4">
                {columns.map((stage) => {
                    const sortedItems = [...runs.filter((r) => r.stageId === stage.id)].sort((a, b) => {
                        // 1. in_progress first
                        const inProgress = (r: StageRunCard) => (r.status === 'in_progress' ? 0 : 1);
                        if (inProgress(a) !== inProgress(b)) return inProgress(a) - inProgress(b);

                        // 2. Urgent first
                        const urgent = (r: StageRunCard) => (r.priority === 'Urgent' ? 0 : 1);
                        if (urgent(a) !== urgent(b)) return urgent(a) - urgent(b);

                        // 3. nearest delivery date
                        const due = (r: StageRunCard) => r.deliveryDate ?? '9999-12-31';
                        if (due(a) !== due(b)) return due(a) < due(b) ? -1 : 1;

                        // 4. oldest queued first
                        return (a.queuedAt ?? '') < (b.queuedAt ?? '') ? -1 : 1;
                    });

                    const totalUnits = sortedItems.reduce((sum, r) => sum + (r.unitsIn || 0), 0);
                    const isOverCapacity = Boolean(stage.dailyCapacityUnits && totalUnits > stage.dailyCapacityUnits);

                    return (
                        <div key={stage.id} className="min-w-[270px] w-[270px] flex-shrink-0">
                            <div className={`flex items-center justify-between mb-2 px-2 py-1.5 rounded-xl border ${
                                isOverCapacity ? 'bg-red-50 border-red-200' : 'bg-slate-50/80 border-slate-200'
                            }`}>
                                <div>
                                    <h2 className="font-bold text-slate-800 text-sm">{stage.nameAr}</h2>
                                    {stage.dailyCapacityUnits ? (
                                        <div className="text-[10px] text-slate-500 font-semibold">
                                            السعة: {totalUnits} / {stage.dailyCapacityUnits} وحدة
                                        </div>
                                    ) : (
                                        <div className="text-[10px] text-slate-400 font-medium">
                                            {totalUnits} وحدة
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    {isOverCapacity && (
                                        <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                                            حِمل زائد
                                        </span>
                                    )}
                                    <span className="text-xs px-2 py-0.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-700">
                                        {sortedItems.length}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {sortedItems.length === 0 && (
                                    <div className="text-xs text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-xl">
                                        فاضية
                                    </div>
                                )}

                                {sortedItems.map((r) => {
                                    const isStale = (ageHours(r.queuedAt) ?? 0) > STALE_HOURS;
                                    const isExternal = r.execution === 'external';
                                    return (
                                        <div
                                            key={r.id}
                                            className={`rounded-xl border p-3 space-y-1.5 shadow-sm transition-all ${
                                                isExternal
                                                    ? 'bg-sky-50/30 border-sky-200'
                                                    : isStale
                                                    ? 'bg-amber-50/20 border-amber-300'
                                                    : 'bg-white border-slate-200'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-bold text-slate-900 text-sm">
                                                    {r.caseId}
                                                </span>
                                                <span className={`text-xs ${isStale ? 'text-amber-700 font-bold' : 'text-slate-400'}`}>
                                                    {ageLabel(r.queuedAt)}
                                                </span>
                                            </div>

                                            <div className="text-xs text-slate-600 truncate">
                                                د. {r.doctorName} · <span className="font-bold text-slate-800">{r.unitsIn} وحدة</span>
                                            </div>

                                            {r.deliveryDate && (
                                                <div className="text-[11px] text-slate-500 font-mono">
                                                    التسليم: {new Date(r.deliveryDate).toLocaleDateString('ar-EG')}
                                                </div>
                                            )}

                                            <div className="flex flex-wrap gap-1 pt-1">
                                                {r.priority === 'Urgent' && (
                                                    <Tag className="bg-red-100 text-red-700 font-bold">مستعجل</Tag>
                                                )}
                                                {r.isRework && (
                                                    <Tag className="bg-amber-100 text-amber-800">إعادة</Tag>
                                                )}
                                                {r.status === 'in_progress' && (
                                                    <Tag className="bg-emerald-100 text-emerald-700 font-bold">
                                                        {r.assigneeName ?? 'شغّالة'}
                                                    </Tag>
                                                )}
                                                {isExternal && (
                                                    <Tag className="bg-sky-100 text-sky-800 font-bold">
                                                        <Building2 className="w-3 h-3 inline mr-0.5" />
                                                        {r.supplierName ? `معمل: ${r.supplierName}` : 'معمل خارجي'}
                                                    </Tag>
                                                )}
                                                {r.blockedReason && (
                                                    <Tag className="bg-orange-100 text-orange-800 font-bold">
                                                        <AlertTriangle className="w-3 h-3 inline mr-0.5" /> موقوفة
                                                    </Tag>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function Tag({ children, className }: { children: ReactNode; className: string }) {
    return (
        <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${className}`}>
            {children}
        </span>
    );
}
