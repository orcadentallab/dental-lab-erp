import { useEffect, useMemo, useState } from 'react';
import { X, Search, Download, Phone, Calendar, AlertTriangle, ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { analyticsService, type DoctorReceivable } from '../../services/supabase/analyticsService';
import { exportToExcel } from '../../lib/exportUtils';
import { format } from 'date-fns';

type AgingBucket = 'all' | '0_30' | '31_60' | '61_90' | '90_plus';
type SortKey = 'balance' | 'maxDaysOverdue' | 'doctorName' | 'aging_90_plus';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    initialBucket?: AgingBucket;
}

const BUCKET_META: Record<Exclude<AgingBucket, 'all'>, { label: string; color: string; textColor: string; bg: string; field: keyof DoctorReceivable; daysFn: (d: number) => boolean }> = {
    '0_30': { label: '0-30 يوم', color: 'bg-emerald-500', textColor: 'text-emerald-700', bg: 'bg-emerald-50', field: 'aging_0_30', daysFn: d => d >= 0 && d <= 30 },
    '31_60': { label: '30-60 يوم', color: 'bg-blue-500', textColor: 'text-blue-700', bg: 'bg-blue-50', field: 'aging_31_60', daysFn: d => d >= 31 && d <= 60 },
    '61_90': { label: '60-90 يوم', color: 'bg-amber-500', textColor: 'text-amber-700', bg: 'bg-amber-50', field: 'aging_61_90', daysFn: d => d >= 61 && d <= 90 },
    '90_plus': { label: '+90 يوم', color: 'bg-rose-500', textColor: 'text-rose-700', bg: 'bg-rose-50', field: 'aging_90_plus', daysFn: d => d > 90 },
};

export default function DoctorReceivablesModal({ isOpen, onClose, initialBucket = 'all' }: Props) {
    const [data, setData] = useState<DoctorReceivable[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [bucket, setBucket] = useState<AgingBucket>(initialBucket);
    const [sortKey, setSortKey] = useState<SortKey>('balance');
    const [sortAsc, setSortAsc] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setBucket(initialBucket);
    }, [isOpen, initialBucket]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        analyticsService.getDoctorReceivablesBreakdown()
            .then(rows => { if (!cancelled) setData(rows); })
            .catch(err => { if (!cancelled) setError(err?.message || 'حدث خطأ في تحميل البيانات'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen]);

    const filtered = useMemo(() => {
        let rows = data;
        // Bucket filter — keep doctors who have *any* balance in this bucket
        if (bucket !== 'all') {
            const field = BUCKET_META[bucket].field;
            rows = rows.filter(r => Number(r[field]) > 0);
        }
        // Search by name or phone
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            rows = rows.filter(r =>
                (r.doctorName || '').toLowerCase().includes(q) ||
                (r.doctorPhone || '').includes(q)
            );
        }
        // Sort
        rows = [...rows].sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
            const as = String(av || ''); const bs = String(bv || '');
            return sortAsc ? as.localeCompare(bs) : bs.localeCompare(as);
        });
        return rows;
    }, [data, bucket, search, sortKey, sortAsc]);

    const totals = useMemo(() => {
        const result = {
            balance: 0, aging_0_30: 0, aging_31_60: 0, aging_61_90: 0, aging_90_plus: 0,
            doctorCount: filtered.length, overdueCount: 0,
        };
        filtered.forEach(r => {
            result.balance += r.balance;
            result.aging_0_30 += r.aging_0_30;
            result.aging_31_60 += r.aging_31_60;
            result.aging_61_90 += r.aging_61_90;
            result.aging_90_plus += r.aging_90_plus;
            if (r.aging_90_plus > 0) result.overdueCount++;
        });
        return result;
    }, [filtered]);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(v => !v);
        else { setSortKey(key); setSortAsc(false); }
    };

    const handleExport = () => {
        exportToExcel(filtered.map(r => ({
            'الطبيب': r.doctorName,
            'الموبايل': r.doctorPhone || '—',
            'إجمالي الفواتير (ج.م)': Math.round(r.totalBilled),
            'إجمالي المدفوع (ج.م)': Math.round(r.totalPaid),
            'الرصيد المستحق (ج.م)': Math.round(r.balance),
            '0-30 يوم': Math.round(r.aging_0_30),
            '30-60 يوم': Math.round(r.aging_31_60),
            '60-90 يوم': Math.round(r.aging_61_90),
            '+90 يوم': Math.round(r.aging_90_plus),
            'عدد الحالات': r.orderCount,
            'حالات غير مسددة': r.unpaidOrderCount,
            'أقدم استحقاق': r.oldestUnpaidDate || '—',
            'أقصى تأخير (يوم)': r.maxDaysOverdue ?? '—',
        })), `الذمم_المدينة_${format(new Date(), 'yyyy-MM-dd')}`);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[92vh] flex flex-col">
                {/* Header */}
                <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between flex-shrink-0">
                    <div>
                        <h2 className="text-xl font-black text-slate-800">تفاصيل الذمم المدينة</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            عرض كل طبيب وفترة استحقاقه وتحليل التأخير
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors" aria-label="إغلاق">
                        <X size={20} className="text-slate-600" />
                    </button>
                </div>

                {/* Aging filter pills */}
                <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-2 flex-shrink-0">
                    <button
                        onClick={() => setBucket('all')}
                        className={clsx(
                            "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border",
                            bucket === 'all'
                                ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                        )}
                    >
                        الكل ({data.length})
                    </button>
                    {(Object.keys(BUCKET_META) as Array<Exclude<AgingBucket, 'all'>>).map(key => {
                        const meta = BUCKET_META[key];
                        const count = data.filter(r => Number(r[meta.field]) > 0).length;
                        const active = bucket === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setBucket(key)}
                                className={clsx(
                                    "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-2",
                                    active
                                        ? `${meta.color} text-white border-transparent shadow-sm`
                                        : `bg-white border-slate-200 ${meta.textColor} hover:bg-slate-50`
                                )}
                            >
                                <span className={clsx("w-2 h-2 rounded-full", active ? "bg-white" : meta.color)} />
                                {meta.label} ({count})
                            </button>
                        );
                    })}
                    <div className="flex-1" />
                    <button
                        onClick={handleExport}
                        disabled={filtered.length === 0}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download size={14} /> تصدير Excel
                    </button>
                </div>

                {/* Search + Stats bar */}
                <div className="px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex flex-col md:flex-row gap-3 items-stretch md:items-center flex-shrink-0">
                    <div className="relative flex-1 max-w-md">
                        <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="بحث بالاسم أو الموبايل..."
                            className="w-full bg-white border border-slate-200 text-sm rounded-xl py-2 pr-9 pl-3 focus:ring-2 focus:ring-slate-300 focus:border-slate-300 outline-none"
                        />
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                        <span className="bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                            <span className="text-slate-500">عدد الأطباء:</span>
                            <span className="font-black text-slate-800 mr-1">{totals.doctorCount}</span>
                        </span>
                        <span className="bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                            <span className="text-slate-500">إجمالي الرصيد:</span>
                            <span className="font-black text-slate-800 mr-1">{Math.round(totals.balance).toLocaleString()}</span>
                            <span className="text-[10px] text-slate-400">ج.م</span>
                        </span>
                        {totals.overdueCount > 0 && (
                            <span className="bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200 flex items-center gap-1.5">
                                <AlertTriangle size={12} className="text-rose-600" />
                                <span className="text-rose-700 font-bold">{totals.overdueCount}</span>
                                <span className="text-rose-600">طبيب متأخر +90 يوم</span>
                            </span>
                        )}
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto">
                    {loading ? (
                        <div className="p-12 text-center text-slate-400">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-slate-600 mb-3" />
                            <p className="text-sm">جاري تحميل البيانات...</p>
                        </div>
                    ) : error ? (
                        <div className="p-12 text-center">
                            <AlertTriangle size={32} className="mx-auto mb-2 text-rose-400" />
                            <p className="text-rose-600 font-bold text-sm">فشل التحميل</p>
                            <p className="text-xs text-slate-500 mt-1">{error}</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">
                            <p className="text-sm font-medium">لا توجد ذمم تطابق المعايير المختارة</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-slate-800 text-white text-xs sticky top-0 z-10">
                                <tr>
                                    <th className="px-3 py-3 font-semibold text-right w-10">#</th>
                                    <th className="px-3 py-3 font-semibold text-right cursor-pointer hover:bg-slate-700 transition-colors"
                                        onClick={() => toggleSort('doctorName')}>
                                        <span className="inline-flex items-center gap-1">الطبيب <SortIcon active={sortKey === 'doctorName'} asc={sortAsc} /></span>
                                    </th>
                                    <th className="px-3 py-3 font-semibold text-center">الموبايل</th>
                                    <th className="px-3 py-3 font-semibold text-center cursor-pointer hover:bg-slate-700 transition-colors"
                                        onClick={() => toggleSort('balance')}>
                                        <span className="inline-flex items-center gap-1">الرصيد المستحق <SortIcon active={sortKey === 'balance'} asc={sortAsc} /></span>
                                    </th>
                                    <th className="px-3 py-3 font-semibold text-center bg-emerald-700">0-30</th>
                                    <th className="px-3 py-3 font-semibold text-center bg-blue-700">30-60</th>
                                    <th className="px-3 py-3 font-semibold text-center bg-amber-700">60-90</th>
                                    <th className="px-3 py-3 font-semibold text-center bg-rose-700 cursor-pointer hover:bg-rose-600 transition-colors"
                                        onClick={() => toggleSort('aging_90_plus')}>
                                        <span className="inline-flex items-center gap-1">+90 <SortIcon active={sortKey === 'aging_90_plus'} asc={sortAsc} /></span>
                                    </th>
                                    <th className="px-3 py-3 font-semibold text-center cursor-pointer hover:bg-slate-700 transition-colors"
                                        onClick={() => toggleSort('maxDaysOverdue')}>
                                        <span className="inline-flex items-center gap-1">أقصى تأخير <SortIcon active={sortKey === 'maxDaysOverdue'} asc={sortAsc} /></span>
                                    </th>
                                    <th className="px-3 py-3 font-semibold text-center">أقدم استحقاق</th>
                                    <th className="px-3 py-3 font-semibold text-center">حالات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map((row, idx) => {
                                    const isCritical = row.aging_90_plus > 0;
                                    return (
                                        <tr key={row.doctorId} className={clsx(
                                            "hover:bg-slate-50 transition-colors",
                                            isCritical && "bg-rose-50/30"
                                        )}>
                                            <td className="px-3 py-3 text-xs font-bold text-slate-400">{idx + 1}</td>
                                            <td className="px-3 py-3">
                                                <div className="font-bold text-slate-800 text-sm">{row.doctorName}</div>
                                                {isCritical && (
                                                    <div className="text-[10px] text-rose-600 font-bold mt-0.5 flex items-center gap-1">
                                                        <AlertTriangle size={10} />
                                                        متأخر +90 يوم
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                {row.doctorPhone ? (
                                                    <a href={`tel:${row.doctorPhone}`} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-600 font-medium">
                                                        <Phone size={11} />
                                                        {row.doctorPhone}
                                                    </a>
                                                ) : <span className="text-slate-300 text-xs">—</span>}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <span className="font-black text-slate-900 text-base">{Math.round(row.balance).toLocaleString()}</span>
                                                <span className="text-[10px] text-slate-400 mr-1">ج.م</span>
                                            </td>
                                            <BucketCell value={row.aging_0_30} colorClass="bg-emerald-50 text-emerald-700" />
                                            <BucketCell value={row.aging_31_60} colorClass="bg-blue-50 text-blue-700" />
                                            <BucketCell value={row.aging_61_90} colorClass="bg-amber-50 text-amber-700" />
                                            <BucketCell value={row.aging_90_plus} colorClass="bg-rose-100 text-rose-700 font-black" emphasize />
                                            <td className="px-3 py-3 text-center">
                                                {row.maxDaysOverdue !== null ? (
                                                    <span className={clsx(
                                                        "inline-block px-2 py-1 rounded-lg text-xs font-bold",
                                                        row.maxDaysOverdue > 90 ? "bg-rose-100 text-rose-700"
                                                            : row.maxDaysOverdue > 60 ? "bg-amber-100 text-amber-700"
                                                                : row.maxDaysOverdue > 30 ? "bg-blue-100 text-blue-700"
                                                                    : "bg-emerald-100 text-emerald-700"
                                                    )}>
                                                        {row.maxDaysOverdue} يوم
                                                    </span>
                                                ) : <span className="text-slate-300 text-xs">—</span>}
                                            </td>
                                            <td className="px-3 py-3 text-center text-xs text-slate-600">
                                                {row.oldestUnpaidDate ? (
                                                    <div className="inline-flex items-center gap-1">
                                                        <Calendar size={10} className="text-slate-400" />
                                                        {row.oldestUnpaidDate}
                                                    </div>
                                                ) : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-3 py-3 text-center text-xs">
                                                <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-lg">
                                                    {row.unpaidOrderCount}/{row.orderCount}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="bg-slate-900 text-white text-sm sticky bottom-0">
                                <tr>
                                    <td colSpan={3} className="px-3 py-3 font-bold">الإجمالي</td>
                                    <td className="px-3 py-3 text-center font-black text-base">
                                        {Math.round(totals.balance).toLocaleString()}
                                        <span className="text-[10px] text-slate-400 mr-1">ج.م</span>
                                    </td>
                                    <td className="px-3 py-3 text-center font-bold text-emerald-300">{Math.round(totals.aging_0_30).toLocaleString()}</td>
                                    <td className="px-3 py-3 text-center font-bold text-blue-300">{Math.round(totals.aging_31_60).toLocaleString()}</td>
                                    <td className="px-3 py-3 text-center font-bold text-amber-300">{Math.round(totals.aging_61_90).toLocaleString()}</td>
                                    <td className="px-3 py-3 text-center font-bold text-rose-300">{Math.round(totals.aging_90_plus).toLocaleString()}</td>
                                    <td colSpan={3} className="px-3 py-3"></td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>

                {/* Footer hint */}
                <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 flex items-center justify-between flex-shrink-0">
                    <span>الـ Aging محسوب على أساس تاريخ التسليم (FIFO allocation للمدفوعات)</span>
                    <span>{filtered.length} من {data.length} طبيب</span>
                </div>
            </div>
        </div>
    );
}

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
    if (!active) return <ArrowUpDown size={11} className="opacity-30" />;
    return asc ? <ChevronUp size={11} /> : <ChevronDown size={11} />;
}

function BucketCell({ value, colorClass, emphasize }: { value: number; colorClass: string; emphasize?: boolean }) {
    if (value <= 0) return <td className="px-3 py-3 text-center text-slate-300 text-xs">—</td>;
    return (
        <td className="px-3 py-3 text-center">
            <span className={clsx("inline-block px-2 py-1 rounded-lg text-xs", colorClass, emphasize && "shadow-sm")}>
                {Math.round(value).toLocaleString()}
            </span>
        </td>
    );
}
