/**
 * Route editor: which stages each service walks through.
 *
 * Built around the composition rule, not around a list. Every global stage is
 * already ticked, because a new service is correct with zero configuration.
 * What you do here is record EXCEPTIONS: untick a global stage this service
 * does not need (a crown with no printed cast), tick an optional one it does,
 * or flip a stage in-house for this service only.
 *
 * The right-hand panel is the live chain, computed by the same SQL function
 * the job builder uses -- so the preview can never differ from what production
 * will actually build.
 */
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../context/ToastContext';
import {
    getRoutes, getStages, getRouteRules, getEffectiveRouteStages,
    setRouteStageRule, clearRouteStageRule, createRoute,
    type ProductionRoute, type ProductionStage, type RouteStageRule,
    type EffectiveRouteStage, type Execution,
} from '../../services/supabase/production';
import { Plus, ArrowLeft, Building2, Home, ShieldCheck, Layers } from 'lucide-react';

export default function RouteEditor() {
    const { success, error: toastError } = useToast();
    const [routes, setRoutes] = useState<ProductionRoute[]>([]);
    const [stages, setStages] = useState<ProductionStage[]>([]);
    const [routeId, setRouteId] = useState<string | null>(null);
    const [rules, setRules] = useState<RouteStageRule[]>([]);
    const [chain, setChain] = useState<EffectiveRouteStage[]>([]);
    const [tryIn, setTryIn] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([getRoutes(), getStages()])
            .then(([r, s]) => {
                setRoutes(r);
                setStages(s);
                setRouteId((prev) => prev ?? r.find((x) => !x.isFallback)?.id ?? r[0]?.id ?? null);
            })
            .catch((e) => {
                console.error('[RouteEditor] load failed', e);
                toastError('تعذّر تحميل الخرائط');
            })
            .finally(() => setLoading(false));
    }, [toastError]);

    /**
     * Pure fetch, deliberately holding no state. Keeping it separate lets the
     * effect below guard against a stale response: switching route quickly
     * used to let the first request land after the second and show the wrong
     * chain.
     *
     * The context drives conditional stages -- the doctor-review step only
     * appears for a try-in, which is what the toggle is for.
     */
    const fetchRoute = useCallback(
        (id: string, isTryIn: boolean) => Promise.all([
            getRouteRules(id),
            getEffectiveRouteStages(id, { delivery_type: isTryIn ? 'TryIn' : 'Final' }),
        ]),
        [],
    );

    useEffect(() => {
        if (!routeId) return;
        let alive = true;

        fetchRoute(routeId, tryIn)
            .then(([r, c]) => {
                if (!alive) return;
                setRules(r);
                setChain(c);
            })
            .catch((e) => {
                console.error('[RouteEditor] route load failed', e);
                if (alive) toastError('تعذّر تحميل تفاصيل الخريطة');
            });

        return () => { alive = false; };
    }, [routeId, tryIn, fetchRoute, toastError]);

    /** Re-read after a change the user just made. */
    const refresh = useCallback(async () => {
        if (!routeId) return;
        const [r, c] = await fetchRoute(routeId, tryIn);
        setRules(r);
        setChain(c);
    }, [routeId, tryIn, fetchRoute]);

    const route = routes.find((r) => r.id === routeId);
    const ruleFor = (stageId: string) => rules.find((r) => r.stageId === stageId);

    /** A stage is in the chain when the composition rule says so. */
    const isIncluded = (s: ProductionStage) => {
        const rule = ruleFor(s.id);
        if (route?.ignoresGlobalStages) return Boolean(rule && rule.mode !== 'excluded');
        if (s.scope === 'global') return !rule || rule.mode !== 'excluded';
        return Boolean(rule && rule.mode !== 'excluded');
    };

    const toggle = async (s: ProductionStage) => {
        if (!routeId) return;
        try {
            if (isIncluded(s)) {
                // Turning a global stage off is an explicit exclusion row;
                // turning an optional one off just removes its rule.
                if (s.scope === 'global' && !route?.ignoresGlobalStages) {
                    await setRouteStageRule(routeId, s.id, { mode: 'excluded' });
                } else {
                    await clearRouteStageRule(routeId, s.id);
                }
            } else {
                await setRouteStageRule(routeId, s.id, { mode: 'included' });
            }
            await refresh();
            success('اتحفظت');
        } catch (e) {
            console.error('[RouteEditor] toggle failed', e);
            toastError('تعذّر الحفظ');
        }
    };

    const patchRule = async (
        s: ProductionStage,
        patch: { executionOverride?: Execution | null; onFailGotoStageId?: string | null },
    ) => {
        if (!routeId) return;
        const rule = ruleFor(s.id);
        try {
            await setRouteStageRule(routeId, s.id, {
                mode: rule?.mode === 'excluded' ? 'included' : (rule?.mode ?? 'override'),
                seqOverride: rule?.seqOverride ?? null,
                executionOverride: patch.executionOverride !== undefined
                    ? patch.executionOverride
                    : rule?.executionOverride ?? null,
                onFailGotoStageId: patch.onFailGotoStageId !== undefined
                    ? patch.onFailGotoStageId
                    : rule?.onFailGotoStageId ?? null,
            });
            await refresh();
            success('اتحفظت');
        } catch (e) {
            console.error('[RouteEditor] patch failed', e);
            toastError('تعذّر الحفظ');
        }
    };

    const addRoute = async () => {
        const name = window.prompt('اسم الخريطة الجديدة');
        if (!name?.trim()) return;
        try {
            const id = await createRoute(name.trim());
            setRoutes(await getRoutes());
            setRouteId(id);
            success('الخريطة اتعملت');
        } catch (e) {
            console.error('[RouteEditor] create failed', e);
            toastError('تعذّر إنشاء الخريطة');
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">جارِ التحميل…</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-4" dir="rtl">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">خرائط الإنتاج</h1>
                    <p className="text-sm text-slate-500">
                        المراحل العامة متعلّمة تلقائيًا — شيل العلامة عن اللي الخدمة دي مش محتاجاه
                    </p>
                </div>
                <button
                    onClick={() => void addRoute()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-blue text-white"
                >
                    <Plus className="w-4 h-4" /> خريطة جديدة
                </button>
            </div>

            <div className="flex gap-2 flex-wrap">
                {routes.map((r) => (
                    <button
                        key={r.id}
                        onClick={() => setRouteId(r.id)}
                        className={`px-4 py-2 rounded-xl text-sm border ${
                            r.id === routeId
                                ? 'bg-brand-blue text-white border-brand-blue'
                                : 'bg-white text-slate-600 border-slate-200'
                        }`}
                    >
                        {r.nameAr}
                        {r.isFallback && <span className="text-xs opacity-70"> (افتراضية)</span>}
                    </button>
                ))}
            </div>

            {route?.isFallback && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                    دي الخريطة الافتراضية لأي خدمة لسه متحددلهاش خريطة — نفس الوضع الحالي:
                    الحالة بتخرج بالكامل لمعمل خارجي. تعديلها بيغيّر سلوك كل الخدمات غير المربوطة.
                </div>
            )}

            <div className="grid lg:grid-cols-2 gap-4">
                {/* Left: the exceptions you may record. */}
                <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                    <h2 className="font-bold text-slate-700 mb-2">مراحل المعمل</h2>

                    {stages.map((s) => {
                        const included = isIncluded(s);
                        const rule = ruleFor(s.id);
                        const execution = rule?.executionOverride ?? s.defaultExecution;

                        return (
                            <div
                                key={s.id}
                                className={`rounded-xl border p-3 ${
                                    included ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-70'
                                }`}
                            >
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={included}
                                        onChange={() => void toggle(s)}
                                        className="w-5 h-5 accent-brand-blue"
                                    />
                                    <span className="font-medium text-slate-800">{s.nameAr}</span>
                                    {s.scope === 'global' && (
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">
                                            عامة
                                        </span>
                                    )}
                                    {s.isQcGate && <ShieldCheck className="w-4 h-4 text-emerald-600" />}
                                    {s.isBatchStage && <Layers className="w-4 h-4 text-sky-600" />}
                                </label>

                                {included && (
                                    <div className="flex flex-wrap items-center gap-3 mt-2 pr-8 text-xs">
                                        <div className="flex items-center gap-1">
                                            <span className="text-slate-400">التنفيذ:</span>
                                            <button
                                                onClick={() => void patchRule(s, { executionOverride: 'internal' })}
                                                className={`px-2 py-1 rounded-lg border ${
                                                    execution === 'internal'
                                                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                                        : 'border-slate-200 text-slate-500'
                                                }`}
                                            >
                                                <Home className="w-3 h-3 inline" /> داخلي
                                            </button>
                                            <button
                                                onClick={() => void patchRule(s, { executionOverride: 'external' })}
                                                className={`px-2 py-1 rounded-lg border ${
                                                    execution === 'external'
                                                        ? 'bg-sky-50 border-sky-300 text-sky-800'
                                                        : 'border-slate-200 text-slate-500'
                                                }`}
                                            >
                                                <Building2 className="w-3 h-3 inline" /> خارجي
                                            </button>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            <span className="text-slate-400">لو رسبت ترجع لـ:</span>
                                            <select
                                                value={rule?.onFailGotoStageId ?? ''}
                                                onChange={(e) =>
                                                    void patchRule(s, { onFailGotoStageId: e.target.value || null })}
                                                className="border border-slate-200 rounded-lg px-2 py-1"
                                            >
                                                <option value="">— مفيش —</option>
                                                {stages
                                                    .filter((x) => x.sequence < s.sequence)
                                                    .map((x) => (
                                                        <option key={x.id} value={x.id}>{x.nameAr}</option>
                                                    ))}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Right: what a case will actually walk. */}
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-bold text-slate-700">الخط الفعلي</h2>
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                            <input
                                type="checkbox"
                                checked={tryIn}
                                onChange={(e) => setTryIn(e.target.checked)}
                                className="w-4 h-4 accent-brand-blue"
                            />
                            حالة تراي إن
                        </label>
                    </div>

                    <p className="text-xs text-slate-400 mb-3">
                        ده اللي الحالة هتمشي عليه فعلاً — نفس الحساب اللي بيبني الشغلانة.
                    </p>

                    <ol className="space-y-2">
                        {chain.map((s, i) => (
                            <li key={s.stageId} className="flex items-center gap-3">
                                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center flex-shrink-0">
                                    {i + 1}
                                </span>
                                <div className="flex-1 flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-slate-800">{s.nameAr}</span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded ${
                                        s.execution === 'external'
                                            ? 'bg-sky-100 text-sky-800'
                                            : 'bg-emerald-100 text-emerald-800'
                                    }`}>
                                        {s.execution === 'external' ? 'خارجي' : 'داخلي'}
                                    </span>
                                    {s.advanceMode === 'qc_gate' && (
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                                            بوابة جودة
                                        </span>
                                    )}
                                    {s.appliesWhen && (
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                                            بشرط
                                        </span>
                                    )}
                                </div>
                                {i < chain.length - 1 && (
                                    <ArrowLeft className="w-4 h-4 text-slate-300 flex-shrink-0" />
                                )}
                            </li>
                        ))}
                    </ol>

                    {chain.length === 0 && (
                        <p className="text-sm text-slate-400 text-center py-6">
                            الخريطة دي مالهاش مراحل — الحالة مش هتقدر تدخل إنتاج.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
