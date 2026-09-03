import { useState, useMemo } from 'react';
import {
    FileText,
    Download,
    Package,
    BarChart3,
    Users,
    Search,
    Building2,
    Tag,
    Filter,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    AlertTriangle
} from 'lucide-react';
import { type Order, type Doctor, type Supplier, type Service } from '../../services/db';
import { exportToExcel } from '../../lib/exportUtils';
import clsx from 'clsx';
import { format } from 'date-fns';
import { getDoctorServicePrice } from '../../lib/pricingUtils';
import { isDoctorStatementIncluded, getDoctorReceivableAmount, getLabCostAmount, getOfficialStatementDate, normalizeStatus, isNonProductiveOrder } from '../../constants/orderLifecycle';
import { formatOpenDateRangeLabel, isDateInOpenRange } from '../../utils/dateRange';

export interface OrderAnalysisRow {
    raw: Partial<Order>;
    id: string;
    caseId: string;
    orderDate: string;
    doctorName: string;
    patientName: string;
    supplierName: string;
    hasSupplier: boolean;
    serviceSummary: string;
    totalUnits: number;
    rawUnits: number;
    isNonProductive: boolean;
    /**
     * The order carries a receivable but no order_items — legacy Excel
     * imports whose sheets had no service columns. Kept in the table rather
     * than filtered out, so the totals still tie to the doctor statement.
     */
    hasNoItems: boolean;
    revenue: number;
    cost: number;
    grossProfit: number;
    grossMargin: number;
    isManual: boolean;
    isManualPrice: boolean;
    isManualCost: boolean;
    priceReasons: string;
    costReasons: string;
    manualReasons: string;
    status: string;
}

type SortField =
    | 'caseId'
    | 'orderDate'
    | 'doctorName'
    | 'patientName'
    | 'supplierName'
    | 'serviceSummary'
    | 'totalUnits'
    | 'revenue'
    | 'cost'
    | 'grossProfit'
    | 'grossMargin'
    | 'status';

interface OrderAnalysisTabProps {
    orders: Partial<Order>[];
    doctors: Doctor[];
    suppliers: Supplier[];
    services: Service[];
    /** External start date passed from main Analytics filter */
    externalStartDate?: string;
    /** External end date passed from main Analytics filter */
    externalEndDate?: string;
    /** External human-readable label */
    externalRangeLabel?: string;
}

const getOrderStatusBadgeClass = (status: string) => {
    const s = normalizeStatus(status);
    switch (s) {
        case 'delivered':
        case 'completed':
            return 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold';
        case 'cancelled':
            return 'bg-rose-100 text-rose-800 border border-rose-300 font-bold shadow-xs';
        case 'doctor rejected':
        case 'rejected':
            return 'bg-rose-100 text-rose-800 border border-rose-300 font-bold shadow-xs';
        case 'lab rejected':
            return 'bg-rose-100 text-rose-800 border border-rose-300 font-bold shadow-xs';
        case 'returned for adjustments':
        case 'returned':
            return 'bg-amber-100 text-amber-800 border border-amber-300 font-bold shadow-xs';
        case 'redo':
            return 'bg-orange-100 text-orange-800 border border-orange-300 font-bold shadow-xs';
        case 'under production':
        case 'in progress':
            return 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium';
        case 'ready':
        case 'try in approved':
            return 'bg-teal-50 text-teal-700 border border-teal-200 font-medium';
        case 'try in':
        case 'waiting dr approval':
            return 'bg-yellow-50 text-yellow-700 border border-yellow-200 font-medium';
        default:
            return 'bg-slate-100 text-slate-700 border border-slate-200 font-medium';
    }
};

export default function OrderAnalysisTab({
    orders,
    doctors,
    suppliers,
    services,
    externalStartDate,
    externalEndDate,
    externalRangeLabel,
}: OrderAnalysisTabProps) {
    const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
    const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
    const [selectedServiceId, setSelectedServiceId] = useState<string>('');
    const [pricingTypeFilter, setPricingTypeFilter] = useState<'all' | 'manual' | 'default'>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [pageSize, setPageSize] = useState<number>(25);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [sortColumn, setSortColumn] = useState<SortField | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

    const handleSort = (field: SortField) => {
        if (sortColumn === field) {
            setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortColumn(field);
            const defaultDescFields: SortField[] = ['revenue', 'cost', 'grossProfit', 'grossMargin', 'totalUnits', 'orderDate'];
            setSortDirection(defaultDescFields.includes(field) ? 'desc' : 'asc');
        }
        setCurrentPage(1);
    };

    // Filter orders by date range, doctor, supplier, service, pricing type, search
    const filteredOrdersData = useMemo<OrderAnalysisRow[]>(() => {
        const start = externalStartDate || '';
        const end = externalEndDate || '';
        const result: OrderAnalysisRow[] = [];

        orders.forEach(o => {
            // Membership is decided by the statement rule alone. Orders with no
            // items used to be dropped here, which silently removed 125 legacy
            // imports worth ~185k EGP of receivable — a tenth of the period —
            // and left this tab's KPIs unable to agree with the statement or
            // the P&L. They are carried through with zero units instead.
            if (!isDoctorStatementIncluded(o)) return;

            const orderDate = getOfficialStatementDate(o);
            if (!isDateInOpenRange(orderDate, { start, end })) return;

            // Doctor filter
            if (selectedDoctorId && o.doctorId !== selectedDoctorId) return;

            // Supplier filter
            if (selectedSupplierId === 'internal') {
                if (o.supplierId) return;
            } else if (selectedSupplierId && o.supplierId !== selectedSupplierId) {
                return;
            }

            // Service filter
            const items = o.items ?? [];
            const hasNoItems = items.length === 0;
            if (selectedServiceId) {
                const targetService = services.find(s => s.id === selectedServiceId);
                if (targetService) {
                    const hasService = items.some(it => it.serviceType === targetService.name);
                    if (!hasService) return;
                }
            }

            // Calculations
            const doctor = doctors.find(d => d.id === o.doctorId);
            const supplier = suppliers.find(s => s.id === o.supplierId);
            
            // Revenue / Receivable amount
            const revenue = getDoctorReceivableAmount(o);

            // Production cost, on the P&L's basis. See getLabCostAmount for why
            // a rejected case must not fall back to the orders.cost estimate.
            const cost = getLabCostAmount(o);

            const grossProfit = revenue - cost;
            const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

            // Detect Manual Price / Cost Override
            const hasManualCost = o.manualCost !== null && o.manualCost !== undefined;
            const hasManualDesignPrice = o.manualDesignPrice !== null && o.manualDesignPrice !== undefined;
            const hasDiscount = Boolean(o.discount && o.discount > 0);
            
            const hasItemPriceOverride = items.some(it => {
                if (!it.price || it.price <= 0) return false;
                const sv = services.find(s => s.name === it.serviceType);
                const catalogPrice = getDoctorServicePrice(it.serviceType, sv, doctor, doctors);
                return catalogPrice > 0 && Math.abs(it.price - catalogPrice) > 0.01;
            });

            const isManualPrice = hasDiscount || hasItemPriceOverride;
            const isManualCost = hasManualCost || hasManualDesignPrice;
            const isManual = isManualPrice || isManualCost;

            // Pricing type filter
            if (pricingTypeFilter === 'manual' && !isManual) return;
            if (pricingTypeFilter === 'default' && isManual) return;

            // Search filter
            if (searchQuery.trim()) {
                const query = searchQuery.trim().toLowerCase();
                const caseIdMatch = (o.caseId || '').toLowerCase().includes(query);
                const patientMatch = (o.patientName || '').toLowerCase().includes(query);
                const doctorMatch = (doctor?.name || '').toLowerCase().includes(query);
                const supplierMatch = (supplier?.name || '').toLowerCase().includes(query);
                if (!caseIdMatch && !patientMatch && !doctorMatch && !supplierMatch) return;
            }

            // Summary text for services
            const serviceSummary = hasNoItems
                ? 'بدون تفاصيل خدمات'
                : Array.from(new Set(items.map(it => it.serviceType))).join(' + ');
            const isNonProductive = isNonProductiveOrder(o);
            const rawUnits = items.reduce((sum, it) => sum + (Array.isArray(it.teethNumbers) ? it.teethNumbers.length : 1), 0);
            const totalUnits = isNonProductive ? 0 : rawUnits;

            // Manual reason details for tooltips
            const priceReasons: string[] = [];
            if (hasDiscount) priceReasons.push(`خصم مخصص (${o.discount} ج.م)`);
            if (hasItemPriceOverride) priceReasons.push('أسعار خدمات مخصصة للوحدات');

            const costReasons: string[] = [];
            if (hasManualCost) costReasons.push(`تكلفة معمل يدوي (${o.manualCost} ج.م)`);
            if (hasManualDesignPrice) costReasons.push(`تكلفة تصميم يدوي (${o.manualDesignPrice} ج.م)`);

            const allReasons = [...priceReasons, ...costReasons];

            result.push({
                raw: o,
                id: o.id || '',
                caseId: o.caseId || '—',
                orderDate,
                doctorName: doctor?.name || 'غير معروف',
                patientName: o.patientName || 'غير معروف',
                supplierName: supplier?.name || 'إنتاج داخلي',
                hasSupplier: Boolean(o.supplierId),
                serviceSummary,
                totalUnits,
                rawUnits,
                isNonProductive,
                hasNoItems,
                revenue,
                cost,
                grossProfit,
                grossMargin,
                isManual,
                isManualPrice,
                isManualCost,
                priceReasons: priceReasons.join(' • '),
                costReasons: costReasons.join(' • '),
                manualReasons: allReasons.join(' • '),
                status: o.status || '—',
            });
        });

        return result;
    }, [orders, externalStartDate, externalEndDate, selectedDoctorId, selectedSupplierId, selectedServiceId, services, doctors, suppliers, pricingTypeFilter, searchQuery]);

    // Global Sorting across all filtered orders
    const sortedOrdersData = useMemo(() => {
        if (!sortColumn) return filteredOrdersData;

        return [...filteredOrdersData].sort((a, b) => {
            const valA = a[sortColumn];
            const valB = b[sortColumn];

            if (typeof valA === 'number' && typeof valB === 'number') {
                const diff = valA - valB;
                return sortDirection === 'asc' ? diff : -diff;
            }

            const strA = String(valA || '');
            const strB = String(valB || '');

            const cmp = strA.localeCompare(strB, 'ar', { numeric: true, sensitivity: 'base' });
            return sortDirection === 'asc' ? cmp : -cmp;
        });
    }, [filteredOrdersData, sortColumn, sortDirection]);

    // KPI Aggregates
    const stats = useMemo(() => {
        const totalOrders = filteredOrdersData.length;
        const totalRevenue = filteredOrdersData.reduce((s, x) => s + x.revenue, 0);
        const totalCost = filteredOrdersData.reduce((s, x) => s + x.cost, 0);
        const totalGrossProfit = totalRevenue - totalCost;
        const overallMargin = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;
        const manualCount = filteredOrdersData.filter(x => x.isManual).length;
        const totalUnits = filteredOrdersData.reduce((s, x) => s + x.totalUnits, 0);
        const cancelledCount = filteredOrdersData.filter(x => x.isNonProductive).length;
        const noItemsCount = filteredOrdersData.filter(x => x.hasNoItems).length;
        const noItemsRevenue = filteredOrdersData
            .filter(x => x.hasNoItems)
            .reduce((s, x) => s + x.revenue, 0);

        return {
            totalOrders,
            totalRevenue,
            totalCost,
            totalGrossProfit,
            overallMargin,
            manualCount,
            totalUnits,
            cancelledCount,
            noItemsCount,
            noItemsRevenue
        };
    }, [filteredOrdersData]);

    // Pagination (Slice after sorting across full dataset)
    const totalPages = Math.ceil(sortedOrdersData.length / pageSize) || 1;
    const paginatedOrders = useMemo(() => {
        const startIdx = (currentPage - 1) * pageSize;
        return sortedOrdersData.slice(startIdx, startIdx + pageSize);
    }, [sortedOrdersData, currentPage, pageSize]);

    // Export to Excel
    const handleExportExcel = () => {
        exportToExcel(sortedOrdersData.map(o => ({
            'رقم الحالة': o.caseId,
            'تاريخ الاستحقاق': o.orderDate,
            'الطبيب': o.doctorName,
            'المريض': o.patientName,
            'المعمل الخارجي': o.supplierName,
            'الخدمات': o.serviceSummary,
            'عدد الوحدات': o.hasNoItems ? '—' : o.totalUnits,
            'سعر البيع (ج.م)': Math.round(o.revenue),
            'تسعير البيع': o.isManualPrice ? `يدوي (${o.priceReasons})` : 'افتراضي',
            'التكلفة (ج.م)': Math.round(o.cost),
            'تسعير التكلفة': o.isManualCost ? `يدوي (${o.costReasons})` : 'افتراضي',
            'مجمل الربح (ج.م)': Math.round(o.grossProfit),
            'هامش الربح %': o.grossMargin.toFixed(1) + '%',
            'الحالة': o.status
        })), `تحليل_الأوردرات_${format(new Date(), 'yyyy-MM-dd')}`);
    };

    const renderSortHeader = (label: string, field: SortField, align: 'right' | 'center' = 'right') => {
        const isActive = sortColumn === field;
        return (
            <th
                onClick={() => handleSort(field)}
                className={clsx(
                    "p-3 font-semibold transition-colors cursor-pointer select-none group hover:bg-slate-700/80",
                    align === 'center' ? "text-center" : "text-right",
                    isActive && "bg-teal-900/60 text-teal-300"
                )}
                title={`اضغط للترتيب حسب ${label}`}
            >
                <div className={clsx("flex items-center gap-1.5", align === 'center' ? "justify-center" : "justify-start")}>
                    <span>{label}</span>
                    <span className="shrink-0 transition-opacity">
                        {isActive ? (
                            sortDirection === 'asc' ? (
                                <ArrowUp size={13} className="text-teal-300" />
                            ) : (
                                <ArrowDown size={13} className="text-teal-300" />
                            )
                        ) : (
                            <ArrowUpDown size={12} className="text-slate-400 opacity-40 group-hover:opacity-100" />
                        )}
                    </span>
                </div>
            </th>
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header & Main Filter Bar */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">
                            <FileText className="text-teal-600" size={24} />
                            تحليل الأوردرات والمبيعات
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">
                            عرض مفصل لجميع حالات الفترة مع بيان التكلفة والإيراد وتحديد التسعير اليدوي
                        </p>
                    </div>

                    <button
                        onClick={handleExportExcel}
                        className="bg-white border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                    >
                        <Download size={16} /> تصدير Excel
                    </button>
                </div>

                {/* Main Filter Date Indicator */}
                <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl w-fit">
                    <BarChart3 size={14} className="text-blue-600" />
                    <span className="text-xs font-bold text-blue-700">الفترة الزمنية:</span>
                    <span className="text-xs font-bold text-blue-900">
                        {externalRangeLabel || formatOpenDateRangeLabel({
                            start: externalStartDate,
                            end: externalEndDate,
                        })}
                    </span>
                    <span className="text-[10px] text-blue-500 mr-2">(من فلتر الصفحة الرئيسي)</span>
                </div>

                {/* Sub-Filters Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                    {/* Doctor Filter */}
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                            <Users size={12} className="text-slate-400" />
                            فلتر الطبيب
                        </label>
                        <select
                            aria-label="فلتر الطبيب"
                            value={selectedDoctorId}
                            onChange={(e) => { setSelectedDoctorId(e.target.value); setCurrentPage(1); }}
                            className="w-full bg-white border border-slate-200 text-slate-800 text-xs rounded-lg p-2.5 outline-none focus:border-teal-500"
                        >
                            <option value="">جميع الأطباء ({doctors.length})</option>
                            {doctors.map(d => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* External Lab / Supplier Filter */}
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                            <Building2 size={12} className="text-slate-400" />
                            المعمل الخارجي
                        </label>
                        <select
                            aria-label="فلتر المعمل الخارجي"
                            value={selectedSupplierId}
                            onChange={(e) => { setSelectedSupplierId(e.target.value); setCurrentPage(1); }}
                            className="w-full bg-white border border-slate-200 text-slate-800 text-xs rounded-lg p-2.5 outline-none focus:border-teal-500"
                        >
                            <option value="">جميع الأماكن (داخلي + خارجي)</option>
                            <option value="internal">إنتاج داخلي فقط</option>
                            {suppliers.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Service Filter */}
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                            <Package size={12} className="text-slate-400" />
                            فلتر الخدمة
                        </label>
                        <select
                            aria-label="فلتر الخدمة"
                            value={selectedServiceId}
                            onChange={(e) => { setSelectedServiceId(e.target.value); setCurrentPage(1); }}
                            className="w-full bg-white border border-slate-200 text-slate-800 text-xs rounded-lg p-2.5 outline-none focus:border-teal-500"
                        >
                            <option value="">جميع الخدمات ({services.length})</option>
                            {services.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Pricing Type Filter */}
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                            <Tag size={12} className="text-slate-400" />
                            نوع التسعير / التكلفة
                        </label>
                        <select
                            aria-label="نوع التسعير"
                            value={pricingTypeFilter}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'all' || val === 'manual' || val === 'default') {
                                    setPricingTypeFilter(val);
                                    setCurrentPage(1);
                                }
                            }}
                            className="w-full bg-white border border-slate-200 text-slate-800 text-xs rounded-lg p-2.5 outline-none focus:border-teal-500"
                        >
                            <option value="all">جميع الأنواع</option>
                            <option value="manual">تسعير / تكلفة يدوي فقط</option>
                            <option value="default">تسعير / تكلفة افتراضي فقط</option>
                        </select>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="mt-3 relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="بحث برقم الحالة، اسم المريض، اسم الطبيب، أو المعمل..."
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                        className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:border-teal-500 transition-all"
                    />
                </div>
            </div>

            {/* Summary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-teal-100 shadow-sm text-center">
                    <p className="text-[11px] font-bold text-teal-600 mb-1">إجمالي الأوردرات</p>
                    <p className="text-2xl sm:text-3xl font-black text-slate-800">{stats.totalOrders.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                        {stats.totalUnits.toLocaleString()} وحدة
                        {stats.cancelledCount > 0 && (
                            <span className="text-slate-400 mr-1">({stats.cancelledCount} ملغية)</span>
                        )}
                    </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm text-center">
                    <p className="text-[11px] font-bold text-blue-600 mb-1">إجمالي المبيعات</p>
                    <p className="text-2xl sm:text-3xl font-black text-blue-900">{Math.round(stats.totalRevenue).toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400 mt-1">ج.م</p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-rose-100 shadow-sm text-center">
                    <p className="text-[11px] font-bold text-rose-600 mb-1">تكلفة الإنتاج الكلية</p>
                    <p className="text-2xl sm:text-3xl font-black text-rose-900">{Math.round(stats.totalCost).toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400 mt-1">ج.م</p>
                </div>

                <div className={clsx(
                    "p-4 rounded-2xl border shadow-sm text-center",
                    stats.totalGrossProfit >= 0 ? "bg-white border-emerald-100" : "bg-white border-rose-100"
                )}>
                    <p className={clsx("text-[11px] font-bold mb-1", stats.totalGrossProfit >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        مجمل الربح
                    </p>
                    <p className={clsx("text-2xl sm:text-3xl font-black", stats.totalGrossProfit >= 0 ? "text-emerald-900" : "text-rose-900")}>
                        {Math.round(stats.totalGrossProfit).toLocaleString()}
                    </p>
                    <p className={clsx("text-[10px] font-bold mt-1", stats.overallMargin >= 20 ? "text-emerald-600" : "text-amber-600")}>
                        هامش {stats.overallMargin.toFixed(1)}%
                    </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-amber-100 shadow-sm text-center col-span-2 lg:col-span-1">
                    <p className="text-[11px] font-bold text-amber-600 mb-1">أوردرات بمحددات يدوية</p>
                    <p className="text-2xl sm:text-3xl font-black text-amber-800">{stats.manualCount.toLocaleString()}</p>
                    <p className="text-[10px] text-amber-600 mt-1">
                        {stats.totalOrders > 0 ? ((stats.manualCount / stats.totalOrders) * 100).toFixed(1) : 0}% (سعر أو تكلفة)
                    </p>
                </div>
            </div>

            {/* These orders are real receivables with no service breakdown behind
                them. They belong in the totals, but a reader comparing this tab
                against a per-service report needs to know they carry no units. */}
            {stats.noItemsCount > 0 && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                    <p className="text-xs font-semibold leading-relaxed text-amber-800">
                        فيه <span className="font-bold">{stats.noItemsCount.toLocaleString()}</span> حالة
                        بقيمة <span className="font-mono font-bold">{Math.round(stats.noItemsRevenue).toLocaleString()} ج.م</span>{' '}
                        مسجّلة من غير تفاصيل خدمات (حالات قديمة مستوردة من إكسيل). محسوبة في الإجماليات
                        عشان الأرقام تطابق كشف الحساب، لكن مش داخلة في تحليل الخدمات أو العوائل.
                    </p>
                </div>
            )}

            {/* Orders Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                        <Filter size={16} className="text-teal-600" />
                        سجل الحالات المفوترة
                        <span className="bg-teal-100 text-teal-700 py-0.5 px-2 rounded-full text-xs font-bold">
                            {filteredOrdersData.length} حالة
                        </span>
                    </h3>

                    {/* Page Size Selector */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">عرض:</span>
                        <select
                            aria-label="عدد العناصر في الصفحة"
                            value={pageSize}
                            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                            className="bg-white border border-slate-200 text-xs rounded-lg px-2 py-1 text-slate-700 outline-none"
                        >
                            <option value={15}>15</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>
                </div>

                {filteredOrdersData.length === 0 ? (
                    <div className="p-16 text-center text-slate-400">
                        <Package size={40} className="mx-auto mb-3 opacity-30" />
                        <p className="font-medium text-sm">لا توجد أوردرات مطابقة للفلتر المحدد</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-right">
                            <thead className="bg-slate-800 text-white">
                                <tr>
                                    {renderSortHeader('رقم الحالة', 'caseId', 'right')}
                                    {renderSortHeader('التاريخ', 'orderDate', 'right')}
                                    {renderSortHeader('الطبيب', 'doctorName', 'right')}
                                    {renderSortHeader('المريض', 'patientName', 'right')}
                                    {renderSortHeader('المعمل / الجهة', 'supplierName', 'right')}
                                    {renderSortHeader('الخدمات', 'serviceSummary', 'right')}
                                    {renderSortHeader('الوحدات', 'totalUnits', 'center')}
                                    {renderSortHeader('سعر البيع', 'revenue', 'center')}
                                    {renderSortHeader('التكلفة', 'cost', 'center')}
                                    {renderSortHeader('مجمل الربح', 'grossProfit', 'center')}
                                    {renderSortHeader('الهامش', 'grossMargin', 'center')}
                                    {renderSortHeader('الحالة', 'status', 'center')}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {paginatedOrders.map((o) => (
                                    <tr key={o.id} className="hover:bg-teal-50/20 transition-colors">
                                        {/* Case ID */}
                                        <td className="p-3 font-bold text-slate-800 whitespace-nowrap">
                                            #{o.caseId}
                                        </td>

                                        {/* Statement Date */}
                                        <td className="p-3 text-slate-500 whitespace-nowrap">
                                            {o.orderDate}
                                        </td>

                                        {/* Doctor Name */}
                                        <td className="p-3 font-semibold text-slate-700 max-w-[150px] truncate">
                                            {o.doctorName}
                                        </td>

                                        {/* Patient Name */}
                                        <td className="p-3 text-slate-600 max-w-[130px] truncate">
                                            {o.patientName}
                                        </td>

                                        {/* External Supplier / Internal */}
                                        <td className="p-3">
                                            {o.hasSupplier ? (
                                                <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md font-medium text-[11px]">
                                                    <Building2 size={10} />
                                                    {o.supplierName}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-slate-400 text-[11px]">
                                                    داخلي
                                                </span>
                                            )}
                                        </td>

                                        {/* Services */}
                                        <td
                                            className={clsx("p-3 max-w-[180px] truncate", o.hasNoItems ? "text-amber-700 italic" : "text-slate-700")}
                                            title={o.hasNoItems ? 'حالة قديمة مستوردة من غير تفاصيل خدمات' : o.serviceSummary}
                                        >
                                            {o.serviceSummary}
                                        </td>

                                        {/* Total Units */}
                                        <td className="p-3 text-center">
                                            <span className={clsx(
                                                "font-bold px-2 py-0.5 rounded-md",
                                                o.hasNoItems ? "bg-amber-50 text-amber-600" : o.isNonProductive ? "bg-slate-50 text-slate-400" : "bg-slate-100 text-slate-700"
                                            )}>
                                                {o.hasNoItems ? '—' : o.isNonProductive ? (
                                                    <span title="حالة ملغية/مرفوضة معملياً — لا تُحتسب ضمن وحدات الإنتاج">0 ({o.rawUnits} ملغية)</span>
                                                ) : o.totalUnits}
                                            </span>
                                        </td>

                                        {/* Revenue & Manual Price Badge */}
                                        <td className="p-3 text-center whitespace-nowrap">
                                            <div className="flex items-center justify-center gap-1.5">
                                                <span className="font-bold text-slate-900">
                                                    {Math.round(o.revenue).toLocaleString()} <span className="text-[9px] text-slate-400 font-normal">ج.م</span>
                                                </span>
                                                {o.isManualPrice && (
                                                    <span
                                                        className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold px-1.5 py-0.5 rounded-md cursor-help flex items-center gap-0.5"
                                                        title={`تعديل سعر يدوي: ${o.priceReasons}`}
                                                    >
                                                        <Tag size={9} />
                                                        يدوي
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Cost & Manual Cost Badge */}
                                        <td className="p-3 text-center whitespace-nowrap">
                                            <div className="flex items-center justify-center gap-1.5">
                                                <span className="font-semibold text-rose-600">
                                                    {Math.round(o.cost).toLocaleString()} <span className="text-[9px] text-slate-400 font-normal">ج.م</span>
                                                </span>
                                                {o.isManualCost && (
                                                    <span
                                                        className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold px-1.5 py-0.5 rounded-md cursor-help flex items-center gap-0.5"
                                                        title={`تعديل تكلفة يدوي: ${o.costReasons}`}
                                                    >
                                                        <Tag size={9} />
                                                        يدوي
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Gross Profit */}
                                        <td className="p-3 text-center whitespace-nowrap">
                                            <span className={clsx("font-bold", o.grossProfit >= 0 ? "text-emerald-700" : "text-rose-700")}>
                                                {o.grossProfit >= 0 ? '+' : ''}{Math.round(o.grossProfit).toLocaleString()} <span className="text-[9px] text-slate-400 font-normal">ج.م</span>
                                            </span>
                                        </td>

                                        {/* Gross Margin % */}
                                        <td className="p-3 text-center whitespace-nowrap">
                                            <span className={clsx(
                                                "font-bold px-2 py-0.5 rounded-md text-[11px]",
                                                o.grossMargin >= 40 ? "bg-emerald-50 text-emerald-700" :
                                                    o.grossMargin >= 20 ? "bg-blue-50 text-blue-700" :
                                                        o.grossMargin >= 0 ? "bg-amber-50 text-amber-700" :
                                                            "bg-rose-50 text-rose-700"
                                            )}>
                                                {o.grossMargin.toFixed(1)}%
                                            </span>
                                        </td>

                                         {/* Status */}
                                        <td className="p-3 text-center whitespace-nowrap">
                                            <span className={clsx("px-2.5 py-1 rounded-md text-[10px] inline-block", getOrderStatusBadgeClass(o.status))}>
                                                {o.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>

                            {/* Footer Totals */}
                            <tfoot className="bg-slate-900 text-white text-xs">
                                <tr>
                                    <td colSpan={6} className="p-3.5 font-bold">
                                        الإجمالي النهائي ({filteredOrdersData.length} حالة)
                                    </td>
                                    <td className="p-3.5 text-center font-black text-teal-300">
                                        {stats.totalUnits.toLocaleString()}
                                    </td>
                                    <td className="p-3.5 text-center font-black text-blue-300">
                                        {Math.round(stats.totalRevenue).toLocaleString()} ج.م
                                    </td>
                                    <td className="p-3.5 text-center font-black text-rose-300">
                                        {Math.round(stats.totalCost).toLocaleString()} ج.م
                                    </td>
                                    <td className="p-3.5 text-center font-black text-emerald-300">
                                        {Math.round(stats.totalGrossProfit).toLocaleString()} ج.م
                                    </td>
                                    <td className="p-3.5 text-center font-black">
                                        <span className={clsx("px-2 py-0.5 rounded-md", stats.overallMargin >= 20 ? "bg-emerald-600" : "bg-amber-600")}>
                                            {stats.overallMargin.toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="p-3.5"></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3 bg-slate-50/50">
                        <span className="text-xs text-slate-500">
                            عرض الصفوف من {((currentPage - 1) * pageSize) + 1} إلى {Math.min(currentPage * pageSize, filteredOrdersData.length)} من إجمالي {filteredOrdersData.length}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                            >
                                السابق
                            </button>
                            <span className="px-3 text-xs font-bold text-slate-700">
                                {currentPage} / {totalPages}
                            </span>
                            <button
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                            >
                                التالي
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
