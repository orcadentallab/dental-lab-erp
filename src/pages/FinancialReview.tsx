import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    approveFinancialSnapshot,
    buildFinancialSnapshotPayload,
    createFinancialSnapshot,
    getActionableFinancialWarningFlags,
    listFinancialSnapshots,
    type FinancialReportSnapshot,
    type FinancialSnapshotIssueSummary,
    type FinancialSnapshotPayload,
} from '../services/supabase/financialSnapshots';
import {
    listReconciliationFlags,
    resolveReconciliationFlag,
    type ReconciliationFlag,
} from '../services/supabase/reconciliationFlags';
import {
    formatOpenDateRangeLabel,
    isOpenDateRangeValid,
    OPEN_DATE_RANGE_END,
    OPEN_DATE_RANGE_START,
} from '../utils/dateRange';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
};
const money = (value: number) => `${value.toLocaleString('en-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})} ج.م`;

const entityLabel: Record<string, string> = {
    doctor: 'طبيب',
    external_lab: 'مورد',
    designer: 'مصمم',
};

const warningFlagLabel: Record<string, string> = {
    missing_transactions: 'لا توجد حركات مالية مسجلة',
    obligations_without_transactions: 'التزامات بلا حركات مالية',
    payments_without_obligations: 'مدفوعات بلا التزام مقابل',
    issue_settlement_present: 'توجد تسوية رفض أو مشكلة',
    data_missing: 'بيانات مالية ناقصة',
    account_closing_or_dispute_settlement_needed: 'الحساب يحتاج إقفالًا أو تسوية نزاع',
};

const formatStoredRange = (start: string, end: string) => formatOpenDateRangeLabel({
    start: start === OPEN_DATE_RANGE_START ? undefined : start,
    end: end === OPEN_DATE_RANGE_END ? undefined : end,
});

export default function FinancialReview() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'comparison' | 'reconciliation_flags'>('comparison');
    const [periodStart, setPeriodStart] = useState(monthStart);
    const [periodEnd, setPeriodEnd] = useState(today);
    const [label, setLabel] = useState('مراجعة الشهر الحالية');
    const [payload, setPayload] = useState<FinancialSnapshotPayload | null>(null);
    const [issues, setIssues] = useState<FinancialSnapshotIssueSummary | null>(null);
    const [snapshots, setSnapshots] = useState<FinancialReportSnapshot[]>([]);
    const [reconciliationFlags, setReconciliationFlags] = useState<ReconciliationFlag[]>([]);
    const [flagFilter, setFlagFilter] = useState<'open' | 'resolved' | 'all'>('open');
    const [flagLoading, setFlagLoading] = useState(false);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const isAdmin = user?.role === 'admin';
    const isAccountantOrAdmin = user?.role === 'admin' || user?.role === 'accountant';

    const refreshSnapshots = useCallback(async () => {
        const rows = await listFinancialSnapshots();
        setSnapshots(rows);
    }, []);

    const refreshFlags = useCallback(async () => {
        setFlagLoading(true);
        try {
            const rows = await listReconciliationFlags('all');
            setReconciliationFlags(rows);
        } catch (err) {
            console.error('Failed to load reconciliation flags:', err);
        } finally {
            setFlagLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshSnapshots().catch(err => setError(err instanceof Error ? err.message : 'تعذر تحميل النسخ'));
        refreshFlags();
    }, [refreshSnapshots, refreshFlags]);

    const runPreview = async () => {
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            const result = await buildFinancialSnapshotPayload(periodStart, periodEnd);
            setPayload(result.payload);
            setIssues(result.issues);
            setMessage('تم إنشاء المقارنة دون تغيير أي بيانات مالية.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'فشل إنشاء المقارنة');
        } finally {
            setLoading(false);
        }
    };

    const saveDraft = async () => {
        if (!payload || !issues) return;
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            await createFinancialSnapshot({
                periodStart: payload.periodStart,
                periodEnd: payload.periodEnd,
                label,
                payload,
                issues,
            });
            await refreshSnapshots();
            setMessage('تم حفظ Draft Snapshot داخل Supabase. لم يتم اعتماد الشهر.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'فشل حفظ النسخة');
        } finally {
            setLoading(false);
        }
    };

    const approve = async (snapshot: FinancialReportSnapshot) => {
        const reason = snapshot.warningCount > 0
            ? window.prompt('توجد تحذيرات غير حرجة. اكتب سبب الاعتماد:')
            : undefined;
        if (snapshot.warningCount > 0 && !reason?.trim()) return;

        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            await approveFinancialSnapshot(snapshot.id, reason || undefined);
            await refreshSnapshots();
            setMessage('تم اعتماد الـSnapshot وأصبح ثابتًا غير قابل للتعديل أو الحذف.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'فشل اعتماد النسخة');
        } finally {
            setLoading(false);
        }
    };

    const handleResolveFlag = async (flag: ReconciliationFlag) => {
        const notes = window.prompt('ملاحظات معالجة التسوية (اختياري):', '');
        if (notes === null) return;

        setResolvingId(flag.id);
        setError(null);
        setMessage(null);
        try {
            await resolveReconciliationFlag(flag.id, notes.trim() || undefined, user?.id || null);
            await refreshFlags();
            setMessage('تم تحديث حالة التسوية إلى "تم الحل" بنجاح.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'فشل تحديث التسوية');
        } finally {
            setResolvingId(null);
        }
    };

    const previewSummary = payload?.closing.summary;
    const criticalRows = issues?.critical ?? [];
    const warningRows = issues?.warnings ?? [];
    const canSave = isAdmin && payload && issues && !loading;

    const openFlagsCount = useMemo(() => reconciliationFlags.filter(f => f.status === 'open').length, [reconciliationFlags]);
    const filteredFlags = useMemo(() => {
        if (flagFilter === 'all') return reconciliationFlags;
        return reconciliationFlags.filter(f => f.status === flagFilter);
    }, [reconciliationFlags, flagFilter]);

    const groupedCounts = useMemo(() => ({
        doctors: payload?.closing.rows.filter(row => row.entityType === 'doctor').length ?? 0,
        suppliers: payload?.closing.rows.filter(row => row.entityType === 'external_lab').length ?? 0,
        designers: payload?.closing.rows.filter(row => row.entityType === 'designer').length ?? 0,
    }), [payload]);

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6 space-y-6" dir="rtl">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">المراجعة المالية والتسويات</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            مقارنة تقارير النظام مع الالتزامات المالية ومتابعة التسويات والاستحقاقات المعلقة.
                        </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                        canonical-v1 · وضع المراجعة
                    </span>
                </div>

                <div className="mt-5 flex border-b border-gray-200 gap-4">
                    <button
                        type="button"
                        onClick={() => setActiveTab('comparison')}
                        className={`pb-3 text-sm font-bold transition-colors border-b-2 ${
                            activeTab === 'comparison'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        المقارنة والاعتماد الشهري
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('reconciliation_flags')}
                        className={`pb-3 text-sm font-bold transition-colors border-b-2 flex items-center gap-2 ${
                            activeTab === 'reconciliation_flags'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <span>تسويات معلّقة</span>
                        {openFlagsCount > 0 && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                                {openFlagsCount}
                            </span>
                        )}
                    </button>
                </div>

                {message && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
                {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            </section>

            {activeTab === 'comparison' && (
                <>
                    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="grid gap-3 md:grid-cols-4">
                            <label className="text-sm font-medium text-gray-700">
                                من
                                <input
                                    type="date"
                                    value={periodStart}
                                    onChange={event => setPeriodStart(event.target.value)}
                                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"
                                />
                            </label>
                            <label className="text-sm font-medium text-gray-700">
                                إلى
                                <input
                                    type="date"
                                    value={periodEnd}
                                    onChange={event => setPeriodEnd(event.target.value)}
                                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"
                                />
                            </label>
                            <label className="text-sm font-medium text-gray-700 md:col-span-2">
                                اسم النسخة
                                <input
                                    value={label}
                                    onChange={event => setLabel(event.target.value)}
                                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"
                                />
                            </label>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={runPreview}
                                disabled={loading || !isOpenDateRangeValid({ start: periodStart, end: periodEnd })}
                                className="rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white disabled:opacity-50"
                            >
                                {loading ? 'جاري المراجعة...' : 'إنشاء مقارنة'}
                            </button>
                            {canSave && (
                                <button
                                    type="button"
                                    onClick={saveDraft}
                                    className="rounded-xl bg-gray-900 px-5 py-2.5 font-bold text-white"
                                >
                                    حفظ Draft في Supabase
                                </button>
                            )}
                        </div>

                        <p className="mt-2 text-xs text-gray-500">
                            {formatOpenDateRangeLabel({ start: periodStart, end: periodEnd })}
                        </p>
                    </section>

                    {previewSummary && (
                        <>
                            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                <SummaryCard label="الرصيد حسب التقارير الحالية" value={money(previewSummary.totalOfficialBalance)} />
                                <SummaryCard label="الرصيد حسب الالتزامات" value={money(previewSummary.totalObligationBasedBalance)} />
                                <SummaryCard
                                    label="إجمالي الفرق"
                                    value={money(previewSummary.totalDifference)}
                                    danger={Math.abs(previewSummary.totalDifference) >= 0.01}
                                />
                                <SummaryCard
                                    label="أطراف تحتاج مراجعة"
                                    value={String(previewSummary.entitiesWithDifference)}
                                    danger={previewSummary.entitiesWithDifference > 0}
                                />
                            </section>

                            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                                <div className="border-b border-gray-100 p-5">
                                    <h2 className="font-bold text-gray-900">تحذيرات مالية تحتاج مراجعة</h2>
                                    <p className="mt-1 text-sm text-gray-500">
                                        ملاحظة نطاق التاريخ معلوماتية فقط، ولا تُحتسب تحذيرًا. القائمة التالية تعرض التحذيرات القابلة للتصرف فقط.
                                    </p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-gray-50 text-gray-600">
                                            <tr>
                                                <th className="px-4 py-3 text-right">الطرف</th>
                                                <th className="px-4 py-3 text-right">النوع</th>
                                                <th className="px-4 py-3 text-right">سبب التحذير</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {warningRows.map(row => (
                                                <tr key={`warning:${row.entityType}:${row.entityId}`}>
                                                    <td className="px-4 py-3 font-medium text-gray-900">{row.entityName}</td>
                                                    <td className="px-4 py-3">{entityLabel[row.entityType]}</td>
                                                    <td className="px-4 py-3 text-amber-800">
                                                        {getActionableFinancialWarningFlags(row.flags)
                                                            .map(flag => warningFlagLabel[flag] ?? flag)
                                                            .join(' · ')}
                                                    </td>
                                                </tr>
                                            ))}
                                            {warningRows.length === 0 && (
                                                <tr>
                                                    <td colSpan={3} className="px-4 py-8 text-center text-emerald-700">
                                                        لا توجد تحذيرات مالية قابلة للتصرف.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </section>

                            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                                <h2 className="font-bold text-gray-900">
                                    الرصيد الختامي التراكمي — {formatOpenDateRangeLabel({ end: periodEnd })}
                                </h2>
                                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                                    <Badge>أطباء: {groupedCounts.doctors}</Badge>
                                    <Badge>موردون: {groupedCounts.suppliers}</Badge>
                                    <Badge>مصممون: {groupedCounts.designers}</Badge>
                                    <Badge danger={criticalRows.length > 0}>أخطاء حرجة: {criticalRows.length}</Badge>
                                    <Badge danger={false}>تحذيرات: {warningRows.length}</Badge>
                                </div>
                            </section>

                            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                                <div className="border-b border-gray-100 p-5">
                                    <h2 className="font-bold text-gray-900">الفروق التي تمنع الاعتماد</h2>
                                    <p className="mt-1 text-sm text-gray-500">
                                        لا يتم تعديل أي رقم من هذه الشاشة؛ الفروق للمراجعة والمعالجة فقط.
                                    </p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-gray-50 text-gray-600">
                                            <tr>
                                                <th className="px-4 py-3 text-right">الطرف</th>
                                                <th className="px-4 py-3 text-right">النوع</th>
                                                <th className="px-4 py-3 text-right">الحالي</th>
                                                <th className="px-4 py-3 text-right">قيد مدين</th>
                                                <th className="px-4 py-3 text-right">قيد دائن</th>
                                                <th className="px-4 py-3 text-right">بعد الالتزامات والقيود</th>
                                                <th className="px-4 py-3 text-right">الفرق</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {(payload?.closing.rows ?? [])
                                                .filter(row => Math.abs(row.difference) >= 0.01)
                                                .map(row => (
                                                    <tr key={`${row.entityType}:${row.entityId}`}>
                                                        <td className="px-4 py-3 font-medium text-gray-900">{row.entityName}</td>
                                                        <td className="px-4 py-3">{entityLabel[row.entityType]}</td>
                                                        <td className="px-4 py-3">{money(row.officialBalance)}</td>
                                                        <td className="px-4 py-3">{money(row.adjustmentDebitTotal)}</td>
                                                        <td className="px-4 py-3">{money(row.adjustmentCreditTotal)}</td>
                                                        <td className="px-4 py-3">{money(row.obligationBasedBalance)}</td>
                                                        <td className="px-4 py-3 font-bold text-red-700">{money(row.difference)}</td>
                                                    </tr>
                                                ))}
                                            {criticalRows.length === 0 && (
                                                <tr><td colSpan={7} className="px-4 py-8 text-center text-emerald-700">لا توجد فروق حرجة.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </section>

                            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                                <h2 className="font-bold text-gray-900">تشخيص الفروق على مستوى الأوردر</h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    عرض للقراءة فقط يوضح قيمة الأوردر الرسمية مقابل الالتزام الفعال أو الملغي.
                                </p>
                                <div className="mt-4 space-y-3">
                                    {(payload?.closing.rows ?? [])
                                        .filter(row => Math.abs(row.difference) >= 0.01)
                                        .map(row => (
                                            <details
                                                key={`details:${row.entityType}:${row.entityId}`}
                                                className="rounded-xl border border-gray-200 bg-gray-50"
                                            >
                                                <summary className="cursor-pointer px-4 py-3 font-bold text-gray-900">
                                                    {row.entityName} · {entityLabel[row.entityType]} · {money(row.difference)}
                                                    <span className="mr-2 text-xs font-normal text-gray-500">
                                                        ({row.orderDifferences.length} أوردر مختلف)
                                                    </span>
                                                </summary>
                                                <div className="overflow-x-auto border-t border-gray-200 bg-white">
                                                    <table className="min-w-full text-xs">
                                                        <thead className="bg-gray-50 text-gray-600">
                                                            <tr>
                                                                <th className="px-3 py-2 text-right">الأوردر</th>
                                                                <th className="px-3 py-2 text-right">الحالة</th>
                                                                <th className="px-3 py-2 text-right">الرسمي</th>
                                                                <th className="px-3 py-2 text-right">التزام فعال</th>
                                                                <th className="px-3 py-2 text-right">التزام ملغي</th>
                                                                <th className="px-3 py-2 text-right">مصادر الالتزام الفعال</th>
                                                                <th className="px-3 py-2 text-right">التصنيف</th>
                                                                <th className="px-3 py-2 text-right">الفرق</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {row.orderDifferences.map(item => (
                                                                <tr key={`${row.entityType}:${row.entityId}:${item.orderId}`}>
                                                                    <td className="px-3 py-2 font-medium">#{item.caseId}</td>
                                                                    <td className="px-3 py-2">{item.status}</td>
                                                                    <td className="px-3 py-2">{money(item.officialAmount)}</td>
                                                                    <td className="px-3 py-2">{money(item.activeObligationAmount)}</td>
                                                                    <td className="px-3 py-2">{money(item.voidObligationAmount)}</td>
                                                                    <td className="px-3 py-2">
                                                                        {item.activeComponents
                                                                            .map(component => `${component.triggerType} · ${component.source} · ${money(component.amount)}`)
                                                                            .join(' | ') || '—'}
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                        {item.classification === 'missing_obligation'
                                                                            ? 'التزام ناقص'
                                                                            : item.classification === 'date_range_mismatch'
                                                                                ? 'اختلاف فلتر التاريخ'
                                                                            : item.classification === 'orphan_obligation'
                                                                                ? 'التزام دون قيمة رسمية'
                                                                                : 'اختلاف مبلغ'}
                                                                    </td>
                                                                    <td className="px-3 py-2 font-bold text-red-700">{money(item.difference)}</td>
                                                                </tr>
                                                            ))}
                                                            {row.orderDifferences.length === 0 && (
                                                                <tr>
                                                                    <td colSpan={8} className="px-3 py-5 text-center text-amber-700">
                                                                        الفرق ليس مرتبطًا بأوردر واحد داخل النطاق ويحتاج مراجعة تاريخ أو رصيد افتتاحي.
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </details>
                                        ))}
                                </div>
                            </section>
                        </>
                    )}

                    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <h2 className="font-bold text-gray-900">النسخ المحفوظة داخل Supabase</h2>
                        <div className="mt-4 space-y-3">
                            {snapshots.map(snapshot => (
                                <div key={snapshot.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 p-4">
                                    <div>
                                        <p className="font-bold text-gray-900">{snapshot.label}</p>
                                        <p className="mt-1 text-xs text-gray-500">
                                            {formatStoredRange(snapshot.periodStart, snapshot.periodEnd)} · {snapshot.formulaVersion}
                                        </p>
                                        <div className="mt-2 flex gap-2 text-xs">
                                            <Badge danger={snapshot.criticalIssueCount > 0}>حرج: {snapshot.criticalIssueCount}</Badge>
                                            <Badge>تحذير: {snapshot.warningCount}</Badge>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                                            snapshot.status === 'approved'
                                                ? 'bg-emerald-100 text-emerald-800'
                                                : snapshot.status === 'corrective'
                                                    ? 'bg-purple-100 text-purple-800'
                                                    : 'bg-gray-100 text-gray-700'
                                        }`}>
                                            {snapshot.status}
                                        </span>
                                        {isAdmin && snapshot.status === 'draft' && (
                                            <button
                                                type="button"
                                                onClick={() => approve(snapshot)}
                                                disabled={loading || snapshot.criticalIssueCount > 0}
                                                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                                            >
                                                اعتماد
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {snapshots.length === 0 && <p className="py-5 text-center text-sm text-gray-500">لا توجد نسخ محفوظة بعد.</p>}
                        </div>
                    </section>
                </>
            )}

            {activeTab === 'reconciliation_flags' && (
                <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setFlagFilter('open')}
                                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                                    flagFilter === 'open'
                                        ? 'bg-red-600 text-white shadow-sm'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                المعلّقة ({openFlagsCount})
                            </button>
                            <button
                                type="button"
                                onClick={() => setFlagFilter('resolved')}
                                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                                    flagFilter === 'resolved'
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                التي تم حلها ({reconciliationFlags.filter(f => f.status === 'resolved').length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setFlagFilter('all')}
                                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                                    flagFilter === 'all'
                                        ? 'bg-gray-900 text-white shadow-sm'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                الكل ({reconciliationFlags.length})
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={refreshFlags}
                            disabled={flagLoading}
                            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            {flagLoading ? 'جاري التحديث...' : 'تحديث القائمة'}
                        </button>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <div className="border-b border-gray-100 p-5">
                            <h2 className="font-bold text-gray-900">سجل استثناءات التسوية والاستحقاقات المعلّقة</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                توثيق فوري لأي أخطاء أو التزامات يتيمة لم يتم تسويتها آليًا لمراجعتها والتحقق منها.
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 text-gray-600">
                                    <tr>
                                        <th className="px-4 py-3 text-right">التاريخ</th>
                                        <th className="px-4 py-3 text-right">نوع الفلاج</th>
                                        <th className="px-4 py-3 text-right">الأوردر / الطرف</th>
                                        <th className="px-4 py-3 text-right">الدرجة</th>
                                        <th className="px-4 py-3 text-right">الرسالة والتفاصيل</th>
                                        <th className="px-4 py-3 text-right">الحالة</th>
                                        <th className="px-4 py-3 text-center">الإجراء</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredFlags.map(flag => (
                                        <tr key={flag.id} className={flag.status === 'open' ? 'bg-rose-50/20' : ''}>
                                            <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                                                {new Date(flag.createdAt).toLocaleString('ar-EG', {
                                                    dateStyle: 'short',
                                                    timeStyle: 'short',
                                                })}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs font-bold text-gray-800">
                                                {flag.flagType}
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                {flag.orderId && <div className="font-mono text-gray-600">أوردر: {flag.orderId.slice(0, 8)}...</div>}
                                                {flag.entityType && (
                                                    <div className="text-gray-500">
                                                        {entityLabel[flag.entityType] || flag.entityType}
                                                    </div>
                                                )}
                                                {!flag.orderId && !flag.entityType && <span className="text-gray-400">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                                    flag.severity === 'error'
                                                        ? 'bg-red-100 text-red-800'
                                                        : 'bg-amber-100 text-amber-800'
                                                }`}>
                                                    {flag.severity === 'error' ? 'حرج' : 'تحذير'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                <p className="font-medium text-gray-900">{flag.message}</p>
                                                {flag.resolutionNotes && (
                                                    <p className="mt-1 text-emerald-800 bg-emerald-50 p-1.5 rounded-lg border border-emerald-100">
                                                        <span className="font-bold">ملاحظة الحل:</span> {flag.resolutionNotes}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                                    flag.status === 'resolved'
                                                        ? 'bg-emerald-100 text-emerald-800'
                                                        : 'bg-rose-100 text-rose-800'
                                                }`}>
                                                    {flag.status === 'resolved' ? 'تم الحل' : 'معلّق'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {flag.status === 'open' && isAccountantOrAdmin && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleResolveFlag(flag)}
                                                        disabled={resolvingId === flag.id}
                                                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                                    >
                                                        {resolvingId === flag.id ? 'جاري...' : 'تم الحل'}
                                                    </button>
                                                )}
                                                {flag.status === 'resolved' && (
                                                    <span className="text-xs text-gray-400">مكتمل</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredFlags.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                                                {flagLoading ? 'جاري تحميل البيانات...' : 'لا توجد تسويات في هذا الفلتر.'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}

function SummaryCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">{label}</p>
            <p className={`mt-2 text-xl font-bold ${danger ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
        </div>
    );
}

function Badge({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
    return (
        <span className={`rounded-full px-3 py-1 font-medium ${
            danger ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'
        }`}>
            {children}
        </span>
    );
}
