import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';
import { db, type HistoricalObligationsBackfillActionRow, type HistoricalObligationsBackfillBatchResult } from '../../services/db';

type EntityTypeFilter = 'all' | 'doctor' | 'external_lab';
type ReasonFilter = 'all' | 'missing_doctor_receivable' | 'missing_external_lab_payable' | 'missing_external_lab_issue_settlement';

const DEFAULT_PAGE_SIZE = 25;

const emptyResult: HistoricalObligationsBackfillBatchResult = {
    processed: 0,
    createdDoctorReceivables: { count: 0, total: 0 },
    createdExternalLabPayables: { count: 0, total: 0 },
    createdIssueSettlementPayables: { count: 0, total: 0 },
    skippedDuplicate: 0,
    warnings: 0,
    errors: [],
    hasMore: false,
    nextPage: null,
    rows: [],
};

const entityTypeLabels: Record<EntityTypeFilter, string> = {
    all: 'كل الجهات',
    doctor: 'طبيب',
    external_lab: 'معمل خارجي',
};

const reasonLabels: Record<string, string> = {
    all: 'كل الأسباب',
    missing_doctor_receivable: 'مستحق دكتور ناقص',
    missing_external_lab_payable: 'مستحق معمل ناقص',
    missing_external_lab_issue_settlement: 'مستحق معمل لحالة مشكلة/رفض',
};

const actionLabels: Record<HistoricalObligationsBackfillActionRow['action'], string> = {
    would_create: 'سيتم إنشاؤه',
    created: 'تم إنشاؤه',
    skipped_duplicate: 'مكرر / موجود بالفعل',
    warning: 'تحذير',
    error: 'خطأ',
};

const triggerTypeLabels: Record<string, string> = {
    doctor_delivered: 'doctor_delivered',
    external_lab_ready: 'external_lab_ready',
    external_lab_issue_settlement: 'external_lab_issue_settlement',
};

const formatMoney = (value: number) => `${value.toLocaleString()} ج.م`;

const actionBadgeClass = (action: HistoricalObligationsBackfillActionRow['action']) => {
    if (action === 'would_create') return 'bg-blue-50 text-blue-700';
    if (action === 'skipped_duplicate') return 'bg-gray-100 text-gray-700';
    if (action === 'warning') return 'bg-amber-50 text-amber-700';
    if (action === 'error') return 'bg-red-50 text-red-700';
    return 'bg-green-50 text-green-700';
};

export default function HistoricalObligationsBackfillDryRun() {
    const [entityType, setEntityType] = useState<EntityTypeFilter>('all');
    const [reason, setReason] = useState<ReasonFilter>('all');
    const [search, setSearch] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [result, setResult] = useState<HistoricalObligationsBackfillBatchResult>(emptyResult);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const params = useMemo(() => ({
        entityType,
        rowType: 'missing_obligation' as const,
        reason,
        search,
        dateFrom,
        dateTo,
        page,
        pageSize,
        dryRun: true as const,
    }), [dateFrom, dateTo, entityType, page, pageSize, reason, search]);

    useEffect(() => {
        let cancelled = false;

        const runDryRun = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const data = await db.createHistoricalObligationsBackfillBatch(params);
                if (!cancelled) setResult(data);
            } catch (err) {
                console.error('Failed to run historical obligations dry run', err);
                if (!cancelled) {
                    setResult(emptyResult);
                    setError('تعذر تشغيل تجربة تجهيز الالتزامات القديمة');
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        runDryRun();

        return () => {
            cancelled = true;
        };
    }, [params]);

    const resetToFirstPage = (setter: (value: string) => void) => (value: string) => {
        setPage(1);
        setter(value);
    };
    const resetEntityType = (value: string) => {
        setPage(1);
        setEntityType(value as EntityTypeFilter);
    };
    const resetReason = (value: string) => {
        setPage(1);
        setReason(value as ReasonFilter);
    };

    const handlePageSizeChange = (value: string) => {
        setPage(1);
        setPageSize(Number(value));
    };

    return (
        <div className="space-y-5">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-5">
                    <div>
                        <h2 className="text-lg font-black text-gray-900">تجربة تجهيز الالتزامات القديمة</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            هذه تجربة فقط. لن يتم إنشاء أي التزامات أو ربط أي تحصيلات أو تعديل أي حسابات.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setPage(1)}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200"
                    >
                        <RefreshCw size={16} />
                        تشغيل التجربة
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
                    <div className="relative xl:col-span-2">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
                        <input
                            value={search}
                            onChange={event => resetToFirstPage(setSearch)(event.target.value)}
                            className="w-full pr-9 pl-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                            placeholder="بحث برقم الحالة أو اسم المريض أو معرف الأوردر"
                            aria-label="بحث تجربة تجهيز الالتزامات القديمة"
                        />
                    </div>
                    <select aria-label="نوع الجهة" value={entityType} onChange={event => resetEntityType(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        {Object.entries(entityTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select aria-label="سبب التجهيز" value={reason} onChange={event => resetReason(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        {Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input aria-label="من تاريخ" type="date" value={dateFrom} onChange={event => resetToFirstPage(setDateFrom)(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
                    <input aria-label="إلى تاريخ" type="date" value={dateTo} onChange={event => resetToFirstPage(setDateTo)(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
                    <select aria-label="عدد النتائج" value={pageSize} onChange={event => handlePageSizeChange(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-8 gap-3">
                <SummaryTile label="المعالجة" value={result.processed.toLocaleString()} />
                <SummaryTile label="مستحقات دكتور" value={`${result.createdDoctorReceivables.count.toLocaleString()} / ${formatMoney(result.createdDoctorReceivables.total)}`} tone="blue" />
                <SummaryTile label="مستحقات معمل" value={`${result.createdExternalLabPayables.count.toLocaleString()} / ${formatMoney(result.createdExternalLabPayables.total)}`} tone="teal" />
                <SummaryTile label="تسويات مشاكل" value={`${result.createdIssueSettlementPayables.count.toLocaleString()} / ${formatMoney(result.createdIssueSettlementPayables.total)}`} tone="rose" />
                <SummaryTile label="مكررات" value={result.skippedDuplicate.toLocaleString()} />
                <SummaryTile label="تحذيرات" value={result.warnings.toLocaleString()} tone="amber" />
                <SummaryTile label="أخطاء" value={result.errors.length.toLocaleString()} tone="red" />
                <SummaryTile label="صفحة تالية" value={result.hasMore ? String(result.nextPage || '-') : 'لا'} />
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center text-gray-500">جاري تشغيل تجربة تجهيز الالتزامات القديمة...</div>
                ) : error ? (
                    <div className="p-12 text-center text-red-600">{error}</div>
                ) : result.rows.length === 0 ? (
                    <div className="p-12 text-center text-gray-400">لا توجد نتائج في هذه الصفحة</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-gray-50 text-gray-500">
                                <tr>
                                    <th className="p-3 font-bold">الإجراء</th>
                                    <th className="p-3 font-bold">السبب</th>
                                    <th className="p-3 font-bold">Case ID</th>
                                    <th className="p-3 font-bold">اسم المريض</th>
                                    <th className="p-3 font-bold">نوع الجهة</th>
                                    <th className="p-3 font-bold">معرف الجهة</th>
                                    <th className="p-3 font-bold">Trigger</th>
                                    <th className="p-3 font-bold">المبلغ</th>
                                    <th className="p-3 font-bold">الخطأ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {result.rows.map((row, index) => (
                                    <tr key={`${row.orderId}-${row.reason}-${index}`} className="hover:bg-gray-50/80 align-top">
                                        <td className="p-3">
                                            <span className={clsx("inline-flex rounded-full px-2 py-1 text-xs font-bold", actionBadgeClass(row.action))}>
                                                {actionLabels[row.action]}
                                            </span>
                                        </td>
                                        <td className="p-3 text-gray-700">{reasonLabels[row.reason] || row.reason}</td>
                                        <td className="p-3 font-mono font-bold text-gray-800">{row.caseId || '-'}</td>
                                        <td className="p-3 text-gray-700">{row.patientName || '-'}</td>
                                        <td className="p-3 text-gray-700">{row.entityType || '-'}</td>
                                        <td className="p-3 font-mono text-xs text-gray-500">{row.entityId || '-'}</td>
                                        <td className="p-3 font-mono text-xs text-gray-700">{row.triggerType ? triggerTypeLabels[row.triggerType] || row.triggerType : '-'}</td>
                                        <td className="p-3 font-mono font-bold">{row.amount != null ? formatMoney(row.amount) : '-'}</td>
                                        <td className="p-3 text-red-600">{row.error || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-t border-gray-100 bg-gray-50">
                    <div className="text-sm text-gray-500">
                        الصفحة {page} • عدد النتائج المعروضة: {result.rows.length.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={page <= 1 || isLoading}
                            onClick={() => setPage(prev => Math.max(1, prev - 1))}
                            className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-bold disabled:opacity-40"
                        >
                            السابق
                        </button>
                        <button
                            type="button"
                            disabled={!result.hasMore || isLoading}
                            onClick={() => setPage(result.nextPage || page + 1)}
                            className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-bold disabled:opacity-40"
                        >
                            التالي
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SummaryTile({
    label,
    value,
    tone = 'gray',
}: {
    label: string;
    value: string;
    tone?: 'gray' | 'blue' | 'teal' | 'rose' | 'amber' | 'red';
}) {
    const colorClass = {
        gray: 'text-gray-900',
        blue: 'text-blue-700',
        teal: 'text-teal-700',
        rose: 'text-rose-700',
        amber: 'text-amber-700',
        red: 'text-red-700',
    }[tone];

    return (
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={clsx("text-lg font-black", colorClass)}>{value}</p>
        </div>
    );
}
