import { useState, useEffect, useMemo } from 'react';
import {
    TrendingUp, Search, AlertTriangle, RefreshCw, Layers, Users, Grid3x3
} from 'lucide-react';
import clsx from 'clsx';
import {
    analyticsService,
    type DoctorServiceProfitability,
    type DoctorServiceProfitabilityRow,
    type DoctorSegmentationInput,
    type DoctorReceivable,
} from '../services/supabase/analyticsService';
import { matchArabic } from '../lib/searchUtils';
import DoctorSegmentationTab from '../components/reports/DoctorSegmentationTab';
import { useReportDateRange } from '../hooks/useReportDateRange';
import ReportDateRangeFilter from '../components/reports/ReportDateRangeFilter';

type TabType = 'profitability' | 'segmentation';
type GroupMode = 'detail' | 'doctor' | 'service';
type SortKey = 'gross_profit' | 'revenue' | 'cost' | 'margin_pct' | 'units' | 'redo_cost';

const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * An aggregate row. `margin_pct` is recomputed from the summed revenue and
 * cost rather than averaged from the child rows — averaging percentages
 * weights a one-unit row the same as a hundred-unit one.
 */
interface AggregateRow {
    key: string;
    label: string;
    sublabel: string | null;
    isCatalogService: boolean;
    units: number;
    revenue: number;
    cost: number;
    gross_profit: number;
    margin_pct: number | null;
    redo_cost: number;
    redo_units: number;
}

function toAggregate(key: string, label: string, sublabel: string | null, rows: DoctorServiceProfitabilityRow[]): AggregateRow {
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    return {
        key,
        label,
        sublabel,
        isCatalogService: rows.every(r => r.is_catalog_service),
        units: rows.reduce((s, r) => s + r.units, 0),
        revenue,
        cost,
        gross_profit: revenue - cost,
        margin_pct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
        redo_cost: rows.reduce((s, r) => s + r.redo_cost, 0),
        redo_units: rows.reduce((s, r) => s + r.redo_units, 0),
    };
}

export default function DoctorServiceProfitabilityPage() {
    const dateRange = useReportDateRange('current_month');
    const { startDate, endDate } = dateRange;
    const [groupMode, setGroupMode] = useState<GroupMode>('detail');
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('gross_profit');
    const [sortAsc, setSortAsc] = useState(false);

    const [activeTab, setActiveTab] = useState<TabType>('profitability');
    const [data, setData] = useState<DoctorServiceProfitability | null>(null);
    const [segmentationInputs, setSegmentationInputs] = useState<DoctorSegmentationInput[]>([]);
    const [receivables, setReceivables] = useState<DoctorReceivable[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;

        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                // All three together: the grading tab needs profit from the
                // first, volume from the second and aging from the third, and
                // a partial set would grade doctors on missing dimensions.
                const [profitability, inputs, ar] = await Promise.all([
                    analyticsService.getDoctorServiceProfitability(startDate, endDate),
                    analyticsService.getDoctorSegmentationInputs(startDate, endDate),
                    analyticsService.getDoctorReceivablesBreakdown(),
                ]);
                if (isMounted) {
                    setData(profitability);
                    setSegmentationInputs(inputs);
                    setReceivables(ar);
                }
            } catch (e) {
                console.error('Failed to load profitability report:', e);
                // Surfaced, never swallowed into an empty table — an empty
                // table and a failed query look identical to the reader.
                if (isMounted) {
                    setData(null);
                    setSegmentationInputs([]);
                    setReceivables([]);
                    setError(e instanceof Error ? e.message : 'تعذر تحميل تقرير الربحية');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        load();
        return () => { isMounted = false; };
    }, [startDate, endDate]);

    const aggregated = useMemo<AggregateRow[]>(() => {
        const rows = data?.rows ?? [];

        if (groupMode === 'detail') {
            return rows.map(r => toAggregate(
                `${r.doctor_id}::${r.service_name}`,
                r.doctor_name,
                r.service_name,
                [r]
            ));
        }

        const buckets = new Map<string, { label: string; rows: DoctorServiceProfitabilityRow[] }>();
        for (const row of rows) {
            const key = groupMode === 'doctor' ? row.doctor_id : row.service_name;
            const label = groupMode === 'doctor' ? row.doctor_name : row.service_name;
            if (!buckets.has(key)) buckets.set(key, { label, rows: [] });
            buckets.get(key)!.rows.push(row);
        }

        return Array.from(buckets.entries()).map(([key, bucket]) => toAggregate(
            key,
            bucket.label,
            groupMode === 'doctor'
                ? `${bucket.rows.length} خدمة`
                : `${new Set(bucket.rows.map(r => r.doctor_id)).size} طبيب`,
            bucket.rows
        ));
    }, [data, groupMode]);

    const visibleRows = useMemo(() => {
        const filtered = search.trim()
            ? aggregated.filter(r => matchArabic(r.label, search) || (r.sublabel ? matchArabic(r.sublabel, search) : false))
            : aggregated;

        return [...filtered].sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            // A null margin (no revenue) always sorts last, in either direction —
            // it is "undefined", not "the worst margin".
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            return sortAsc ? av - bv : bv - av;
        });
    }, [aggregated, search, sortKey, sortAsc]);

    const totals = data?.totals;
    const totalMargin = totals && totals.revenue > 0 ? (totals.gross_profit / totals.revenue) * 100 : null;

    const toggleSort = (key: SortKey) => {
        if (key === sortKey) setSortAsc(v => !v);
        else { setSortKey(key); setSortAsc(false); }
    };

    const SortableHeader = ({ label, sortBy }: { label: string; sortBy: SortKey }) => (
        <th
            onClick={() => toggleSort(sortBy)}
            className="px-3 py-3 text-center font-bold cursor-pointer select-none hover:bg-slate-700 transition-colors whitespace-nowrap"
        >
            {label}
            {sortKey === sortBy && <span className="ms-1 text-[9px]">{sortAsc ? '▲' : '▼'}</span>}
        </th>
    );

    return (
        <div className="space-y-6 p-1" dir="rtl">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                        <TrendingUp size={20} className="text-emerald-600" />
                        ربحية الطبيب × الخدمة
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">
                        الإيراد والتكلفة الفعلية لكل خدمة عند كل طبيب — من نفس أساس حساب الأرباح في صفحة التقارير.
                    </p>
                </div>

                <ReportDateRangeFilter state={dateRange} />
            </div>

            {/* Tabs — profit analysis and the grade built on it stay together,
                so a doctor's grade is always one click from the rows that
                produced it. */}
            <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm w-fit">
                {([
                    { tab: 'profitability' as const, label: 'الربحية' },
                    { tab: 'segmentation' as const, label: 'تصنيف العملاء A/B/C/D' },
                ]).map(option => (
                    <button
                        key={option.tab}
                        onClick={() => setActiveTab(option.tab)}
                        className={clsx(
                            'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                            activeTab === option.tab ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-rose-800">تعذر تحميل التقرير</p>
                        <p className="text-xs text-rose-700 mt-1 font-mono">{error}</p>
                        <p className="text-xs text-rose-600 mt-1">الأرقام تحت مش معروضة — مفيش بيانات جزئية هنا.</p>
                    </div>
                </div>
            )}

            {activeTab === 'profitability' && (
            <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">الإيراد</span>
                    <h3 className="text-lg font-extrabold text-slate-800 font-mono mt-1">
                        {loading || !totals ? '—' : `${fmt(totals.revenue)} ج.م`}
                    </h3>
                    <span className="text-xs text-slate-400">من سجل الطلبات</span>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">التكلفة المباشرة</span>
                    <h3 className="text-lg font-extrabold text-slate-600 font-mono mt-1">
                        {loading || !totals ? '—' : `${fmt(totals.cost)} ج.م`}
                    </h3>
                    <span className="text-xs text-slate-400">معامل + مصممين</span>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">مجمل الربح</span>
                    <h3 className={clsx(
                        'text-lg font-extrabold font-mono mt-1',
                        !totals ? 'text-slate-800' : totals.gross_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    )}>
                        {loading || !totals ? '—' : `${fmt(totals.gross_profit)} ج.م`}
                    </h3>
                    <span className="text-xs text-slate-400">الإيراد ناقص التكلفة</span>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">هامش الربح</span>
                    <h3 className={clsx(
                        'text-lg font-extrabold font-mono mt-1',
                        totalMargin === null ? 'text-slate-400' : totalMargin >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    )}>
                        {loading || totalMargin === null ? '—' : `${totalMargin.toFixed(1)}%`}
                    </h3>
                    <span className="text-xs text-slate-400">
                        {!loading && totalMargin === null ? 'مفيش إيراد في الفترة' : 'مجمل الربح ÷ الإيراد'}
                    </span>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 col-span-2 lg:col-span-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">منها تكلفة إعادات</span>
                    <h3 className="text-lg font-extrabold text-amber-600 font-mono mt-1">
                        {loading || !totals ? '—' : `${fmt(totals.redo_cost)} ج.م`}
                    </h3>
                    <span className="text-xs text-slate-400">جزء من التكلفة، مش زيادة عليها</span>
                </div>
            </div>

            {/* Data-basis note — every card above is read against this */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 leading-relaxed">
                <strong className="text-slate-700">أساس الأرقام:</strong>{' '}
                محور التاريخ هو تاريخ كشف حساب الطلب (تاريخ التسليم الفعلي للطلبات المسلّمة نهائياً، وإلا الموعد المحدد).
                التكلفة هي التكلفة الفعلية المسجّلة على الطلب (معمل + مصمم بعد احتساب الرفض والمصمم بالراتب الثابت) موزّعة على بنود الطلب —
                مش قائمة أسعار، عشان الأرقام تطابق «مجمل الربح» في <span className="font-mono">/analytics</span>.
                الطلبات المؤرشفة <strong>داخلة</strong> (الأرشفة بتقفل الملف، مش بتلغي إيراد أو تكلفة حصلت)، والمحذوفة ناعماً مستبعدة.
                التكلفة هنا مربوطة بتاريخ كشف حساب نفس الطلب، فممكن تختلف اختلاف بسيط عن إجمالي التكلفة في{' '}
                <span className="font-mono">/analytics</span> اللي بيفلترها بتاريخ التشغيل.
            </div>

            {/* Uncatalogued services warning */}
            {!loading && totals && totals.uncatalogued_rows > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-amber-900">
                            {totals.uncatalogued_rows} صف باسم خدمة مش موجود في كتالوج الخدمات
                        </p>
                        <p className="text-xs text-amber-800 mt-1">
                            بإيراد {fmt(totals.uncatalogued_revenue)} ج.م. اسم الخدمة في بنود الطلب نص حر مش مربوط بجدول الخدمات،
                            فأي اختلاف إملائي بيطلع صف منفصل. الصفوف دي <strong>محسوبة في كل الإجماليات فوق</strong> — مش متجاهلة —
                            وعليها علامة في الجدول. توحيد الأسماء في صفحة الخدمات هيدمجها.
                        </p>
                    </div>
                </div>
            )}

            </>
            )}

            {/* Controls */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="relative">
                    <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="بحث باسم الطبيب أو الخدمة..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full text-xs pr-9 pl-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300"
                    />
                </div>

                <div className={clsx('flex items-center gap-1.5 justify-start md:justify-end', activeTab !== 'profitability' && 'hidden')}>
                    {([
                        { mode: 'detail' as const, label: 'طبيب × خدمة', icon: Grid3x3 },
                        { mode: 'doctor' as const, label: 'حسب الطبيب', icon: Users },
                        { mode: 'service' as const, label: 'حسب الخدمة', icon: Layers },
                    ]).map(option => (
                        <button
                            key={option.mode}
                            onClick={() => setGroupMode(option.mode)}
                            className={clsx(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                                groupMode === option.mode ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                            )}
                        >
                            <option.icon size={13} />
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            {activeTab === 'segmentation' ? (
                <DoctorSegmentationTab
                    profitabilityRows={data?.rows ?? []}
                    segmentationInputs={segmentationInputs}
                    receivables={receivables}
                    search={search}
                    loading={loading}
                />
            ) : (
            /* Table */
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500">
                    {loading ? 'جاري التحميل...' : `${visibleRows.length} صف`}
                </div>

                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="p-10 text-center text-slate-400 text-xs">جاري تحميل البيانات...</div>
                    ) : error ? (
                        <div className="p-10 text-center text-rose-500 text-xs">مفيش بيانات معروضة بسبب خطأ التحميل فوق.</div>
                    ) : visibleRows.length === 0 ? (
                        <div className="bg-white p-8 text-center">
                            <p className="text-slate-800 font-bold mb-2">مفيش بيانات في الفترة دي</p>
                            <p className="text-slate-600 text-sm mb-1">
                                {search.trim()
                                    ? 'مفيش صف مطابق للبحث — جرّب تمسح البحث.'
                                    : 'مفيش طلبات مسلّمة أو متسوّاة بين التاريخين المختارين.'}
                            </p>
                            <p className="text-slate-400 text-xs">وسّع الفترة من التاريخين فوق.</p>
                        </div>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-slate-800 text-white z-10">
                                <tr>
                                    <th className="text-right px-4 py-3 font-bold">
                                        {groupMode === 'service' ? 'الخدمة' : 'الطبيب'}
                                    </th>
                                    <SortableHeader label="الوحدات" sortBy="units" />
                                    <SortableHeader label="الإيراد" sortBy="revenue" />
                                    <SortableHeader label="التكلفة" sortBy="cost" />
                                    <SortableHeader label="مجمل الربح" sortBy="gross_profit" />
                                    <SortableHeader label="الهامش %" sortBy="margin_pct" />
                                    <SortableHeader label="منها إعادات" sortBy="redo_cost" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {visibleRows.map(row => (
                                    <tr key={row.key} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-2.5 text-right">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-bold text-slate-800">{row.label}</span>
                                                {!row.isCatalogService && (
                                                    <span
                                                        className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-semibold"
                                                        title="اسم الخدمة مش موجود في كتالوج الخدمات — الصف محسوب في الإجماليات"
                                                    >
                                                        خارج الكتالوج
                                                    </span>
                                                )}
                                            </div>
                                            {row.sublabel && <p className="text-[10px] text-slate-400 mt-0.5">{row.sublabel}</p>}
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-mono text-slate-600">{fmt(row.units)}</td>
                                        <td className="px-3 py-2.5 text-center font-mono text-slate-700">{fmt(row.revenue)}</td>
                                        <td className="px-3 py-2.5 text-center font-mono text-slate-500">{fmt(row.cost)}</td>
                                        <td className={clsx(
                                            'px-3 py-2.5 text-center font-mono font-bold',
                                            row.gross_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                        )}>
                                            {fmt(row.gross_profit)}
                                        </td>
                                        <td className={clsx(
                                            'px-3 py-2.5 text-center font-mono font-bold',
                                            row.margin_pct === null ? 'text-slate-300'
                                                : row.margin_pct >= 30 ? 'text-emerald-600'
                                                    : row.margin_pct >= 10 ? 'text-amber-600' : 'text-rose-600'
                                        )}>
                                            {row.margin_pct === null ? '—' : `${row.margin_pct.toFixed(1)}%`}
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-mono text-amber-600">
                                            {row.redo_cost > 0 ? (
                                                <span className="inline-flex items-center gap-1">
                                                    <RefreshCw size={10} />
                                                    {fmt(row.redo_cost)}
                                                </span>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
            )}
        </div>
    );
}
