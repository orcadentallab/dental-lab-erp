import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    approveFinancialSnapshot,
    buildFinancialSnapshotPayload,
    createFinancialSnapshot,
    listFinancialSnapshots,
    type FinancialReportSnapshot,
    type FinancialSnapshotIssueSummary,
    type FinancialSnapshotPayload,
} from '../services/supabase/financialSnapshots';

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

export default function FinancialReview() {
    const { user } = useAuth();
    const [periodStart, setPeriodStart] = useState(monthStart);
    const [periodEnd, setPeriodEnd] = useState(today);
    const [label, setLabel] = useState('مراجعة الشهر الحالية');
    const [payload, setPayload] = useState<FinancialSnapshotPayload | null>(null);
    const [issues, setIssues] = useState<FinancialSnapshotIssueSummary | null>(null);
    const [snapshots, setSnapshots] = useState<FinancialReportSnapshot[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const isAdmin = user?.role === 'admin';

    const refreshSnapshots = useCallback(async () => {
        const rows = await listFinancialSnapshots();
        setSnapshots(rows);
    }, []);

    useEffect(() => {
        refreshSnapshots().catch(err => setError(err instanceof Error ? err.message : 'تعذر تحميل النسخ'));
    }, [refreshSnapshots]);

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
                periodStart,
                periodEnd,
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

    const previewSummary = payload?.closing.summary;
    const criticalRows = issues?.critical ?? [];
    const warningRows = issues?.warnings ?? [];
    const canSave = isAdmin && payload && issues && !loading;

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
                        <h1 className="text-2xl font-bold text-gray-900">المراجعة المالية الموحدة</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            مقارنة تقارير النظام الحالية مع الالتزامات المالية — دون تحويل كشوف الحساب الحالية.
                        </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                        canonical-v1 · وضع المقارنة
                    </span>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
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
                        disabled={loading || !periodStart || !periodEnd || periodStart > periodEnd}
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

                {message && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
                {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
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

                    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <h2 className="font-bold text-gray-900">الرصيد الختامي التراكمي حتى {periodEnd}</h2>
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
                                    {snapshot.periodStart} — {snapshot.periodEnd} · {snapshot.formulaVersion}
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
