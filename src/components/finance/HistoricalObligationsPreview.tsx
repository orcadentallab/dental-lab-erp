import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';
import { db, type HistoricalObligationPreviewRow, type HistoricalObligationsPreviewParams } from '../../services/db';

const DEFAULT_PAGE_SIZE = 50;

const entityTypeLabels: Record<string, string> = {
    all: 'كل الجهات',
    doctor: 'طبيب',
    external_lab: 'معمل خارجي',
};

const rowTypeLabels: Record<string, string> = {
    all: 'كل النتائج',
    missing_obligation: 'التزامات ناقصة',
    missing_data_warning: 'تحذير بيانات',
};

const reasonLabels: Record<string, string> = {
    missing_doctor_receivable: 'مستحق دكتور ناقص',
    missing_external_lab_payable: 'مستحق معمل ناقص',
    missing_external_lab_issue_settlement: 'مستحق معمل لحالة مشكلة/رفض',
    doctor_receivable_missing_doctor: 'دكتور غير محدد',
    doctor_receivable_zero_or_missing_amount: 'قيمة مستحق الدكتور صفر أو غير موجودة',
    external_lab_payable_missing_supplier: 'معمل غير محدد',
    external_lab_payable_zero_or_missing_cost: 'تكلفة المعمل صفر أو غير موجودة',
    try_in_ready_excluded: 'Try-In Ready مستبعد من مستحق المعمل النهائي',
    issue_settlement_missing_admin_amount: 'حالة مشكلة بدون رقم تسوية معمل',
    issue_settlement_missing_supplier: 'حالة مشكلة بها رقم تسوية لكن بدون معمل',
    issue_status_excluded: 'حالة مستبعدة من الباكفيل العادي',
};

const dateBasisLabels: Record<string, string> = {
    actualDeliveryDate: 'تاريخ التسليم الفعلي',
    deliveryDate: 'تاريخ التسليم المطلوب',
    createdAt: 'تاريخ الإنشاء',
};

const costSourceLabels: Record<string, string> = {
    manual: 'تكلفة يدوية',
    default: 'تكلفة افتراضية',
    legacy_manual_inferred: 'تكلفة يدوية قديمة مستنتجة',
    unknown: 'غير محدد',
};

const isEntityTypeParam = (val: string): val is NonNullable<HistoricalObligationsPreviewParams['entityType']> => {
    return ['all', 'doctor', 'external_lab'].includes(val);
};

const isRowTypeParam = (val: string): val is NonNullable<HistoricalObligationsPreviewParams['rowType']> => {
    return ['all', 'missing_obligation', 'missing_data_warning'].includes(val);
};

const formatMoney = (value: number) => `${value.toLocaleString()} ج.م`;

const formatDate = (date?: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
};

const reasonBadgeClass = (row: HistoricalObligationPreviewRow) => {
    if (row.rowType === 'missing_data_warning') return 'bg-amber-50 text-amber-700';
    return row.entityType === 'doctor' ? 'bg-blue-50 text-blue-700' : 'bg-teal-50 text-teal-700';
};

export default function HistoricalObligationsPreview() {
    const [rows, setRows] = useState<HistoricalObligationPreviewRow[]>([]);
    const [counts, setCounts] = useState({
        missingDoctorReceivables: 0,
        missingExternalLabPayables: 0,
        missingIssueSettlementPayables: 0,
        warnings: 0,
        total: 0,
    });
    const [entityType, setEntityType] = useState<HistoricalObligationsPreviewParams['entityType']>('all');
    const [rowType, setRowType] = useState<HistoricalObligationsPreviewParams['rowType']>('all');
    const [search, setSearch] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const params = useMemo<HistoricalObligationsPreviewParams>(() => ({
        entityType,
        rowType,
        search,
        dateFrom,
        dateTo,
        page,
        pageSize,
    }), [dateFrom, dateTo, entityType, page, pageSize, rowType, search]);

    useEffect(() => {
        let cancelled = false;

        const loadPreview = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const result = await db.previewHistoricalObligationsBackfill(params);
                if (!cancelled) {
                    setRows(result.rows);
                    setCounts(result.counts);
                }
            } catch (err) {
                console.error('Failed to load historical obligations preview', err);
                if (!cancelled) {
                    setRows([]);
                    setCounts({
                        missingDoctorReceivables: 0,
                        missingExternalLabPayables: 0,
                        missingIssueSettlementPayables: 0,
                        warnings: 0,
                        total: 0,
                    });
                    setError('تعذر تحميل معاينة الالتزامات القديمة');
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        loadPreview();

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
        if (isEntityTypeParam(value)) {
            setEntityType(value);
        }
    };
    const resetRowType = (value: string) => {
        setPage(1);
        if (isRowTypeParam(value)) {
            setRowType(value);
        }
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
                        <h2 className="text-lg font-black text-gray-900">معاينة الالتزامات القديمة</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            مراجعة داخلية فقط للطلبات القديمة التي قد تحتاج التزامات مالية في نظام التتبع. لا يتم إنشاء أو تعديل أي بيانات من هذه الشاشة.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setPage(1)}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200"
                    >
                        <RefreshCw size={16} />
                        تحديث
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
                            aria-label="بحث معاينة الالتزامات القديمة"
                        />
                    </div>
                    <select aria-label="نوع الجهة" value={entityType} onChange={event => resetEntityType(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        {Object.entries(entityTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select aria-label="نوع الصف" value={rowType} onChange={event => resetRowType(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        {Object.entries(rowTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1">مستحقات دكتور ناقصة</p>
                    <p className="text-xl font-black text-blue-700">{counts.missingDoctorReceivables.toLocaleString()}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1">مستحقات معمل ناقصة</p>
                    <p className="text-xl font-black text-teal-700">{counts.missingExternalLabPayables.toLocaleString()}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1">تسويات مشاكل المعمل</p>
                    <p className="text-xl font-black text-rose-700">{counts.missingIssueSettlementPayables.toLocaleString()}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1">تحذيرات البيانات</p>
                    <p className="text-xl font-black text-amber-700">{counts.warnings.toLocaleString()}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1">إجمالي الصفحة</p>
                    <p className="text-xl font-black text-gray-900">{counts.total.toLocaleString()}</p>
                </div>
            </div>

            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm font-bold text-amber-800">
                الأرقام المعروضة مبنية على الصفحة الحالية فقط لحين إضافة عدّاد شامل لاحقًا
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center text-gray-500">جاري تحميل معاينة الالتزامات القديمة...</div>
                ) : error ? (
                    <div className="p-12 text-center text-red-600">{error}</div>
                ) : rows.length === 0 ? (
                    <div className="p-12 text-center text-gray-400">لا توجد نتائج في هذه الصفحة</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-gray-50 text-gray-500">
                                <tr>
                                    <th className="p-3 font-bold">نوع الصف</th>
                                    <th className="p-3 font-bold">السبب</th>
                                    <th className="p-3 font-bold">Case ID</th>
                                    <th className="p-3 font-bold">اسم المريض</th>
                                    <th className="p-3 font-bold">الحالة</th>
                                    <th className="p-3 font-bold">نوع التسليم</th>
                                    <th className="p-3 font-bold">الدكتور</th>
                                    <th className="p-3 font-bold">المعمل</th>
                                    <th className="p-3 font-bold">المبلغ</th>
                                    <th className="p-3 font-bold">مصدر تكلفة المعمل</th>
                                    <th className="p-3 font-bold">التاريخ</th>
                                    <th className="p-3 font-bold">مصدر التاريخ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {rows.map((row, index) => (
                                    <tr key={`${row.orderId}-${row.reason}-${index}`} className="hover:bg-gray-50/80 align-top">
                                        <td className="p-3">
                                            <span className={clsx(
                                                "inline-flex rounded-full px-2 py-1 text-xs font-bold",
                                                row.rowType === 'missing_data_warning' ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-700"
                                            )}>
                                                {rowTypeLabels[row.rowType] || row.rowType}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <span className={clsx("inline-flex rounded-full px-2 py-1 text-xs font-bold", reasonBadgeClass(row))}>
                                                {reasonLabels[row.reason] || row.reason}
                                            </span>
                                        </td>
                                        <td className="p-3 font-mono font-bold text-gray-800">{row.caseId || '-'}</td>
                                        <td className="p-3 text-gray-700">{row.patientName || '-'}</td>
                                        <td className="p-3 text-gray-700">{row.status || '-'}</td>
                                        <td className="p-3 text-gray-700">{row.deliveryType || '-'}</td>
                                        <td className="p-3 text-gray-700">{row.doctorName || '-'}</td>
                                        <td className="p-3 text-gray-700">{row.supplierName || '-'}</td>
                                        <td className="p-3 font-mono font-bold">{formatMoney(row.amount)}</td>
                                        <td className="p-3 text-gray-600">{row.costSource ? costSourceLabels[row.costSource] : '-'}</td>
                                        <td className="p-3 font-mono">{formatDate(row.date)}</td>
                                        <td className="p-3 text-gray-600">{dateBasisLabels[row.dateBasis] || row.dateBasis}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-t border-gray-100 bg-gray-50">
                    <div className="text-sm text-gray-500">
                        الصفحة {page} • عدد النتائج المعروضة: {rows.length.toLocaleString()}
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
                            disabled={rows.length < pageSize || isLoading}
                            onClick={() => setPage(prev => prev + 1)}
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
