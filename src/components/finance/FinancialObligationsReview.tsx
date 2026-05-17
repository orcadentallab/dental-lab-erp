import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { db, type FinancialObligationReviewItem, type FinancialObligationsReviewParams } from '../../services/db';

type SelectValue = string;

const PAGE_SIZE = 25;

const entityTypeLabels: Record<string, string> = {
    all: 'كل الجهات',
    doctor: 'طبيب',
    external_lab: 'معمل خارجي',
};

const directionLabels: Record<string, string> = {
    all: 'كل الاتجاهات',
    receivable: 'مستحق لنا',
    payable: 'مستحق علينا',
};

const triggerTypeLabels: Record<string, string> = {
    all: 'كل المحفزات',
    doctor_delivered: 'تسليم نهائي للطبيب',
    external_lab_ready: 'جاهزية نهائية من المعمل',
};

const statusLabels: Record<string, string> = {
    all: 'كل الحالات',
    unpaid: 'غير مسدد',
    partially_paid: 'مسدد جزئيا',
    paid: 'مسدد',
    void: 'ملغي/باطل',
};

const formatMoney = (value: number) => `${value.toLocaleString()} ج.م`;

const formatDate = (date?: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
};

const metadataKeys = [
    'shadowMode',
    'trackingOnly',
    'correctionReason',
    'voidReason',
    'previousDoctorId',
    'newDoctorId',
    'previousSupplierId',
    'newSupplierId',
    'impliedFinalReady',
    'replacedObligationId',
];

const summarizeMetadata = (metadata: Record<string, unknown>) => {
    const parts = metadataKeys
        .filter(key => metadata[key] !== undefined && metadata[key] !== null)
        .map(key => `${key}: ${String(metadata[key])}`);

    return parts.length > 0 ? parts.join(' • ') : '-';
};

export default function FinancialObligationsReview() {
    const [items, setItems] = useState<FinancialObligationReviewItem[]>([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [entityType, setEntityType] = useState<SelectValue>('all');
    const [direction, setDirection] = useState<SelectValue>('all');
    const [status, setStatus] = useState<SelectValue>('all');
    const [triggerType, setTriggerType] = useState<SelectValue>('all');
    const [createdFrom, setCreatedFrom] = useState('');
    const [createdTo, setCreatedTo] = useState('');
    const [search, setSearch] = useState('');

    const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

    const params = useMemo<FinancialObligationsReviewParams>(() => ({
        page,
        pageSize: PAGE_SIZE,
        entityType: entityType as FinancialObligationsReviewParams['entityType'],
        direction: direction as FinancialObligationsReviewParams['direction'],
        status: status as FinancialObligationsReviewParams['status'],
        triggerType: triggerType as FinancialObligationsReviewParams['triggerType'],
        createdFrom,
        createdTo,
        search,
    }), [createdFrom, createdTo, direction, entityType, page, search, status, triggerType]);

    useEffect(() => {
        let cancelled = false;

        const loadObligations = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const result = await db.getFinancialObligationsReview(params);
                if (!cancelled) {
                    setItems(result.data);
                    setCount(result.count);
                }
            } catch (err) {
                console.error('Failed to load financial obligations review', err);
                if (!cancelled) {
                    setError('تعذر تحميل الالتزامات المالية');
                    setItems([]);
                    setCount(0);
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        loadObligations();

        return () => {
            cancelled = true;
        };
    }, [params]);

    const resetToFirstPage = (setter: (value: string) => void) => (value: string) => {
        setPage(1);
        setter(value);
    };

    return (
        <div className="space-y-5">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-5">
                    <div>
                        <h2 className="text-lg font-black text-gray-900">مراجعة الالتزامات المالية</h2>
                        <p className="text-sm text-gray-500 mt-1">عرض داخلي للالتزامات المالية المسجلة في وضع التتبع فقط، ولا يؤثر على الكشوفات أو التقارير الرسمية.</p>
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

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
                    <div className="relative xl:col-span-2">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
                        <input
                            value={search}
                            onChange={event => resetToFirstPage(setSearch)(event.target.value)}
                            className="w-full pr-9 pl-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                            placeholder="بحث برقم الحالة أو معرف الأوردر"
                            aria-label="بحث الالتزامات المالية"
                        />
                    </div>
                    <select aria-label="نوع الجهة" value={entityType} onChange={event => resetToFirstPage(setEntityType)(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        {Object.entries(entityTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select aria-label="الاتجاه" value={direction} onChange={event => resetToFirstPage(setDirection)(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        {Object.entries(directionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select aria-label="الحالة" value={status} onChange={event => resetToFirstPage(setStatus)(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select aria-label="المحفز" value={triggerType} onChange={event => resetToFirstPage(setTriggerType)(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                        {Object.entries(triggerTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input aria-label="من تاريخ الإنشاء" type="date" value={createdFrom} onChange={event => resetToFirstPage(setCreatedFrom)(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
                    <input aria-label="إلى تاريخ الإنشاء" type="date" value={createdTo} onChange={event => resetToFirstPage(setCreatedTo)(event.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center text-gray-500">جاري تحميل الالتزامات المالية...</div>
                ) : error ? (
                    <div className="p-12 text-center text-red-600">{error}</div>
                ) : items.length === 0 ? (
                    <div className="p-12 text-center text-gray-400">لا توجد التزامات مالية مسجلة</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-gray-50 text-gray-500">
                                <tr>
                                    <th className="p-3 font-bold">Case ID</th>
                                    <th className="p-3 font-bold">اسم المريض</th>
                                    <th className="p-3 font-bold">الجهة</th>
                                    <th className="p-3 font-bold">الاتجاه</th>
                                    <th className="p-3 font-bold">المحفز</th>
                                    <th className="p-3 font-bold">الإجمالي</th>
                                    <th className="p-3 font-bold">الصافي</th>
                                    <th className="p-3 font-bold">المتبقي</th>
                                    <th className="p-3 font-bold">الحالة</th>
                                    <th className="p-3 font-bold">تاريخ الاستحقاق</th>
                                    <th className="p-3 font-bold">تاريخ الإنشاء</th>
                                    <th className="p-3 font-bold">ملاحظات</th>
                                    <th className="p-3 font-bold min-w-[280px]">Metadata</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {items.map(item => (
                                    <tr key={item.id} className="hover:bg-gray-50/80 align-top">
                                        <td className="p-3 font-mono text-gray-700">
                                            <div className="font-bold">{item.caseId || '-'}</div>
                                            <div className="text-[11px] text-gray-400 select-all">{item.orderId}</div>
                                        </td>
                                        <td className="p-3 font-bold text-gray-700">{item.patientName || '-'}</td>
                                        <td className="p-3">
                                            <div className="font-bold text-gray-800">{item.entityName || item.entityId}</div>
                                            <div className="text-xs text-gray-400">{entityTypeLabels[item.entityType] || item.entityType}</div>
                                        </td>
                                        <td className="p-3">
                                            <span className={clsx(
                                                "inline-flex rounded-full px-2 py-1 text-xs font-bold",
                                                item.direction === 'receivable' ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                                            )}>
                                                {directionLabels[item.direction] || item.direction}
                                            </span>
                                        </td>
                                        <td className="p-3 text-gray-700">{triggerTypeLabels[item.triggerType] || item.triggerType}</td>
                                        <td className="p-3 font-mono">{formatMoney(item.grossAmount)}</td>
                                        <td className="p-3 font-mono font-bold">{formatMoney(item.netAmount)}</td>
                                        <td className="p-3 font-mono">{formatMoney(item.remainingAmount)}</td>
                                        <td className="p-3">
                                            <span className={clsx(
                                                "inline-flex rounded-full px-2 py-1 text-xs font-bold",
                                                item.status === 'void' ? "bg-gray-100 text-gray-600" : "bg-emerald-50 text-emerald-700"
                                            )}>
                                                {statusLabels[item.status] || item.status}
                                            </span>
                                        </td>
                                        <td className="p-3 font-mono">{formatDate(item.dueDate)}</td>
                                        <td className="p-3 font-mono">{formatDate(item.createdAt)}</td>
                                        <td className="p-3 text-gray-600 max-w-[220px]">{item.notes || '-'}</td>
                                        <td className="p-3 text-xs text-gray-500 leading-6">{summarizeMetadata(item.metadata)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-t border-gray-100 bg-gray-50">
                    <div className="text-sm text-gray-500">
                        صفحة {page} من {totalPages} • إجمالي السجلات: {count.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setPage(prev => Math.max(1, prev - 1))}
                            className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-bold disabled:opacity-40"
                        >
                            السابق
                        </button>
                        <button
                            type="button"
                            disabled={page >= totalPages}
                            onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
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
