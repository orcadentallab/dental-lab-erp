import { useState, useEffect, useMemo } from 'react';
import { 
    X, Wallet, ArrowDownRight, ArrowUpLeft, ArrowLeftRight, 
    Search, Printer, Download, RefreshCw, 
    ArrowUpDown, Filter
} from 'lucide-react';
import clsx from 'clsx';
import { financeService, type Cashbox, type CashboxStatement } from '../../services/financeService';

interface CashboxStatementModalProps {
    cashbox: Cashbox | null;
    onClose: () => void;
}

function formatCurrency(value: number) {
    return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

export default function CashboxStatementModal({ cashbox, onClose }: CashboxStatementModalProps) {
    const [statement, setStatement] = useState<CashboxStatement | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
    const [datePreset, setDatePreset] = useState<'all' | 'this_month' | 'last_month' | 'last_30_days' | 'custom'>('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

    useEffect(() => {
        if (!cashbox) return;
        let isMounted = true;
        financeService.getCashboxStatement(cashbox.id)
            .then(data => {
                if (isMounted) {
                    setStatement(data);
                    setIsLoading(false);
                }
            })
            .catch(err => {
                console.error('Error fetching cashbox statement:', err);
                if (isMounted) setIsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [cashbox]);

    const handleDatePresetChange = (preset: 'all' | 'this_month' | 'last_month' | 'last_30_days' | 'custom') => {
        setDatePreset(preset);
        const now = new Date();
        if (preset === 'this_month') {
            const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            const end = now.toISOString().split('T')[0];
            setStartDate(start);
            setEndDate(end);
        } else if (preset === 'last_month') {
            const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
            setStartDate(`${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`);
            setEndDate(`${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`);
        } else if (preset === 'last_30_days') {
            const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            setStartDate(past30.toISOString().split('T')[0]);
            setEndDate(now.toISOString().split('T')[0]);
        } else if (preset === 'all') {
            setStartDate('');
            setEndDate('');
        }
    };

    const filteredItems = useMemo(() => {
        if (!statement) return [];
        let items = statement.items;

        // Date filter
        if (startDate) {
            items = items.filter(it => it.date >= startDate);
        }
        if (endDate) {
            items = items.filter(it => it.date <= endDate);
        }

        // Type filter
        if (typeFilter === 'income') {
            items = items.filter(it => it.type === 'income' || (it.type === 'opening' && it.inAmount > 0));
        } else if (typeFilter === 'expense') {
            items = items.filter(it => it.type === 'expense');
        } else if (typeFilter === 'transfer') {
            items = items.filter(it => it.type === 'transfer_in' || it.type === 'transfer_out');
        }

        // Search query
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            items = items.filter(it => 
                (it.title && it.title.toLowerCase().includes(q)) ||
                (it.description && it.description.toLowerCase().includes(q)) ||
                (it.entityName && it.entityName.toLowerCase().includes(q)) ||
                (it.category && it.category.toLowerCase().includes(q)) ||
                (it.notes && it.notes.toLowerCase().includes(q)) ||
                (it.inAmount > 0 && it.inAmount.toString().includes(q)) ||
                (it.outAmount > 0 && it.outAmount.toString().includes(q)) ||
                (it.runningBalance.toString().includes(q))
            );
        }

        // Sorting
        const sorted = [...items];
        if (sortOrder === 'desc') {
            sorted.reverse();
        }
        return sorted;
    }, [statement, startDate, endDate, typeFilter, searchQuery, sortOrder]);

    if (!cashbox) return null;

    function handlePrint() {
        window.print();
    }

    function handleExportCSV() {
        if (!statement || !cashbox || filteredItems.length === 0) return;
        const headers = ['التاريخ', 'النوع', 'البيان', 'الجهة', 'البند', 'داخل (+)', 'خارج (-)', 'الرصيد بعد الحركة'];
        const rows = filteredItems.map(it => [
            it.date,
            it.type === 'income' ? 'إيراد / تحصيل' : it.type === 'expense' ? 'مصروف / سداد' : it.type === 'transfer_in' ? 'تحويل وارد' : it.type === 'transfer_out' ? 'تحويل صادر' : it.type === 'reconciliation' ? 'مطابقة رصيد' : 'رصيد افتتاحي',
            `"${(it.title || '').replace(/"/g, '""')}"`,
            `"${(it.entityName || '').replace(/"/g, '""')}"`,
            `"${(it.category || '').replace(/"/g, '""')}"`,
            it.inAmount,
            it.outAmount,
            it.runningBalance
        ]);
        const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `كشف_حساب_${cashbox.name}_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-fade-in print:p-0 print:bg-white print:static">
            <div className="relative flex flex-col max-h-[92vh] w-full max-w-6xl rounded-2xl bg-white shadow-2xl overflow-hidden print:max-h-none print:shadow-none print:rounded-none">
                
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4 print:bg-transparent print:border-b-2 print:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                            <Wallet size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl font-black text-slate-900">
                                    كشف حساب: {cashbox.name}
                                </h2>
                                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                                    {cashbox.type === 'cash' ? 'نقدي' : cashbox.type === 'bank' ? 'حساب بنكي' : cashbox.type === 'wallet' ? 'محفظة' : 'أخرى'}
                                </span>
                                {cashbox.isSaving && (
                                    <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                                        ادخار (Saving)
                                    </span>
                                )}
                                {cashbox.feeEnabled && (
                                    <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
                                        رسوم {cashbox.feePercentage}%
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                                رصيد البداية: {formatCurrency(cashbox.openingBalance)} ({cashbox.openingDate})
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 print:hidden">
                        <button
                            onClick={handleExportCSV}
                            title="تصدير ملف CSV"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                            <Download size={14} />
                            تصدير CSV
                        </button>
                        <button
                            onClick={handlePrint}
                            title="طباعة كشف الحساب"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                            <Printer size={14} />
                            طباعة
                        </button>
                        <button
                            onClick={onClose}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Summary Cards */}
                {statement && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 border-b border-slate-100 bg-white p-4 print:grid-cols-5">
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                            <span className="text-[11px] font-bold text-slate-500">رصيد الافتتاح</span>
                            <p className="mt-1 font-mono text-base font-bold text-slate-800">
                                {formatCurrency(statement.openingBalance)}
                            </p>
                            <span className="text-[10px] text-slate-400">{statement.openingDate}</span>
                        </div>
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-3">
                            <span className="text-[11px] font-bold text-emerald-700">إجمالي الداخل (+)</span>
                            <p className="mt-1 font-mono text-base font-bold text-emerald-700">
                                +{formatCurrency(statement.totalInflow)}
                            </p>
                            <span className="text-[10px] text-slate-400">إيرادات وتحصيلات</span>
                        </div>
                        <div className="rounded-xl border border-rose-100 bg-rose-50/30 p-3">
                            <span className="text-[11px] font-bold text-rose-700">إجمالي الخارج (-)</span>
                            <p className="mt-1 font-mono text-base font-bold text-rose-700">
                                -{formatCurrency(statement.totalOutflow)}
                            </p>
                            <span className="text-[10px] text-slate-400">مصروفات ومدفوعات</span>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-3">
                            <span className="text-[11px] font-bold text-blue-700">صافي التحويلات</span>
                            <p className={clsx(
                                "mt-1 font-mono text-base font-bold",
                                statement.netTransfers >= 0 ? "text-blue-700" : "text-amber-700"
                            )}>
                                {statement.netTransfers >= 0 ? '+' : ''}{formatCurrency(statement.netTransfers)}
                            </p>
                            <span className="text-[10px] text-slate-400">بين الخزائن</span>
                        </div>
                        <div className="col-span-2 md:col-span-1 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 shadow-sm">
                            <span className="text-[11px] font-bold text-indigo-900">الرصيد الدفتري الحالي</span>
                            <p className="mt-1 font-mono text-lg font-black text-indigo-900">
                                {formatCurrency(statement.currentExpectedBalance)}
                            </p>
                            <span className="text-[10px] text-indigo-600">
                                {statement.lastReconciliation 
                                    ? `آخر مطابقة: ${statement.lastReconciliation.date}` 
                                    : 'لم تتم مطابقة بعد'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Filters and Controls Toolbar (hidden in print) */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 p-4 print:hidden">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Search Input */}
                        <div className="relative min-w-[220px]">
                            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="بحث في البيان، الجهة، المبلغ..."
                                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-9 pl-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                            />
                        </div>

                        {/* Date Preset Filter */}
                        <select
                            value={datePreset}
                            onChange={e => {
                                const val = e.target.value;
                                if (val === 'all' || val === 'this_month' || val === 'last_month' || val === 'last_30_days' || val === 'custom') {
                                    handleDatePresetChange(val);
                                }
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 focus:border-blue-500 focus:outline-none"
                        >
                            <option value="all">كل الفترات</option>
                            <option value="this_month">هذا الشهر</option>
                            <option value="last_month">الشهر السابق</option>
                            <option value="last_30_days">آخر 30 يوم</option>
                            <option value="custom">فترة مخصصة</option>
                        </select>

                        {datePreset === 'custom' && (
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                                />
                                <span className="text-xs text-slate-400">إلى</span>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={e => setEndDate(e.target.value)}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                                />
                            </div>
                        )}

                        {/* Type Filter */}
                        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold text-slate-600">
                            <button
                                onClick={() => setTypeFilter('all')}
                                className={clsx("rounded-md px-2.5 py-1 transition-colors", typeFilter === 'all' && "bg-blue-600 text-white")}
                            >
                                الكل
                            </button>
                            <button
                                onClick={() => setTypeFilter('income')}
                                className={clsx("rounded-md px-2.5 py-1 transition-colors", typeFilter === 'income' && "bg-emerald-600 text-white")}
                            >
                                وارد (+)
                            </button>
                            <button
                                onClick={() => setTypeFilter('expense')}
                                className={clsx("rounded-md px-2.5 py-1 transition-colors", typeFilter === 'expense' && "bg-rose-600 text-white")}
                            >
                                صادر (-)
                            </button>
                            <button
                                onClick={() => setTypeFilter('transfer')}
                                className={clsx("rounded-md px-2.5 py-1 transition-colors", typeFilter === 'transfer' && "bg-blue-600 text-white")}
                            >
                                تحويلات
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                            <ArrowUpDown size={13} />
                            {sortOrder === 'desc' ? 'الأحدث أولاً' : 'الأقدم أولاً'}
                        </button>
                        <span className="text-xs font-bold text-slate-500">
                            {filteredItems.length} حركة
                        </span>
                    </div>
                </div>

                {/* Ledger Table */}
                <div className="flex-1 overflow-y-auto p-4">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center p-12 text-slate-400">
                            <RefreshCw size={28} className="animate-spin text-blue-600 mb-2" />
                            <p className="text-sm font-bold">جاري تحميل حركات كشف الحساب...</p>
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-12 text-slate-400">
                            <Filter size={32} className="text-slate-300 mb-2" />
                            <p className="text-sm font-bold text-slate-600">لا توجد حركات مطابقة للفلاتر المحددة</p>
                            <p className="text-xs text-slate-400 mt-1">جرّب تغيير نطاق التاريخ أو تصفية البحث</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                            <table className="w-full text-right text-xs">
                                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="p-3 w-28">التاريخ</th>
                                        <th className="p-3 w-32">النوع</th>
                                        <th className="p-3">البيان والجهة</th>
                                        <th className="p-3 w-32">البند / التصنيف</th>
                                        <th className="p-3 w-32 text-emerald-700">داخل (+)</th>
                                        <th className="p-3 w-32 text-rose-700">خارج (-)</th>
                                        <th className="p-3 w-36 text-indigo-900">الرصيد بعد الحركة</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-medium">
                                    {filteredItems.map(item => {
                                        const isOpening = item.type === 'opening';
                                        const isIncome = item.type === 'income' || (isOpening && item.inAmount > 0);
                                        const isExpense = item.type === 'expense';
                                        const isTransferIn = item.type === 'transfer_in';
                                        const isTransferOut = item.type === 'transfer_out';

                                        return (
                                            <tr key={item.id} className={clsx(
                                                "hover:bg-slate-50/80 transition-colors",
                                                isOpening && "bg-amber-50/30"
                                            )}>
                                                <td className="p-3 text-slate-600 font-mono">{item.date}</td>
                                                <td className="p-3">
                                                    {isOpening && (
                                                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                                                            رصيد بداية
                                                        </span>
                                                    )}
                                                    {isIncome && !isOpening && (
                                                        <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">
                                                            <ArrowDownRight size={12} />
                                                            وارد
                                                        </span>
                                                    )}
                                                    {isExpense && (
                                                        <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">
                                                            <ArrowUpLeft size={12} />
                                                            صادر
                                                        </span>
                                                    )}
                                                    {isTransferIn && (
                                                        <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-blue-700">
                                                            <ArrowLeftRight size={12} />
                                                            تحويل وارد
                                                        </span>
                                                    )}
                                                    {isTransferOut && (
                                                        <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">
                                                            <ArrowLeftRight size={12} />
                                                            تحويل صادر
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    <div className="font-bold text-slate-900">
                                                        {item.title}
                                                    </div>
                                                    {item.description && (
                                                        <div className="text-[11px] text-slate-500 mt-0.5">
                                                            {item.description}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-3 text-slate-600">
                                                    {item.category ? (
                                                        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                                                            {item.category}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">—</span>
                                                    )}
                                                </td>
                                                <td className="p-3 font-mono font-bold text-emerald-700">
                                                    {item.inAmount > 0 ? `+${formatCurrency(item.inAmount)}` : '—'}
                                                </td>
                                                <td className="p-3 font-mono font-bold text-rose-700">
                                                    {item.outAmount > 0 ? `-${formatCurrency(item.outAmount)}` : '—'}
                                                </td>
                                                <td className="p-3 font-mono font-black text-slate-900 bg-slate-50/50">
                                                    {formatCurrency(item.runningBalance)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-6 py-3 print:hidden">
                    <div className="text-xs text-slate-500 font-medium">
                        الرصيد بعد آخر حركة: <span className="font-bold text-slate-900 font-mono">{statement ? formatCurrency(statement.currentExpectedBalance) : '—'}</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg bg-slate-800 px-5 py-2 text-xs font-bold text-white hover:bg-slate-900 transition-colors"
                    >
                        إغلاق
                    </button>
                </div>
            </div>
        </div>
    );
}
