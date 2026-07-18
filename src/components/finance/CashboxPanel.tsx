import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Wallet, Plus, RefreshCw, Edit, TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type CashboxSummaryRow, type CashboxType, type Cashbox } from '../../services/financeService';

const cashboxTypeLabels: Record<CashboxType, string> = {
    cash: 'نقدي',
    bank: 'حساب بنكي',
    wallet: 'محفظة',
    other: 'أخرى'
};

const today = new Date().toISOString().split('T')[0];

function formatCurrency(value: number) {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ج.م`;
}

function CashboxBadge({ type }: { type: CashboxType }) {
    return (
        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
            {cashboxTypeLabels[type]}
        </span>
    );
}

function toCashboxType(value: string): CashboxType {
    if (value === 'cash' || value === 'bank' || value === 'wallet' || value === 'other') {
        return value;
    }
    return 'cash';
}

const initialNewCashbox: {
    name: string;
    type: CashboxType;
    openingBalance: string;
    openingDate: string;
    feeEnabled: boolean;
    feePercentage: string;
    feeMinAmount: string;
    feeMaxAmount: string;
    isSaving: boolean;
} = {
    name: '',
    type: 'cash',
    openingBalance: '',
    openingDate: today,
    feeEnabled: false,
    feePercentage: '',
    feeMinAmount: '',
    feeMaxAmount: '',
    isSaving: false
};

export default function CashboxPanel() {
    const { user } = useAuth();
    const { success: toastSuccess, error: toastError } = useToast();
    const isSuperAdmin = user?.username === 'admin';
    const [isLoading, setIsLoading] = useState(false);
    const [rows, setRows] = useState<CashboxSummaryRow[]>([]);
    const [totalExpected, setTotalExpected] = useState(0);
    const [currentMonthNetCashflow, setCurrentMonthNetCashflow] = useState(0);
    const [daysSinceLastReconciliation, setDaysSinceLastReconciliation] = useState<number | null>(null);
    const [lastReconciliationDate, setLastReconciliationDate] = useState<string | null>(null);
    const [transfers, setTransfers] = useState<Awaited<ReturnType<typeof financeService.getCashboxTransfers>>>([]);


    const [editingCashbox, setEditingCashbox] = useState<Cashbox | null>(null);

    const [newCashbox, setNewCashbox] = useState(initialNewCashbox);

    const [transferForm, setTransferForm] = useState({
        fromCashboxId: '',
        toCashboxId: '',
        amount: '',
        date: today,
        description: ''
    });

    const [reconciliationForm, setReconciliationForm] = useState({
        cashboxId: '',
        actualBalance: '',
        date: today,
        notes: ''
    });

    const activeCashboxes = useMemo(() => rows.map(r => r.cashbox).filter(c => c.isActive), [rows]);
    const selectedReconciliationRow = rows.find(r => r.cashbox.id === reconciliationForm.cashboxId);

    async function loadData() {
        setIsLoading(true);
        try {
            const summary = await financeService.getCashboxSummary();
            setRows(summary.rows);
            setTotalExpected(summary.totalExpected);
            setCurrentMonthNetCashflow(summary.currentMonthNetCashflow);
            setDaysSinceLastReconciliation(summary.daysSinceLastReconciliation);
            setLastReconciliationDate(summary.lastReconciliationDate);
            setTransfers(summary.transfers);
        } catch (error) {
            console.error('Error loading cashboxes:', error);
            toastError('حدث خطأ أثناء تحميل الخزينة');
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleAddCashbox(e: React.FormEvent) {
        e.preventDefault();
        if (!isSuperAdmin) return;
        try {
            if (editingCashbox) {
                await financeService.updateCashbox(editingCashbox.id, {
                    name: newCashbox.name,
                    type: newCashbox.type,
                    openingBalance: Number(newCashbox.openingBalance || 0),
                    openingDate: newCashbox.openingDate,
                    feeEnabled: newCashbox.feeEnabled,
                    feePercentage: Number(newCashbox.feePercentage || 0),
                    feeMinAmount: Number(newCashbox.feeMinAmount || 0),
                    feeMaxAmount: newCashbox.feeMaxAmount ? Number(newCashbox.feeMaxAmount) : null,
                    isSaving: newCashbox.isSaving
                });
                toastSuccess('تم تحديث الصندوق بنجاح');
            } else {
                await financeService.addCashbox({
                    name: newCashbox.name,
                    type: newCashbox.type,
                    openingBalance: Number(newCashbox.openingBalance || 0),
                    openingDate: newCashbox.openingDate,
                    isActive: true,
                    feeEnabled: newCashbox.feeEnabled,
                    feePercentage: Number(newCashbox.feePercentage || 0),
                    feeMinAmount: Number(newCashbox.feeMinAmount || 0),
                    feeMaxAmount: newCashbox.feeMaxAmount ? Number(newCashbox.feeMaxAmount) : null,
                    isSaving: newCashbox.isSaving
                });
                toastSuccess('تم إضافة الصندوق بنجاح');
            }
            setNewCashbox({
                name: '',
                type: 'cash',
                openingBalance: '',
                openingDate: today,
                feeEnabled: false,
                feePercentage: '',
                feeMinAmount: '',
                feeMaxAmount: '',
                isSaving: false
            });
            setEditingCashbox(null);
            await loadData();
        } catch (error) {
            console.error('Error saving cashbox:', error);
            toastError('حدث خطأ أثناء حفظ الصندوق');
        }
    }

    function handleStartEditCashbox(cashbox: Cashbox) {
        setEditingCashbox(cashbox);
        setNewCashbox({
            name: cashbox.name,
            type: cashbox.type,
            openingBalance: cashbox.openingBalance.toString(),
            openingDate: cashbox.openingDate,
            feeEnabled: cashbox.feeEnabled,
            feePercentage: cashbox.feePercentage.toString(),
            feeMinAmount: cashbox.feeMinAmount.toString(),
            feeMaxAmount: cashbox.feeMaxAmount ? cashbox.feeMaxAmount.toString() : '',
            isSaving: cashbox.isSaving || false
        });
        // Scroll to form
        window.scrollTo({ top: 300, behavior: 'smooth' });
    }

    async function handleDeactivateCashbox(id: string) {
        if (!isSuperAdmin || !confirm('هل تريد تعطيل هذا الصندوق؟')) return;
        try {
            await financeService.deactivateCashbox(id);
            await loadData();
            toastSuccess('تم تعطيل الصندوق');
        } catch (error) {
            console.error('Error deactivating cashbox:', error);
            toastError('حدث خطأ أثناء تعطيل الصندوق');
        }
    }

    async function handleAddTransfer(e: React.FormEvent) {
        e.preventDefault();
        if (transferForm.fromCashboxId === transferForm.toCashboxId) {
            toastError('لا يمكن التحويل لنفس الصندوق');
            return;
        }
        try {
            await financeService.addCashboxTransfer({
                fromCashboxId: transferForm.fromCashboxId,
                toCashboxId: transferForm.toCashboxId,
                amount: Number(transferForm.amount),
                date: transferForm.date,
                description: transferForm.description,
                createdBy: user?.id || null
            });
            setTransferForm({ fromCashboxId: '', toCashboxId: '', amount: '', date: today, description: '' });
            await loadData();
            toastSuccess('تم تسجيل التحويل الداخلي');
        } catch (error) {
            console.error('Error adding cashbox transfer:', error);
            toastError('حدث خطأ أثناء تسجيل التحويل');
        }
    }

    async function handleAddReconciliation(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedReconciliationRow) return;
        try {
            await financeService.addCashboxReconciliation({
                cashboxId: reconciliationForm.cashboxId,
                expectedBalance: selectedReconciliationRow.expectedBalance,
                actualBalance: Number(reconciliationForm.actualBalance),
                difference: Number(reconciliationForm.actualBalance) - selectedReconciliationRow.expectedBalance,
                date: reconciliationForm.date,
                notes: reconciliationForm.notes,
                createdBy: user?.id || null
            });
            setReconciliationForm({ cashboxId: '', actualBalance: '', date: today, notes: '' });
            await loadData();
            toastSuccess('تم حفظ المطابقة');
        } catch (error) {
            console.error('Error adding reconciliation:', error);
            toastError('حدث خطأ أثناء حفظ المطابقة');
        }
    }

    async function handleReconcileAll() {
        if (!confirm(`سيتم تسجيل مطابقة تلقائية لجميع الصناديق (${activeCashboxes.length} صندوق) بالرصيد النظري الحالي. تأكيد؟`)) return;
        try {
            const date = today;
            await Promise.all(
                rows
                    .filter(r => r.cashbox.isActive)
                    .map(r =>
                        financeService.addCashboxReconciliation({
                            cashboxId: r.cashbox.id,
                            expectedBalance: r.expectedBalance,
                            actualBalance: r.expectedBalance,
                            difference: 0,
                            date,
                            notes: 'مطابقة تلقائية - مطابقة الكل',
                            createdBy: user?.id || null
                        })
                    )
            );
            await loadData();
            toastSuccess(`تم تسجيل المطابقة لـ ${activeCashboxes.length} صندوق بنجاح`);
        } catch (error) {
            console.error('Error reconciling all cashboxes:', error);
            toastError('حدث خطأ أثناء مطابقة الكل');
        }
    }

    return (
        <div className="space-y-6">

            {/* ⚠️ Reconciliation warning banner */}
            {daysSinceLastReconciliation !== null && daysSinceLastReconciliation >= 7 && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <AlertTriangle size={20} className="mt-0.5 flex-shrink-0 text-amber-600" />
                    <div>
                        <p className="font-black text-amber-800 text-sm">تذكير: لم تتم مطابقة الخزينة منذ {daysSinceLastReconciliation} يوم</p>
                        <p className="text-xs text-amber-600 mt-0.5">آخر مطابقة: {lastReconciliationDate} — يُنصح بالمطابقة أسبوعياً على الأقل لضمان دقة الأرقام.</p>
                    </div>
                </div>
            )}
            {daysSinceLastReconciliation === null && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <AlertTriangle size={20} className="mt-0.5 flex-shrink-0 text-amber-600" />
                    <div>
                        <p className="font-black text-amber-800 text-sm">لم تتم أي مطابقة للخزينة حتى الآن</p>
                        <p className="text-xs text-amber-600 mt-0.5">ابدأ بمطابقة الصناديق من الجدول بالأسفل لضمان دقة الأرقام.</p>
                    </div>
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Total cashbox */}
                <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-500 text-sm font-bold mb-2">
                        <Wallet size={18} />
                        إجمالي الخزينة
                    </div>
                    <p className="text-2xl font-black text-slate-900">{formatCurrency(totalExpected)}</p>
                    <p className="text-xs text-slate-400 mt-1">مجموع أرصدة الصناديق الحالية</p>
                </div>

                {/* Current month net cashflow */}
                <div className={clsx(
                    "rounded-xl border p-5 shadow-sm",
                    currentMonthNetCashflow >= 0 ? "bg-emerald-50/40 border-emerald-100" : "bg-rose-50/40 border-rose-100"
                )}>
                    <div className={clsx(
                        "flex items-center gap-2 text-sm font-bold mb-2",
                        currentMonthNetCashflow >= 0 ? "text-emerald-700" : "text-rose-700"
                    )}>
                        {currentMonthNetCashflow >= 0
                            ? <TrendingUp size={18} />
                            : <TrendingDown size={18} />}
                        صافي التدفق — {new Date().toLocaleString('ar-EG', { month: 'long' })}
                    </div>
                    <p className={clsx(
                        "text-2xl font-black",
                        currentMonthNetCashflow >= 0 ? "text-emerald-700" : "text-rose-700"
                    )}>
                        {currentMonthNetCashflow >= 0 ? '+' : ''}{formatCurrency(currentMonthNetCashflow)}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                        {currentMonthNetCashflow >= 0 ? '✅ تدفق إيجابي' : '⚠️ تدفق سلبي'} هذا الشهر
                    </p>
                </div>

                {/* Days since last reconciliation */}
                <div className={clsx(
                    "rounded-xl border p-5 shadow-sm",
                    daysSinceLastReconciliation === null ? "bg-rose-50/40 border-rose-100"
                    : daysSinceLastReconciliation >= 7 ? "bg-amber-50/40 border-amber-100"
                    : "bg-white border-slate-100"
                )}>
                    <div className={clsx(
                        "flex items-center gap-2 text-sm font-bold mb-2",
                        daysSinceLastReconciliation === null ? "text-rose-600"
                        : daysSinceLastReconciliation >= 7 ? "text-amber-600"
                        : "text-slate-500"
                    )}>
                        <Clock size={18} />
                        أيام منذ آخر مطابقة
                    </div>
                    <p className={clsx(
                        "text-2xl font-black",
                        daysSinceLastReconciliation === null ? "text-rose-700"
                        : daysSinceLastReconciliation >= 7 ? "text-amber-700"
                        : "text-emerald-700"
                    )}>
                        {daysSinceLastReconciliation === null ? '—' : `${daysSinceLastReconciliation} يوم`}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                        {daysSinceLastReconciliation === null ? 'لم تتم مطابقة بعد'
                        : daysSinceLastReconciliation === 0 ? '✅ تمت اليوم'
                        : daysSinceLastReconciliation >= 7 ? '⚠️ تجاوز الحد الأسبوعي'
                        : `آخر مطابقة: ${lastReconciliationDate}`}
                    </p>
                </div>
            </div>

            <div className="flex justify-end">
                <button onClick={loadData} disabled={isLoading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                    <RefreshCw size={16} className={clsx(isLoading && 'animate-spin')} />
                    تحديث
                </button>
            </div>


            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100">
                        <h3 className="font-black text-slate-800">أرصدة الصناديق</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                    <th className="p-3">الصندوق</th>
                                    <th className="p-3">رصيد البداية</th>
                                    <th className="p-3">داخل</th>
                                    <th className="p-3">خارج</th>
                                    <th className="p-3">تحويلات</th>
                                    <th className="p-3">الرصيد النظري</th>
                                    <th className="p-3">آخر فرق</th>
                                    {isSuperAdmin && <th className="p-3">إجراء</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {rows.map(row => (
                                    <tr key={row.cashbox.id} className={clsx(!row.cashbox.isActive && 'opacity-50')}>
                                        <td className="p-3">
                                            <div className="font-bold text-slate-800">{row.cashbox.name}</div>
                                            <div className="mt-1 flex items-center gap-2">
                                                <CashboxBadge type={row.cashbox.type} />
                                                {row.cashbox.isSaving && <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">ادخار (Saving)</span>}
                                                {row.cashbox.feeEnabled && <span className="text-xs text-rose-600 font-bold">رسوم {row.cashbox.feePercentage}%</span>}
                                            </div>
                                        </td>
                                        <td className="p-3 font-mono">{formatCurrency(row.cashbox.openingBalance)}</td>
                                        <td className="p-3 text-emerald-700 font-bold">{formatCurrency(row.income + row.transferIn)}</td>
                                        <td className="p-3 text-rose-700 font-bold">{formatCurrency(row.expenses + row.transferOut)}</td>
                                        <td className="p-3 text-slate-600">{formatCurrency(row.transferIn - row.transferOut)}</td>
                                        <td className="p-3 font-black text-slate-900">{formatCurrency(row.expectedBalance)}</td>
                                        <td className={clsx('p-3 font-bold', (row.lastReconciliation?.difference || 0) === 0 ? 'text-emerald-700' : 'text-amber-700')}>
                                            {row.lastReconciliation ? formatCurrency(row.lastReconciliation.difference) : 'لم تتم'}
                                        </td>
                                        {isSuperAdmin && (
                                            <td className="p-3">
                                                <div className="flex items-center gap-2">
                                                    <button onClick={() => handleStartEditCashbox(row.cashbox)} className="text-xs font-bold text-blue-600 hover:text-blue-700">
                                                        تعديل
                                                    </button>
                                                    {row.cashbox.isActive && (
                                                        <button onClick={() => handleDeactivateCashbox(row.cashbox.id)} className="text-xs font-bold text-rose-600 hover:text-rose-700">
                                                            تعطيل
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                                {rows.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="p-8 text-center text-slate-500">لم يتم إضافة صناديق بعد</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {isSuperAdmin && (
                    <form onSubmit={handleAddCashbox} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
                        <h3 className="font-black text-slate-800 flex items-center gap-2">
                            {editingCashbox ? <Edit size={18} /> : <Plus size={18} />}
                            {editingCashbox ? 'تعديل صندوق' : 'إضافة صندوق'}
                        </h3>
                        <input required value={newCashbox.name} onChange={e => setNewCashbox({ ...newCashbox, name: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="اسم الصندوق" />
                        <select value={newCashbox.type} onChange={e => setNewCashbox({ ...newCashbox, type: toCashboxType(e.target.value) })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                            {Object.entries(cashboxTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-3">
                            <input required type="number" min="0" step="0.01" value={newCashbox.openingBalance} onChange={e => setNewCashbox({ ...newCashbox, openingBalance: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="رصيد البداية" />
                            <input required type="date" value={newCashbox.openingDate} onChange={e => setNewCashbox({ ...newCashbox, openingDate: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" />
                        </div>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                                <input type="checkbox" checked={newCashbox.feeEnabled} onChange={e => setNewCashbox({ ...newCashbox, feeEnabled: e.target.checked })} className="rounded text-blue-600 focus:ring-blue-500" />
                                تفعيل مصاريف بنك/محفظة
                            </label>
                            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                                <input type="checkbox" checked={newCashbox.isSaving} onChange={e => setNewCashbox({ ...newCashbox, isSaving: e.target.checked })} className="rounded text-blue-600 focus:ring-blue-500" />
                                صندوق ادخار (Saving - لا يظهر في العمليات اليومية)
                            </label>
                        </div>
                        {newCashbox.feeEnabled && (
                            <div className="grid grid-cols-3 gap-2">
                                <input type="number" min="0" step="0.0001" value={newCashbox.feePercentage} onChange={e => setNewCashbox({ ...newCashbox, feePercentage: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="النسبة %" />
                                <input type="number" min="0" step="0.01" value={newCashbox.feeMinAmount} onChange={e => setNewCashbox({ ...newCashbox, feeMinAmount: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="حد أدنى" />
                                <input type="number" min="0" step="0.01" value={newCashbox.feeMaxAmount} onChange={e => setNewCashbox({ ...newCashbox, feeMaxAmount: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="حد أقصى" />
                            </div>
                        )}
                        <div className="flex gap-2">
                            <button type="submit" className="flex-1 rounded-lg bg-slate-900 py-2.5 text-sm font-black text-white hover:bg-slate-800">
                                {editingCashbox ? 'حفظ التعديلات' : 'حفظ الصندوق'}
                            </button>
                            {editingCashbox && (
                                <button type="button" onClick={() => {
                                    setEditingCashbox(null);
                                    setNewCashbox({
                                        name: '',
                                        type: 'cash',
                                        openingBalance: '',
                                        openingDate: today,
                                        feeEnabled: false,
                                        feePercentage: '',
                                        feeMinAmount: '',
                                        feeMaxAmount: '',
                                        isSaving: false
                                    });
                                }} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
                                    إلغاء
                                </button>
                            )}
                        </div>
                    </form>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <form onSubmit={handleAddTransfer} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
                    <h3 className="font-black text-slate-800 flex items-center gap-2">
                        <ArrowLeftRight size={18} />
                        تحويل بين الصناديق
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                        <select required value={transferForm.fromCashboxId} onChange={e => setTransferForm({ ...transferForm, fromCashboxId: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                            <option value="">من صندوق</option>
                            {activeCashboxes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select required value={transferForm.toCashboxId} onChange={e => setTransferForm({ ...transferForm, toCashboxId: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                            <option value="">إلى صندوق</option>
                            {activeCashboxes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <input required type="number" min="0.01" step="0.01" value={transferForm.amount} onChange={e => setTransferForm({ ...transferForm, amount: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="المبلغ" />
                        <input required type="date" value={transferForm.date} onChange={e => setTransferForm({ ...transferForm, date: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" />
                    </div>
                    <input value={transferForm.description} onChange={e => setTransferForm({ ...transferForm, description: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="بيان التحويل" />
                    <button type="submit" className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-black text-white hover:bg-blue-700">تسجيل التحويل</button>
                </form>

                <form onSubmit={handleAddReconciliation} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-black text-slate-800 flex items-center gap-2">
                            <CheckCircle2 size={18} />
                            مطابقة رصيد فعلي
                        </h3>
                        <button
                            type="button"
                            onClick={handleReconcileAll}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-100 transition-colors"
                        >
                            <CheckCircle2 size={13} />
                            مطابقة الكل
                        </button>
                    </div>
                    <select required value={reconciliationForm.cashboxId} onChange={e => setReconciliationForm({ ...reconciliationForm, cashboxId: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <option value="">اختر صندوق</option>
                        {activeCashboxes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {selectedReconciliationRow && (
                        <div className="rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-700">
                            الرصيد النظري: {formatCurrency(selectedReconciliationRow.expectedBalance)}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <input required type="number" min="0" step="0.01" value={reconciliationForm.actualBalance} onChange={e => setReconciliationForm({ ...reconciliationForm, actualBalance: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="الرصيد الفعلي" />
                        <input required type="date" value={reconciliationForm.date} onChange={e => setReconciliationForm({ ...reconciliationForm, date: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" />
                    </div>
                    <input value={reconciliationForm.notes} onChange={e => setReconciliationForm({ ...reconciliationForm, notes: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5" placeholder="ملاحظات المطابقة" />
                    <button type="submit" className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-black text-white hover:bg-emerald-700">حفظ المطابقة</button>
                </form>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                    <h3 className="font-black text-slate-800">آخر التحويلات الداخلية</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                        <thead className="bg-slate-50 text-slate-500">
                            <tr>
                                <th className="p-3">التاريخ</th>
                                <th className="p-3">من</th>
                                <th className="p-3">إلى</th>
                                <th className="p-3">المبلغ</th>
                                <th className="p-3">البيان</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {transfers.slice(0, 10).map(transfer => (
                                <tr key={transfer.id}>
                                    <td className="p-3 text-slate-500">{transfer.date}</td>
                                    <td className="p-3 font-bold">{rows.find(r => r.cashbox.id === transfer.fromCashboxId)?.cashbox.name || 'غير معروف'}</td>
                                    <td className="p-3 font-bold">{rows.find(r => r.cashbox.id === transfer.toCashboxId)?.cashbox.name || 'غير معروف'}</td>
                                    <td className="p-3 font-black text-blue-700">{formatCurrency(transfer.amount)}</td>
                                    <td className="p-3 text-slate-600">{transfer.description || '-'}</td>
                                </tr>
                            ))}
                            {transfers.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-slate-500">لا توجد تحويلات بعد</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
