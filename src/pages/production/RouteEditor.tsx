/**
 * Route editor: the ordered list of steps a case on this route walks.
 *
 * WHY A LIST AND NOT A SET OF CHECKBOXES
 *   The screen this replaces ticked stages on and off, because the first model
 *   composed a route as "every global stage, minus the ones this service does
 *   not need". 20260823002000 replaced that model for a reason a checkbox can
 *   never express: a try-in visits QC, packaging and shipping TWICE -- once on
 *   the way to the doctor and again when it comes back -- and printing happens
 *   at two different points with two different resins. A stage is not IN a
 *   route; it occupies a POSITION on it, possibly several.
 *
 * WHY ONE SAVE BUTTON AND NOT SAVE-ON-EVERY-CHANGE
 *   UNIQUE(route_id, step_no) is not deferrable, so moving step 3 above step 2
 *   cannot be two requests -- the first would collide. The whole list is
 *   written in one RPC, which also means an edit is not live until it is
 *   saved. Everything unsaved is therefore marked as unsaved, loudly, and the
 *   preview says out loud that it is showing the SAVED chain: a preview that
 *   quietly lagged the edits would be worse than no preview.
 *
 * WHY THE PREVIEW IS FETCHED AND NOT COMPUTED HERE
 *   get_effective_route_stages is the same function the job builder calls. Any
 *   client-side reimplementation would eventually disagree with it, and the
 *   disagreement would surface as cases walking a chain nobody configured.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../../context/ToastContext';
import {
    getRoutes, getStages, getRouteSteps, saveRouteSteps, getEffectiveRouteStages,
    createRoute, renameRoute, createStage,
    getServicesForRouting, setServiceRoute, setFamilyRoute,
    type ProductionRoute, type ProductionStage, type RouteStep,
    type EffectiveRouteStage, type Execution, type DrivenBy, type ServiceRouteLink,
} from '../../services/supabase/production';
import { db, type ServiceFamily } from '../../services/db';
import {
    Plus, ArrowLeft, Building2, Home, ShieldCheck, Layers, ChevronUp, ChevronDown,
    Trash2, Save, Undo2, Pencil, X, AlertTriangle,
} from 'lucide-react';

/**
 * Job types a step may be reserved for.
 *
 * `lab` is deliberately absent. In this system role 'lab' is an EXTERNAL LAB
 * login (AB_LAP and five others), not an internal production manager -- see
 * getEffectiveRoleLabels() in src/lib/userRoles.ts, which labels it معمل خارجي.
 * Offering it here would invite an admin to hand an internal bench step to a
 * vendor account. It still renders in ROLE_LABELS so a route that already names
 * it is readable rather than blank.
 */
const ASSIGNABLE_ROLES: string[] = ['technician', 'designer', 'admin'];

const ROLE_LABELS: Record<string, string> = {
    technician: 'فني',
    designer: 'مصمم',
    admin: 'أدمن',
    lab: 'معمل خارجي',
};

const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;

/**
 * What advances the step. Exactly one thing may, or the same work gets counted
 * twice (plan rule 4).
 *
 * `order_status` is the one that needs explaining: the outside lab does not use
 * our system, so nobody here can press "started" or "finished" on its behalf.
 * What we do have is the rep moving the order's own status, which already says
 * where the case is. The step follows that instead of asking for a second entry.
 */
const DRIVEN_BY_LABELS: Record<DrivenBy, string> = {
    my_tasks: 'من «مهامي»',
    designer_dashboard: 'من صفحة المصمم',
    external_wo: 'من شاشة الشغل الخارجي',
    order_status: 'من حالة الأوردر نفسها',
};

/** The step's own answer, or the catalogue's when it has none. */
const DRIVEN_BY_CHOICES: { value: string; label: string }[] = [
    { value: '', label: 'زي ما القاموس بيقول' },
    { value: 'order_status', label: DRIVEN_BY_LABELS.order_status },
    { value: 'my_tasks', label: DRIVEN_BY_LABELS.my_tasks },
    { value: 'designer_dashboard', label: DRIVEN_BY_LABELS.designer_dashboard },
    { value: 'external_wo', label: DRIVEN_BY_LABELS.external_wo },
];

function asDrivenBy(value: string): DrivenBy | null {
    return value === 'my_tasks' || value === 'designer_dashboard'
        || value === 'external_wo' || value === 'order_status'
        ? value
        : null;
}

/**
 * The branches routes actually take. Free-form JSON would be a second way to
 * write the same four conditions, and a typo in one of them is a step that
 * silently never appears for anybody.
 */
const CONDITIONS: { label: string; value: Record<string, unknown> | null }[] = [
    { label: 'في كل الحالات', value: null },
    { label: 'حالات التراي إن بس', value: { delivery_type: 'TryIn' } },
    { label: 'الحالات النهائية بس', value: { delivery_type: 'Final' } },
    { label: 'لما التصميم يبقى عندنا (split)', value: { workflow_type: 'split' } },
    { label: 'الإعادات بس', value: { is_redo: true } },
];

const conditionKey = (c: Record<string, unknown> | null) => JSON.stringify(c ?? null);

function conditionLabel(c: Record<string, unknown> | null): string {
    const hit = CONDITIONS.find((x) => conditionKey(x.value) === conditionKey(c));
    return hit ? hit.label : `شرط مخصص: ${JSON.stringify(c)}`;
}

/** Local-only identity for a step the user just added. */
let newKeySeed = 0;
const newKey = () => `new-${++newKeySeed}`;

export default function RouteEditor() {
    const { success, error: toastError } = useToast();
    const [routes, setRoutes] = useState<ProductionRoute[]>([]);
    const [stages, setStages] = useState<ProductionStage[]>([]);
    const [routeId, setRouteId] = useState<string | null>(null);

    /** The saved list, kept so «تراجع» and the dirty check have a baseline. */
    const [savedSteps, setSavedSteps] = useState<RouteStep[]>([]);
    const [steps, setSteps] = useState<RouteStep[]>([]);
    const [legacyRules, setLegacyRules] = useState(0);
    const [openStep, setOpenStep] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [chain, setChain] = useState<EffectiveRouteStage[]>([]);
    const [tryIn, setTryIn] = useState(false);
    const [split, setSplit] = useState(true);

    const [picking, setPicking] = useState(false);
    const [services, setServices] = useState<ServiceRouteLink[]>([]);
    const [families, setFamilies] = useState<ServiceFamily[]>([]);
    const [loading, setLoading] = useState(true);

    const route = routes.find((r) => r.id === routeId);
    const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

    const dirty = useMemo(
        () => JSON.stringify(steps) !== JSON.stringify(savedSteps),
        [steps, savedSteps],
    );

    // ── loading ──────────────────────────────────────────────────────────

    useEffect(() => {
        Promise.all([getRoutes(), getStages(), getServicesForRouting(), db.getServiceFamilies()])
            .then(([r, s, sv, fam]) => {
                setRoutes(r);
                setStages(s);
                setServices(sv);
                setFamilies(fam);
                setRouteId((prev) => prev ?? r.find((x) => !x.isFallback)?.id ?? r[0]?.id ?? null);
            })
            .catch((e) => {
                console.error('[RouteEditor] load failed', e);
                toastError('تعذّر تحميل الخرائط والعوائل');
            })
            .finally(() => setLoading(false));
    }, [toastError]);

    const loadSteps = useCallback(async (id: string) => {
        const { steps: loaded, legacyRuleCount } = await getRouteSteps(id);
        setSavedSteps(loaded);
        setSteps(loaded);
        setLegacyRules(legacyRuleCount);
        setOpenStep(null);
    }, []);

    useEffect(() => {
        if (!routeId) return;
        let alive = true;
        loadSteps(routeId).catch((e) => {
            console.error('[RouteEditor] steps load failed', e);
            if (alive) toastError('تعذّر تحميل خطوات الخريطة');
        });
        return () => { alive = false; };
    }, [routeId, loadSteps, toastError]);

    /**
     * The preview always reflects what is SAVED. Switching route quickly used
     * to let the first response land after the second and show the wrong
     * chain, hence the alive guard.
     */
    useEffect(() => {
        if (!routeId) return;
        let alive = true;

        getEffectiveRouteStages(routeId, {
            delivery_type: tryIn ? 'TryIn' : 'Final',
            workflow_type: split ? 'split' : 'full',
        })
            .then((c) => { if (alive) setChain(c); })
            .catch((e) => {
                console.error('[RouteEditor] chain load failed', e);
                if (alive) toastError('تعذّر تحميل الخط الفعلي');
            });

        return () => { alive = false; };
    }, [routeId, tryIn, split, savedSteps, toastError]);

    // ── step edits, local until saved ─────────────────────────────────────

    const patchStep = (key: string, patch: Partial<RouteStep>) =>
        setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

    /**
     * Deleting a step also clears any "on failure, go back here" pointing at
     * the stage it performed, unless another step still performs that stage.
     * A dangling target is not a loud error: complete_stage_run finds no run at
     * that stage, creates no rework, and blocks the job -- a case stuck for a
     * reason nobody can see on this screen.
     */
    const removeStep = (key: string) =>
        setSteps((prev) => {
            const gone = prev.find((s) => s.key === key);
            const rest = prev.filter((s) => s.key !== key);
            if (!gone) return rest;

            const stageStillOnRoute = rest.some((s) => s.stageId === gone.stageId);
            if (stageStillOnRoute) return rest;

            return rest.map((s) => (
                s.onFailGotoStageId === gone.stageId ? { ...s, onFailGotoStageId: null } : s
            ));
        });

    const moveStep = (index: number, delta: number) =>
        setSteps((prev) => {
            const target = index + delta;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });

    const addStep = useCallback((stageId: string, stageName?: string) => {
        setSteps((prev) => [...prev, {
            key: newKey(),
            stageId,
            nameOverride: null,
            variantLabel: null,
            allowedRoles: [],
            drivenBy: null,
            condition: null,
            executionOverride: null,
            supplierOverride: null,
            advanceMode: null,
            onFailGotoStageId: null,
            parallelGroup: null,
            standardMinutesPerUnit: null,
            standardCostPerUnit: null,
        }]);
        setPicking(false);
        success(`اتضافت «${stageName ?? 'المرحلة'}» في آخر الخط`);
    }, [success]);

    const toggleRole = (step: RouteStep, role: string) =>
        patchStep(step.key, {
            allowedRoles: step.allowedRoles.includes(role)
                ? step.allowedRoles.filter((r) => r !== role)
                : [...step.allowedRoles, role],
        });

    const save = async () => {
        if (!routeId) return;
        if (steps.length === 0) {
            // The server refuses this too. Saying it here saves a round trip
            // and, more importantly, explains WHY: an empty route is not an
            // empty route, it silently becomes the whole global chain.
            toastError('الخريطة لازم يبقى فيها خطوة واحدة على الأقل');
            return;
        }

        // A failure can only send a case BACKWARD. Reordering can leave a step
        // pointing at a stage that now comes after it, and the runtime handles
        // that by quietly blocking the job -- so it is caught here instead.
        const backwards = steps.findIndex((s, i) => s.onFailGotoStageId
            && !steps.slice(0, i).some((p) => p.stageId === s.onFailGotoStageId));
        if (backwards >= 0) {
            const name = steps[backwards].nameOverride
                ?? stageById.get(steps[backwards].stageId)?.nameAr
                ?? `رقم ${backwards + 1}`;
            toastError(
                `خطوة «${name}» بترجّع الرسوب لمرحلة مش قبلها في الخط. `
                + 'ظبّط الترتيب أو غيّر المرحلة اللي بترجعلها.',
            );
            setOpenStep(steps[backwards].key);
            return;
        }

        setSaving(true);
        try {
            await saveRouteSteps(routeId, steps);
            await loadSteps(routeId);
            success('الخطوات اتحفظت — الحالات الشغالة دلوقتي مش هتتأثر');
        } catch (e) {
            console.error('[RouteEditor] save failed', e);
            toastError(e instanceof Error ? e.message : 'تعذّر حفظ الخطوات');
        } finally {
            setSaving(false);
        }
    };

    /** Losing a reordered nine-step chain to a stray click is not acceptable. */
    const guard = (then: () => void) => {
        if (dirty && !window.confirm('فيه تعديلات لسه متحفظتش. تسيبها وتخرج؟')) return;
        then();
    };

    // ── routes and services ───────────────────────────────────────────────

    const addRoute = async () => {
        const name = window.prompt('اسم الخريطة الجديدة');
        if (!name?.trim()) return;
        try {
            const id = await createRoute(name.trim());
            setRoutes(await getRoutes());
            setRouteId(id);
            success('الخريطة اتعملت — ضيف خطواتها دلوقتي');
        } catch (e) {
            console.error('[RouteEditor] create failed', e);
            toastError('تعذّر إنشاء الخريطة');
        }
    };

    const rename = async () => {
        if (!route) return;
        const name = window.prompt('اسم الخريطة', route.nameAr);
        if (!name?.trim() || name.trim() === route.nameAr) return;
        try {
            await renameRoute(route.id, name.trim());
            setRoutes(await getRoutes());
            success('الاسم اتغيّر');
        } catch (e) {
            console.error('[RouteEditor] rename failed', e);
            toastError('تعذّر تغيير الاسم');
        }
    };

    const linkService = async (serviceId: string, currentlyOnThisRoute: boolean) => {
        if (!routeId) return;
        try {
            await setServiceRoute(serviceId, currentlyOnThisRoute ? null : routeId);
            setServices(await getServicesForRouting());
            success(currentlyOnThisRoute ? 'الخدمة اتشالت من الخريطة' : 'الخدمة اترابطت');
        } catch (e) {
            console.error('[RouteEditor] link service failed', e);
            toastError('تعذّر ربط الخدمة');
        }
    };

    const linkFamily = async (familyId: string, currentlyOnThisRoute: boolean) => {
        if (!routeId) return;
        try {
            await setFamilyRoute(familyId, currentlyOnThisRoute ? null : routeId);
            const [freshSv, freshFam] = await Promise.all([getServicesForRouting(), db.getServiceFamilies()]);
            setServices(freshSv);
            setFamilies(freshFam);
            success(currentlyOnThisRoute ? 'العائلة اتشالت من الخريطة' : 'العائلة اترابطت بالخريطة');
        } catch (e) {
            console.error('[RouteEditor] link family failed', e);
            toastError('تعذّر ربط العائلة بالخريطة');
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">جارِ التحميل…</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-4 pb-28" dir="rtl">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">خرائط الإنتاج</h1>
                    <p className="text-sm text-slate-500">
                        الخريطة = المراحل اللي الحالة بتعدّي عليها بالترتيب
                    </p>
                </div>
                <button
                    onClick={() => guard(() => void addRoute())}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-blue text-white"
                >
                    <Plus className="w-4 h-4" /> خريطة جديدة
                </button>
            </div>

            <div className="flex gap-2 flex-wrap">
                {routes.map((r) => (
                    <button
                        key={r.id}
                        onClick={() => guard(() => setRouteId(r.id))}
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

            <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm text-sky-900 space-y-1">
                <p><b>إزاي تشتغل الصفحة دي:</b></p>
                <p>١. اختار خريطة من الأزرار فوق (أو اعمل واحدة جديدة).</p>
                <p>٢. رتّب خطواتها على الشمال — ضيف، أعِد التسمية، احذف، حرّك فوق وتحت، وحدّد مين له حق يشتغل كل خطوة.</p>
                <p>٣. دوس <b>احفظ</b>. التعديل بيسري على الحالات الجديدة بس — اللي شغالة دلوقتي بتكمّل على الخط اللي بدأت بيه.</p>
                <p>٤. تحت: اربط الخدمات اللي هتمشي على الخريطة دي — <b>من غير الربط ده، الحالة بتروح لمعمل خارجي بالكامل زي الوضع القديم.</b></p>
            </div>

            {route?.isFallback && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                    دي الخريطة الافتراضية لأي خدمة لسه متحددلهاش خريطة — يعني <b>كل الحالات دلوقتي</b>.
                    تعديلها بيغيّر سلوك كل الخدمات غير المربوطة.
                </div>
            )}

            {legacyRules > 0 && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800 flex gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                        الخريطة دي فيها {legacyRules} صف من النظام القديم (استثناءات مش خطوات).
                        المحرر ده مش بيعرضهم، و<b>الحفظ هيمسحهم</b>. راجعهم في قاعدة البيانات
                        قبل ما تحفظ لو مش متأكد.
                    </span>
                </div>
            )}

            <div className="grid lg:grid-cols-2 gap-4 items-start">
                {/* ── Left: the ordered steps ──────────────────────────── */}
                <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-bold text-slate-700">
                            خطوات {route?.nameAr ?? 'الخريطة'}
                        </h2>
                        {route && (
                            <button
                                onClick={() => void rename()}
                                className="text-xs text-slate-500 inline-flex items-center gap-1 hover:text-slate-700"
                            >
                                <Pencil className="w-3 h-3" /> غيّر اسم الخريطة
                            </button>
                        )}
                    </div>

                    {steps.length === 0 && (
                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            الخريطة دي مالهاش خطوات. لحد ما تضيف خطوة وتحفظ، الحالات عليها
                            بتمشي على كل المراحل العامة — مش على خط انت اخترته.
                        </p>
                    )}

                    <ol className="space-y-2">
                        {steps.map((step, i) => {
                            const stage = stageById.get(step.stageId);
                            const open = openStep === step.key;
                            const execution = step.executionOverride
                                ?? stage?.defaultExecution ?? 'internal';
                            // The step's own answer wins; the catalogue is the
                            // default, not the rule. Same stage, different
                            // routes, different drivers.
                            const drivenBy: DrivenBy =
                                step.drivenBy ?? stage?.drivenBy ?? 'my_tasks';

                            return (
                                <li key={step.key} className="rounded-xl border border-slate-200 overflow-hidden">
                                    <div className="flex items-start gap-2 p-3">
                                        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                                            {i + 1}
                                        </span>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-slate-800">
                                                    {step.nameOverride || stage?.nameAr || '— مرحلة محذوفة —'}
                                                </span>
                                                {step.nameOverride && stage && (
                                                    <span className="text-[10px] text-slate-400">({stage.nameAr})</span>
                                                )}
                                                {step.variantLabel && (
                                                    <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                                                        {step.variantLabel}
                                                    </span>
                                                )}
                                                {stage?.isQcGate && <ShieldCheck className="w-4 h-4 text-emerald-600" />}
                                                {stage?.isBatchStage && <Layers className="w-4 h-4 text-sky-600" />}
                                            </div>

                                            <div className="flex items-center gap-2 flex-wrap mt-1 text-[10px]">
                                                <span className={`px-2 py-0.5 rounded ${
                                                    execution === 'external'
                                                        ? 'bg-sky-100 text-sky-800'
                                                        : 'bg-emerald-100 text-emerald-800'
                                                }`}>
                                                    {execution === 'external' ? 'خارجي' : 'داخلي'}
                                                </span>
                                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                                                    {step.allowedRoles.length === 0
                                                        ? 'أي حد في الإنتاج'
                                                        : step.allowedRoles.map(roleLabel).join(' · ')}
                                                </span>
                                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500">
                                                    {DRIVEN_BY_LABELS[drivenBy]}
                                                </span>
                                                {step.condition && (
                                                    <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                                                        {conditionLabel(step.condition)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => moveStep(i, -1)}
                                                disabled={i === 0}
                                                aria-label="حرّك لفوق"
                                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30"
                                            >
                                                <ChevronUp className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => moveStep(i, 1)}
                                                disabled={i === steps.length - 1}
                                                aria-label="حرّك لتحت"
                                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30"
                                            >
                                                <ChevronDown className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => setOpenStep(open ? null : step.key)}
                                                className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs"
                                            >
                                                {open ? 'إخفاء' : 'تعديل'}
                                            </button>
                                            <button
                                                onClick={() => removeStep(step.key)}
                                                aria-label="احذف الخطوة"
                                                className="p-1.5 rounded-lg border border-rose-200 text-rose-600"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {open && (
                                        <div className="border-t border-slate-100 bg-slate-50 p-3 space-y-3 text-xs">
                                            {stage?.descriptionAr && (
                                                <p className="text-slate-500">{stage.descriptionAr}</p>
                                            )}

                                            <div className="grid sm:grid-cols-2 gap-3">
                                                <label className="block">
                                                    <span className="text-slate-500 block mb-1">
                                                        اسم الخطوة على الخريطة دي
                                                    </span>
                                                    <input
                                                        value={step.nameOverride ?? ''}
                                                        placeholder={stage?.nameAr ?? ''}
                                                        onChange={(e) => patchStep(step.key, {
                                                            nameOverride: e.target.value.trim() || null,
                                                        })}
                                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5"
                                                    />
                                                </label>

                                                <label className="block">
                                                    <span className="text-slate-500 block mb-1">
                                                        بيتعمل إيه بالظبط (يظهر للفني)
                                                    </span>
                                                    <input
                                                        value={step.variantLabel ?? ''}
                                                        placeholder="مثال: واكس / بروفة / كاست"
                                                        onChange={(e) => patchStep(step.key, {
                                                            variantLabel: e.target.value.trim() || null,
                                                        })}
                                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5"
                                                    />
                                                </label>
                                            </div>

                                            {/* The point of the whole screen: who does this step. */}
                                            <div>
                                                <span className="text-slate-500 block mb-1">
                                                    نوع الوظيفة اللي تشتغل الخطوة دي
                                                </span>
                                                <div className="flex flex-wrap gap-2">
                                                    {ASSIGNABLE_ROLES.map((r) => {
                                                        const on = step.allowedRoles.includes(r);
                                                        return (
                                                            <button
                                                                key={r}
                                                                onClick={() => toggleRole(step, r)}
                                                                className={`px-3 py-1.5 rounded-lg border ${
                                                                    on
                                                                        ? 'bg-brand-blue text-white border-brand-blue'
                                                                        : 'bg-white border-slate-200 text-slate-600'
                                                                }`}
                                                            >
                                                                {roleLabel(r)}
                                                            </button>
                                                        );
                                                    })}
                                                    {/* Legacy values keep a way out; they are not offered. */}
                                                    {step.allowedRoles
                                                        .filter((r) => !ASSIGNABLE_ROLES.includes(r))
                                                        .map((r) => (
                                                            <button
                                                                key={r}
                                                                onClick={() => toggleRole(step, r)}
                                                                className="px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 inline-flex items-center gap-1"
                                                            >
                                                                {roleLabel(r)} <X className="w-3 h-3" />
                                                            </button>
                                                        ))}
                                                </div>
                                                <p className="text-slate-400 mt-1">
                                                    من غير اختيار: أي حد مسموح له يشتغل إنتاج يقدر ياخدها.
                                                </p>
                                            </div>

                                            <div className="grid sm:grid-cols-2 gap-3">
                                                <div>
                                                    <span className="text-slate-500 block mb-1">التنفيذ</span>
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => patchStep(step.key, { executionOverride: 'internal' })}
                                                            className={`px-2 py-1.5 rounded-lg border ${
                                                                execution === 'internal'
                                                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                                                    : 'border-slate-200 text-slate-500'
                                                            }`}
                                                        >
                                                            <Home className="w-3 h-3 inline" /> داخلي
                                                        </button>
                                                        <button
                                                            onClick={() => patchStep(step.key, { executionOverride: 'external' })}
                                                            className={`px-2 py-1.5 rounded-lg border ${
                                                                execution === 'external'
                                                                    ? 'bg-sky-50 border-sky-300 text-sky-800'
                                                                    : 'border-slate-200 text-slate-500'
                                                            }`}
                                                        >
                                                            <Building2 className="w-3 h-3 inline" /> خارجي
                                                        </button>
                                                        {step.executionOverride && (
                                                            <button
                                                                onClick={() => patchStep(step.key, { executionOverride: null })}
                                                                className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-400"
                                                            >
                                                                الافتراضي
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                <label className="block">
                                                    <span className="text-slate-500 block mb-1">
                                                        الخطوة دي بتتحرّك منين
                                                    </span>
                                                    <select
                                                        value={step.drivenBy ?? ''}
                                                        onChange={(e) => patchStep(step.key, {
                                                            drivenBy: asDrivenBy(e.target.value),
                                                        })}
                                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
                                                    >
                                                        {DRIVEN_BY_CHOICES.map((c) => (
                                                            <option key={c.value} value={c.value}>{c.label}</option>
                                                        ))}
                                                    </select>
                                                    <span className="text-slate-400 block mt-1">
                                                        حاجة واحدة بس تحرّك الخطوة — عشان الشغل
                                                        متتحسبش مرتين.
                                                    </span>
                                                </label>

                                                <label className="block">
                                                    <span className="text-slate-500 block mb-1">
                                                        الخطوة دي بتظهر إمتى
                                                    </span>
                                                    <select
                                                        value={conditionKey(step.condition)}
                                                        onChange={(e) => patchStep(step.key, {
                                                            condition: CONDITIONS.find(
                                                                (c) => conditionKey(c.value) === e.target.value,
                                                            )?.value ?? null,
                                                        })}
                                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
                                                    >
                                                        {CONDITIONS.map((c) => (
                                                            <option key={conditionKey(c.value)} value={conditionKey(c.value)}>
                                                                {c.label}
                                                            </option>
                                                        ))}
                                                        {/* A condition written outside this list stays
                                                            selectable so opening the step cannot erase it. */}
                                                        {step.condition
                                                            && !CONDITIONS.some((c) => conditionKey(c.value) === conditionKey(step.condition)) && (
                                                            <option value={conditionKey(step.condition)}>
                                                                {conditionLabel(step.condition)}
                                                            </option>
                                                        )}
                                                    </select>
                                                </label>
                                            </div>

                                            <label className="block">
                                                <span className="text-slate-500 block mb-1">
                                                    لو الحالة رسبت هنا ترجع لأنهي مرحلة
                                                </span>
                                                <select
                                                    value={step.onFailGotoStageId ?? ''}
                                                    onChange={(e) => patchStep(step.key, {
                                                        onFailGotoStageId: e.target.value || null,
                                                    })}
                                                    className="w-full sm:w-auto border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
                                                >
                                                    <option value="">— متكملش، الشغلانة بتقف —</option>
                                                    {/* Only steps EARLIER on this route: sending a case
                                                        back to a stage it has not reached yet is not a
                                                        return, it is a jump forward. */}
                                                    {steps.slice(0, i).map((prev) => (
                                                        <option key={prev.key} value={prev.stageId}>
                                                            {prev.nameOverride
                                                                || stageById.get(prev.stageId)?.nameAr
                                                                || '—'}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ol>

                    <button
                        onClick={() => setPicking(true)}
                        className="w-full py-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-600 inline-flex items-center justify-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> ضيف مرحلة للخط
                    </button>
                </div>

                {/* ── Right: what a case will actually walk ─────────────── */}
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <h2 className="font-bold text-slate-700">الخط الفعلي</h2>
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                            <label className="flex items-center gap-1.5">
                                <input
                                    type="checkbox"
                                    checked={tryIn}
                                    onChange={(e) => setTryIn(e.target.checked)}
                                    className="w-4 h-4 accent-brand-blue"
                                />
                                تراي إن
                            </label>
                            <label className="flex items-center gap-1.5">
                                <input
                                    type="checkbox"
                                    checked={split}
                                    onChange={(e) => setSplit(e.target.checked)}
                                    className="w-4 h-4 accent-brand-blue"
                                />
                                التصميم عندنا
                            </label>
                        </div>
                    </div>

                    <p className="text-xs text-slate-400 mb-3">
                        ده اللي الحالة هتمشي عليه فعلاً — نفس الحساب اللي بيبني الشغلانة.
                    </p>

                    {dirty && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 text-xs text-amber-800 mb-3">
                            ده الخط <b>المحفوظ</b>. تعديلاتك لسه متحفظتش، فمش ظاهرة هنا.
                        </div>
                    )}

                    <ol className={`space-y-2 ${dirty ? 'opacity-50' : ''}`}>
                        {chain.map((s, i) => (
                            <li key={`${s.stageId}-${s.seq}`} className="flex items-center gap-3">
                                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center flex-shrink-0">
                                    {i + 1}
                                </span>
                                <div className="flex-1 flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-slate-800">{s.nameAr}</span>
                                    {/* Same printer, different resin — the step says which. */}
                                    {s.variantLabel && (
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                                            {s.variantLabel}
                                        </span>
                                    )}
                                    {s.allowedRoles.length > 0 && (
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                                            {s.allowedRoles.map(roleLabel).join(' · ')}
                                        </span>
                                    )}
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

            {/* The link that makes any of this apply to a real case. Without a
                service pointing here, the route is configuration nobody uses
                and every order silently falls through to the outside lab. */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
                <div>
                    <h2 className="font-bold text-slate-700 mb-1">الخدمات والعوائل اللي بتمشي على الخريطة دي</h2>
                    <p className="text-xs text-slate-400">
                        يمكنك ربط **عائلة بالكامل** بالخريطة لتطبيقيها تلقائياً على كل خدمات العائلة، أو تخصيص كل خدمة منفردة.
                    </p>
                </div>

                {/* Family Level Linking Section */}
                {families.length > 0 && (
                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                        <span className="text-xs font-bold text-slate-700 block">🔷 ربط عائلة خدمات بالكامل بها:</span>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {families.map((fam) => {
                                const onThis = fam.defaultRouteId === routeId;
                                const onOther = Boolean(fam.defaultRouteId) && !onThis;
                                const otherName = routes.find((r) => r.id === fam.defaultRouteId)?.nameAr;

                                return (
                                    <label
                                        key={fam.id}
                                        className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                                            onThis ? 'border-brand-blue bg-blue-50/70 shadow-xs' : 'border-slate-200 bg-white hover:bg-slate-100/60'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={onThis}
                                            onChange={() => void linkFamily(fam.id, onThis)}
                                            className="w-4 h-4 accent-brand-blue mt-0.5"
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-xs font-bold text-slate-800 truncate">
                                                عائلة: {fam.nameAr}
                                            </span>
                                            {onOther && (
                                                <span className="block text-[10px] text-amber-700 font-semibold">
                                                    على خريطة: {otherName ?? '—'}
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {services.length === 0 && (
                    <p className="text-sm text-slate-400 py-2">مفيش خدمات مسجّلة في السيستم.</p>
                )}

                <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-700 block">🔹 ربط وتخصيص الخدمات الفردية:</span>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {services.map((sv) => {
                            const onThisService = sv.routeId === routeId;
                            const onThisFamily = !sv.routeId && sv.familyRouteId === routeId;
                            const onThis = onThisService || onThisFamily;

                            const onOtherService = Boolean(sv.routeId) && !onThisService;
                            const otherServiceName = routes.find((r) => r.id === sv.routeId)?.nameAr;
                            const familyRouteName = routes.find((r) => r.id === sv.familyRouteId)?.nameAr;

                            return (
                                <label
                                    key={sv.id}
                                    className={`flex items-start gap-2 p-2 rounded-xl border cursor-pointer transition-all ${
                                        onThis ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={onThisService}
                                        onChange={() => void linkService(sv.id, onThisService)}
                                        className="w-4 h-4 accent-brand-blue mt-0.5"
                                    />
                                    <span className="min-w-0">
                                        <span className="block text-sm text-slate-800 truncate">{sv.name}</span>
                                        {onThisFamily && (
                                            <span className="block text-[10px] text-emerald-700 font-semibold">
                                                مرتبطة عبر عائلة: {sv.familyName}
                                            </span>
                                        )}
                                        {onOtherService && (
                                            <span className="block text-[10px] text-amber-700">
                                                على خريطة خاصة: {otherServiceName ?? '—'}
                                            </span>
                                        )}
                                        {!onThisService && sv.familyRouteId && sv.familyRouteId !== routeId && (
                                            <span className="block text-[10px] text-sky-700">
                                                خريطة عائلتها: {familyRouteName ?? '—'}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            </div>

            {picking && (
                <StagePicker
                    stages={stages}
                    onPick={addStep}
                    onClose={() => setPicking(false)}
                    onCreated={async (id, name) => {
                        setStages(await getStages());
                        addStep(id, name);
                    }}
                    onError={toastError}
                />
            )}

            {/* Sticky, because the save is the whole transaction and a route
                left edited-but-unsaved is a route that does nothing. */}
            {dirty && (
                <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 shadow-lg p-3 z-40">
                    <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-sm text-slate-600">
                            فيه تعديلات لسه متحفظتش — {steps.length} خطوة
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setSteps(savedSteps)}
                                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 inline-flex items-center gap-2"
                            >
                                <Undo2 className="w-4 h-4" /> تراجع
                            </button>
                            <button
                                onClick={() => void save()}
                                disabled={saving}
                                className="px-6 py-2 rounded-xl bg-brand-blue text-white font-bold inline-flex items-center gap-2 disabled:opacity-50"
                            >
                                <Save className="w-4 h-4" /> {saving ? 'بيحفظ…' : 'احفظ'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Pick a stage to append, or define one that does not exist yet.
 *
 * Creating a stage lives here rather than on a screen of its own, because the
 * moment anybody discovers a stage is missing is the moment they are laying out
 * a route. Plan 4.1 requires it be configuration rather than a migration -- the
 * lab will add stages (3D print, orthodontics) long after this ships.
 */
function StagePicker({ stages, onPick, onClose, onCreated, onError }: {
    stages: ProductionStage[];
    onPick: (stageId: string, stageName?: string) => void;
    onClose: () => void;
    onCreated: (stageId: string, stageName: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [nameAr, setNameAr] = useState('');
    const [descriptionAr, setDescriptionAr] = useState('');
    const [execution, setExecution] = useState<Execution>('internal');
    const [drivenBy, setDrivenBy] = useState<DrivenBy>('my_tasks');
    const [isQcGate, setIsQcGate] = useState(false);
    const [isBatchStage, setIsBatchStage] = useState(false);

    const create = async () => {
        const name = nameAr.trim();
        if (!name) return;
        setBusy(true);
        try {
            const id = await createStage({
                nameAr: name,
                descriptionAr: descriptionAr.trim() || null,
                execution,
                // An external stage is worked on the vendor screen; offering a
                // choice here would only let the two disagree.
                drivenBy: execution === 'external' ? 'external_wo' : drivenBy,
                isQcGate,
                isBatchStage,
            });
            await onCreated(id, name);
        } catch (e) {
            console.error('[RouteEditor] create stage failed', e);
            onError(e instanceof Error ? e.message : 'تعذّر إضافة المرحلة');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" dir="rtl">
            <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-slate-800">
                        {creating ? 'مرحلة جديدة في القاموس' : 'ضيف مرحلة للخط'}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 text-xl px-2">×</button>
                </div>

                {!creating && (
                    <>
                        <p className="text-xs text-slate-400 mb-3">
                            المرحلة بتتضاف في آخر الخط، وبعدين حرّكها لمكانها.
                            نفس المرحلة ممكن تتكرر أكتر من مرة — الطباعة والجودة بيحصلوا
                            مرتين في حالات التراي إن.
                        </p>

                        <div className="space-y-1.5 mb-4">
                            {stages.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => onPick(s.id, s.nameAr)}
                                    className="w-full text-right p-3 rounded-xl border border-slate-200 hover:bg-slate-50"
                                >
                                    <span className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-slate-800">{s.nameAr}</span>
                                        {s.scope === 'global' && (
                                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">
                                                عامة
                                            </span>
                                        )}
                                        <span className={`text-[10px] px-2 py-0.5 rounded ${
                                            s.defaultExecution === 'external'
                                                ? 'bg-sky-100 text-sky-800'
                                                : 'bg-emerald-100 text-emerald-800'
                                        }`}>
                                            {s.defaultExecution === 'external' ? 'خارجي' : 'داخلي'}
                                        </span>
                                        {s.isQcGate && <ShieldCheck className="w-4 h-4 text-emerald-600" />}
                                        {s.isBatchStage && <Layers className="w-4 h-4 text-sky-600" />}
                                    </span>
                                    {s.descriptionAr && (
                                        <span className="block text-xs text-slate-400 mt-0.5">
                                            {s.descriptionAr}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => setCreating(true)}
                            className="w-full py-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-600 inline-flex items-center justify-center gap-2"
                        >
                            <Plus className="w-4 h-4" /> المرحلة مش في القايمة — اعملها
                        </button>
                    </>
                )}

                {creating && (
                    <div className="space-y-3 text-sm">
                        <label className="block">
                            <span className="text-slate-500 block mb-1">اسم المرحلة</span>
                            <input
                                value={nameAr}
                                onChange={(e) => setNameAr(e.target.value)}
                                placeholder="مثال: طباعة موديل 3D"
                                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                            />
                        </label>

                        <label className="block">
                            <span className="text-slate-500 block mb-1">بيحصل فيها إيه (سطر واحد)</span>
                            <input
                                value={descriptionAr}
                                onChange={(e) => setDescriptionAr(e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                            />
                        </label>

                        <div>
                            <span className="text-slate-500 block mb-1">بتتعمل فين</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setExecution('internal')}
                                    className={`px-3 py-2 rounded-lg border ${
                                        execution === 'internal'
                                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                            : 'border-slate-200 text-slate-500'
                                    }`}
                                >
                                    <Home className="w-3 h-3 inline" /> جوّه المعمل
                                </button>
                                <button
                                    onClick={() => setExecution('external')}
                                    className={`px-3 py-2 rounded-lg border ${
                                        execution === 'external'
                                            ? 'bg-sky-50 border-sky-300 text-sky-800'
                                            : 'border-slate-200 text-slate-500'
                                    }`}
                                >
                                    <Building2 className="w-3 h-3 inline" /> عند مورد خارجي
                                </button>
                            </div>
                        </div>

                        {execution === 'internal' && (
                            <label className="block">
                                <span className="text-slate-500 block mb-1">بتتحرّك من أنهي شاشة</span>
                                <select
                                    value={drivenBy}
                                    onChange={(e) => setDrivenBy(
                                        e.target.value === 'designer_dashboard'
                                            ? 'designer_dashboard'
                                            : 'my_tasks',
                                    )}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
                                >
                                    <option value="my_tasks">{DRIVEN_BY_LABELS.my_tasks}</option>
                                    <option value="designer_dashboard">{DRIVEN_BY_LABELS.designer_dashboard}</option>
                                </select>
                                <span className="text-xs text-slate-400 block mt-1">
                                    كل مرحلة ليها مصدر واحد بيحرّكها — عشان متتحسبش مرتين.
                                </span>
                            </label>
                        )}

                        <label className="flex items-center gap-2 text-slate-700">
                            <input
                                type="checkbox"
                                checked={isQcGate}
                                onChange={(e) => setIsQcGate(e.target.checked)}
                                className="w-4 h-4 accent-brand-blue"
                            />
                            بوابة جودة (بتنجح أو ترسب)
                        </label>

                        <label className="flex items-center gap-2 text-slate-700">
                            <input
                                type="checkbox"
                                checked={isBatchStage}
                                onChange={(e) => setIsBatchStage(e.target.checked)}
                                className="w-4 h-4 accent-brand-blue"
                            />
                            بتشتغل بالدفعة (فرن أو بلاتة فيها كذا حالة)
                        </label>

                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={() => setCreating(false)}
                                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600"
                            >
                                رجوع
                            </button>
                            <button
                                onClick={() => void create()}
                                disabled={busy || !nameAr.trim()}
                                className="flex-1 py-2.5 rounded-xl bg-brand-blue text-white font-bold disabled:opacity-50"
                            >
                                {busy ? 'بيضيف…' : 'اعمل المرحلة وضيفها'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
