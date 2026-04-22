/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { Banknote, Users, Truck, Megaphone, Coffee, Package, Trash2, Edit2 } from 'lucide-react';
import { db, type Transaction, type Doctor, type Supplier, type User, type Order } from '../services/db';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { AccountInfoPanel } from '../components/finance/AccountInfoPanel';
import { DoctorSelect } from '../components/orders/DoctorSelect';
import FinancialSetup from '../components/finance/FinancialSetup';
import AdjustmentsPanel from '../components/finance/AdjustmentsPanel';
import { financeService } from '../services/financeService';
import type { Adjustment } from '../services/financeService';
import { DateFilter, filterEntries, calculateTotal } from '../components/finance/FinanceFilters';
import type { FilterType } from '../components/finance/FinanceFilters';
import { useToast } from '../context/ToastContext';
import { isDesignerUser } from '../lib/userRoles';

export default function Finance() {
    const { user } = useAuth();
    const { success: toastSuccess, error: toastError } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const todayDate = new Date().toISOString().split('T')[0];

    const [activeTab, setActiveTab] = useState<'dashboard' | 'expenses' | 'revenue' | 'doctors' | 'suppliers' | 'designers' | 'capital' | 'adjustments'>('dashboard');
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [adjustments, setAdjustments] = useState<Adjustment[]>([]);

    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

    // Forms State
    const [amount, setAmount] = useState(0);
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState(''); // For Expenses
    const [selectedId, setSelectedId] = useState(''); // For Doctors/Suppliers
    const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);
    const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
    // Filters
    const [expenseFilter, setExpenseFilter] = useState<FilterType>('month');
    const [revenueFilter, setRevenueFilter] = useState<FilterType>('month');
    const [doctorPaymentFilter, setDoctorPaymentFilter] = useState<FilterType>('month');
    const [supplierPaymentFilter, setSupplierPaymentFilter] = useState<FilterType>('month');
    const [designerPaymentFilter, setDesignerPaymentFilter] = useState<FilterType>('month');

    // Expense Categories
    const expenseCategories = [
        { id: 'salaries', label: 'مرتبات وأجور', icon: Users },
        { id: 'marketing', label: 'دعايا وسوشيال ميديا', icon: Megaphone },
        { id: 'shipping', label: 'شحن وتوصيل', icon: Truck },
        { id: 'meetings', label: 'اجتماعات ونثريات', icon: Coffee },
        { id: 'material', label: 'خامات ومستهلكات', icon: Package },
        { id: 'other', label: 'مصروفات أخرى', icon: Banknote },
    ];

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                // PERFORMANCE: Removed getAllOrdersUnpaginated() from eager load.
                // Orders are now loaded lazily when entity tabs are opened.
                // Dashboard metrics use server-side RPC instead.
                const [transactionsData, doctorsData, suppliersData, usersData, adjustmentsData] = await Promise.all([
                    db.getTransactions(),
                    db.getDoctors(),
                    db.getSuppliers(),
                    db.getUsers(),
                    financeService.getAdjustments()
                ]);
                setTransactions(transactionsData);
                setDoctors(doctorsData);
                setSuppliers(suppliersData);
                setDesigners(usersData.filter(u => isDesignerUser(u)));
                setAdjustments(adjustmentsData);
            } catch (error) {
                console.error('Error loading finance data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [user?.role]); // Load data when role is available

    // Lazy-load orders when entity tabs are activated
    const [ordersLoaded, setOrdersLoaded] = useState(false);
    useEffect(() => {
        if (['doctors', 'suppliers', 'designers'].includes(activeTab) && !ordersLoaded) {
            db.getAllOrdersUnpaginated().then(data => {
                setOrders(data);
                setOrdersLoaded(true);
            }).catch(err => console.error('Error lazy-loading orders:', err));
        }
    }, [activeTab, ordersLoaded]);

    // Memoized filtered transactions for different tabs
    const generalExpenses = useMemo(() =>
        transactions.filter(t => t.type === 'expense' && (t.entityType === 'general' || !t.entityType)),
        [transactions]
    );

    const generalIncome = useMemo(() =>
        transactions.filter(t => t.type === 'income' && (t.entityType === 'general' || !t.entityType)),
        [transactions]
    );

    const doctorPayments = useMemo(() =>
        transactions.filter(t => t.type === 'income' && t.entityType === 'doctor'),
        [transactions]
    );

    const supplierPayments = useMemo(() =>
        transactions.filter(t => t.type === 'expense' && t.entityType === 'supplier'),
        [transactions]
    );

    const designerPayments = useMemo(() =>
        transactions.filter(t => t.type === 'expense' && t.entityType === 'designer'),
        [transactions]
    );

    // Filtered Lists
    const filteredExpenses = useMemo(() => filterEntries(generalExpenses, expenseFilter), [generalExpenses, expenseFilter]);
    const filteredIncome = useMemo(() => filterEntries(generalIncome, revenueFilter), [generalIncome, revenueFilter]);
    const filteredDoctorPayments = useMemo(() => filterEntries(doctorPayments, doctorPaymentFilter), [doctorPayments, doctorPaymentFilter]);
    const filteredSupplierPayments = useMemo(() => filterEntries(supplierPayments, supplierPaymentFilter), [supplierPayments, supplierPaymentFilter]);
    const filteredDesignerPayments = useMemo(() => filterEntries(designerPayments, designerPaymentFilter), [designerPayments, designerPaymentFilter]);

    const handleResetForm = () => {
        setAmount(0);
        setDescription('');
        setCategory('');
        setSelectedId('');
        setTransactionDate(new Date().toISOString().split('T')[0]);
        setEffectiveDate(new Date().toISOString().split('T')[0]);
        setEditingTransaction(null);
    };

    const handleTransactionUpdate = async () => {
        // Refetch transactions to update lists and balances
        const updatedTx = await db.getTransactions();
        setTransactions(updatedTx);
    };

    const handleEditTransaction = (t: Transaction) => {
        setEditingTransaction(t);
        setAmount(t.amount);
        setDescription(t.description);
        setCategory(t.category || '');
        setTransactionDate(new Date(t.date).toISOString().split('T')[0]);
        // The input is type="month", so it needs "YYYY-MM"
        const ed = t.effectiveDate ? t.effectiveDate : t.date;
        setEffectiveDate(new Date(ed).toISOString().substring(0, 7) + '-01');
        setSelectedId(t.entityId || '');
        // Scroll to form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleAddExpense = async (e: FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            if (editingTransaction) {
                await db.updateTransaction(editingTransaction.id, {
                    amount,
                    category: category,
                    description,
                    date: transactionDate,
                    effectiveDate
                });
            } else {
                await db.addTransaction({
                    type: 'expense',
                    amount,
                    category: category,
                    description,
                    date: transactionDate,
                    effectiveDate,
                    entityType: 'general'
                });
            }
            toastSuccess(editingTransaction ? 'تم تعديل المصروف بنجاح' : 'تم تسجيل المصروف بنجاح');
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding expense:', error);
            toastError('حدث خطأ أثناء تسجيل المصروف');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddRevenue = async (e: FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            if (editingTransaction) {
                await db.updateTransaction(editingTransaction.id, {
                    amount,
                    description,
                    date: transactionDate,
                });
            } else {
                await db.addTransaction({
                    type: 'income',
                    amount,
                    category: 'إيراد عام',
                    description,
                    date: transactionDate,
                    entityType: 'general'
                });
            }
            toastSuccess(editingTransaction ? 'تم تعديل الإيراد بنجاح' : 'تم تسجيل الإيراد بنجاح');
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding revenue:', error);
            toastError('حدث خطأ أثناء تسجيل الإيراد');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddDoctorPayment = async (e: FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const docName = doctors.find(d => d.id === selectedId)?.name;
            if (editingTransaction) {
                await db.updateTransaction(editingTransaction.id, {
                    amount,
                    description,
                    date: transactionDate,
                    entityId: selectedId
                });
            } else {
                await db.addTransaction({
                    type: 'income',
                    amount,
                    category: 'collection',
                    description: `تحصيل من د. ${docName} - ${description}`,
                    date: transactionDate,
                    entityType: 'doctor',
                    entityId: selectedId
                });
            }
            toastSuccess(editingTransaction ? 'تم تعديل التحصيل بنجاح' : 'تم تسجيل التحصيل بنجاح');
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding payment:', error);
            toastError('حدث خطأ أثناء تسجيل التحصيل');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddSupplierPayment = async (e: FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const supName = suppliers.find(s => s.id === selectedId)?.name;
            if (editingTransaction) {
                await db.updateTransaction(editingTransaction.id, {
                    amount,
                    description,
                    date: transactionDate,
                    entityId: selectedId
                });
            } else {
                await db.addTransaction({
                    type: 'expense',
                    amount,
                    category: 'supplier_payment',
                    description: `سداد للمورد ${supName} - ${description}`,
                    date: transactionDate,
                    entityType: 'supplier',
                    entityId: selectedId
                });
            }
            toastSuccess(editingTransaction ? 'تم تعديل السداد بنجاح' : 'تم تسجيل السداد بنجاح');
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding supplier payment:', error);
            toastError('حدث خطأ أثناء تسجيل السداد');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddDesignerPayment = async (e: FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const desName = designers.find(d => d.id === selectedId)?.name;
            if (editingTransaction) {
                await db.updateTransaction(editingTransaction.id, {
                    amount,
                    description,
                    date: transactionDate,
                    entityId: selectedId
                });
            } else {
                await db.addTransaction({
                    type: 'expense',
                    amount,
                    category: 'designer_payment',
                    description: `سداد للمصمم ${desName} - ${description}`,
                    date: transactionDate,
                    entityType: 'designer',
                    entityId: selectedId
                });
            }
            toastSuccess(editingTransaction ? 'تم تعديل السداد بنجاح' : 'تم تسجيل السداد بنجاح');
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding designer payment:', error);
            toastError('حدث خطأ أثناء تسجيل السداد');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-6 pb-20">
            {/* Header */}
            <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                <div>
                    <h1 className="text-xl font-bold text-gray-800">الإدارة المالية</h1>
                    <p className="text-sm text-gray-500">متابعة المصروفات والإيرادات وحسابات العملاء</p>
                </div>
            </div>

            {isLoading && (
                <div className="fixed inset-0 bg-white/50 z-50 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                </div>
            )}

            {/* Modern Navigation Tabs */}
            {/* Modern Navigation Tabs - Restructured for cleanliness */}
            <div className="bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 overflow-x-auto mb-6">
                <div className="flex gap-1 min-w-max justify-center">
                    {(() => {
                        const allTabs = [
                            { id: 'daily_tx', label: 'المعاملات اليومية', icon: '💰', adminOnly: false },
                            { id: 'accounts', label: 'الحسابات', icon: '👥', adminOnly: false },
                            { id: 'reports', label: 'رأس المال والأصول', icon: '🏦', adminOnly: true },
                        ] as const;

                        const tabs = allTabs.filter(t => !t.adminOnly || user?.username === 'admin');

                        return tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    // Map high-level tabs to specific active views
                                    if (tab.id === 'daily_tx') setActiveTab('expenses'); // default sub-tab
                                    if (tab.id === 'accounts') setActiveTab('doctors'); // default sub-tab
                                    if (tab.id === 'reports') setActiveTab('capital'); // default sub-tab
                                }}
                                className={clsx(
                                    "px-6 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center gap-2",
                                    (
                                        (tab.id === 'daily_tx' && ['expenses', 'revenue'].includes(activeTab)) ||
                                        (tab.id === 'accounts' && ['doctors', 'suppliers', 'designers', 'adjustments'].includes(activeTab)) ||
                                        (tab.id === 'reports' && ['capital'].includes(activeTab))
                                    )
                                        ? `bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200`
                                        : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                                )}
                            >
                                <span>{tab.icon}</span>
                                {tab.label}
                            </button>
                        ));
                    })()}
                </div>
            </div>

            {/* Sub-navigation based on main category */}
            {['expenses', 'revenue'].includes(activeTab) && (
                <div className="flex justify-center gap-2 mb-6">
                    <button onClick={() => setActiveTab('expenses')} className={clsx("px-4 py-1.5 rounded-full text-sm font-bold", activeTab === 'expenses' ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>المصروفات</button>
                    <button onClick={() => setActiveTab('revenue')} className={clsx("px-4 py-1.5 rounded-full text-sm font-bold", activeTab === 'revenue' ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>الإيرادات</button>
                </div>
            )}

            {['doctors', 'suppliers', 'designers', 'adjustments'].includes(activeTab) && (
                <div className="flex justify-center flex-wrap gap-2 mb-6">
                    <button onClick={() => setActiveTab('doctors')} className={clsx("px-4 py-1.5 rounded-full text-sm font-bold", activeTab === 'doctors' ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>حسابات الأطباء</button>
                    <button onClick={() => setActiveTab('suppliers')} className={clsx("px-4 py-1.5 rounded-full text-sm font-bold", activeTab === 'suppliers' ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>حسابات الموردين</button>
                    <button onClick={() => setActiveTab('designers')} className={clsx("px-4 py-1.5 rounded-full text-sm font-bold", activeTab === 'designers' ? "bg-pink-100 text-pink-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>حسابات المصممين</button>
                    {['admin', 'accountant'].includes(user?.role || '') && (
                        <button onClick={() => setActiveTab('adjustments')} className={clsx("px-4 py-1.5 rounded-full text-sm font-bold", activeTab === 'adjustments' ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>القيود والتسويات</button>
                    )}
                </div>
            )}

            {['capital'].includes(activeTab) && (
                <div className="flex justify-center flex-wrap gap-2 mb-6">
                    {user?.username === 'admin' && (
                        <button onClick={() => setActiveTab('capital')} className={clsx("px-4 py-1.5 rounded-full text-sm font-bold", activeTab === 'capital' ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>رأس المال والأصول</button>
                    )}
                </div>
            )}


            {/* EXPENSES */}
            {activeTab === 'expenses' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-4">
                            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                                <span className="w-1 h-6 bg-red-500 rounded-full"></span>
                                تسجيل مصروف
                            </h3>
                            <form onSubmit={handleAddExpense} className="space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ المصروف (الدفع الفعلي)</label>
                                        <input aria-label="تاريخ المعاملة" required type="date" max={todayDate} value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">الشهر المالي المستحق (لتوزيع الأرباح)</label>
                                        {/* eslint-disable-next-line -- month type not supported in all browsers */}
                                        <input aria-label="الشهر المالي" required type="month" value={effectiveDate ? effectiveDate.substring(0, 7) : ''} onChange={e => setEffectiveDate(`${e.target.value}-01`)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">نوع المصروف</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {expenseCategories.map(cat => (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setCategory(cat.label)}
                                                className={clsx(
                                                    "p-3 text-xs border rounded-xl flex flex-col items-center gap-2 transition-all duration-200",
                                                    category === cat.label
                                                        ? "bg-red-50 border-red-500 text-red-700 font-bold shadow-sm"
                                                        : "hover:bg-gray-50 border-gray-100 text-gray-600"
                                                )}
                                            >
                                                <cat.icon size={18} />
                                                <span>{cat.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ (ج.م)</label>
                                    <input aria-label="المبلغ" required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 transition-all font-bold text-lg" placeholder="0.00" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
                                    <textarea aria-label="الوصف" required value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 transition-all" placeholder="تفاصيل المصروف..." />
                                </div>
                                <button disabled={isSubmitting} type="submit" className={clsx("w-full bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-200 transition-all active:scale-[0.98]", isSubmitting && "opacity-50 cursor-not-allowed")}>
                                    {isSubmitting ? 'جاري التسجيل...' : (editingTransaction ? 'تحديث المصروف' : 'تسجيل المصروف')}
                                </button>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                                <h3 className="font-bold text-gray-800">سجل المصروفات العامة</h3>
                                <DateFilter activeFilter={expenseFilter} onFilterChange={setExpenseFilter} />
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-right">
                                    <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">النوع</th><th className="p-4 font-medium">الوصف</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{['admin', 'accountant'].includes(user?.role || '') && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {filteredExpenses.map(t => (
                                            <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                                <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                                <td className="p-4 font-bold text-gray-800">{t.category}</td>
                                                <td className="p-4 text-gray-600">{t.description}</td>
                                                <td className="p-4 font-bold text-red-600">{t.amount.toLocaleString()}</td>
                                                <td className="p-4 text-center">
                                                    {t.isRegistered ? (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-700/10">مسجل</span>
                                                    ) : (
                                                        <button onClick={() => { db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate); }} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded transition-colors">تسجيل</button>
                                                    )}
                                                </td>
                                                {['admin', 'accountant'].includes(user?.role || '') && (
                                                    <td className="p-4 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            {['admin', 'accountant'].includes(user?.role || '') && (
                                                                <button onClick={() => handleEditTransaction(t)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="تعديل"><Edit2 size={16} /></button>
                                                            )}
                                                            {user?.role === 'admin' && (
                                                                <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
                                        <tr>
                                            <td colSpan={3} className="p-4 text-gray-700">الإجمالي</td>
                                            <td className="p-4 text-red-700">{calculateTotal(filteredExpenses).toLocaleString()} ج.م</td>
                                            <td colSpan={2}></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* REVENUE */}
            {activeTab === 'revenue' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-4">
                            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                                <span className="w-1 h-6 bg-green-500 rounded-full"></span>
                                تسجيل إيراد عام
                            </h3>
                            <form onSubmit={handleAddRevenue} className="space-y-5">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ الإيراد</label>
                                    <input aria-label="تاريخ المعاملة" required type="date" max={todayDate} value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 transition-all" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ (ج.م)</label>
                                    <input aria-label="المبلغ" required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 transition-all font-bold text-lg" placeholder="0.00" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">وصف الإيراد</label>
                                    <textarea aria-label="الوصف" required value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 transition-all" placeholder="مصدر الإيراد..." />
                                </div>
                                <button disabled={isSubmitting} type="submit" className={clsx("w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-200 transition-all active:scale-[0.98]", isSubmitting && "opacity-50 cursor-not-allowed")}>
                                    {isSubmitting ? 'جاري التسجيل...' : (editingTransaction ? 'تحديث الإيراد' : 'تسجيل الإيراد')}
                                </button>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                                <h3 className="font-bold text-gray-800">سجل الإيرادات العامة</h3>
                                <DateFilter activeFilter={revenueFilter} onFilterChange={setRevenueFilter} />
                            </div>
                            <table className="w-full text-sm text-right">
                                <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">الوصف</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{['admin', 'accountant'].includes(user?.role || '') && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                                <tbody className="divide-y divide-gray-50">
                                    {filteredIncome.map(t => (
                                        <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                            <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                            <td className="p-4 text-gray-800">{t.description}</td>
                                            <td className="p-4 font-bold text-green-600">{t.amount.toLocaleString()}</td>
                                            <td className="p-4 text-center">
                                                {t.isRegistered ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md ring-1 ring-blue-700/10">مسجل</span> : <button onClick={() => db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate)} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded">تسجيل</button>}
                                            </td>
                                            {['admin', 'accountant'].includes(user?.role || '') && (
                                                <td className="p-4 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {['admin', 'accountant'].includes(user?.role || '') && (
                                                            <button onClick={() => handleEditTransaction(t)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="تعديل"><Edit2 size={16} /></button>
                                                        )}
                                                        {user?.role === 'admin' && (
                                                            <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
                                    <tr>
                                        <td colSpan={2} className="p-4 text-gray-700">الإجمالي</td>
                                        <td className="p-4 text-green-700">{calculateTotal(filteredIncome).toLocaleString()} ج.م</td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* DOCTORS TAB - REDESIGNED */}
            {activeTab === 'doctors' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Transaction Form */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                                <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                                تسجيل تحصيل (دفعة)
                            </h3>
                            <form onSubmit={handleAddDoctorPayment} className="space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">الطبيب</label>
                                        <DoctorSelect
                                            value={selectedId}
                                            onChange={setSelectedId}
                                            onlyPrimary={true}
                                        />
                                        <input
                                            type="hidden"
                                            required
                                            value={selectedId}
                                            onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity('يرجى اختيار الطبيب')}
                                            onInput={(e) => (e.target as HTMLInputElement).setCustomValidity('')}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">التاريخ</label>
                                        <input aria-label="تاريخ المعاملة" required type="date" max={todayDate} value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ</label>
                                        <input aria-label="المبلغ" required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 font-bold" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">بيان</label>
                                    <input aria-label="الوصف" value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500" placeholder="مثال: دفعة من الحساب..." />
                                </div>
                                <button disabled={isSubmitting} type="submit" className={clsx("w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-[0.98]", isSubmitting && "opacity-50 cursor-not-allowed")}>
                                    {isSubmitting ? 'جاري التسجيل...' : (editingTransaction ? 'تحديث التحصيل' : 'تسجيل التحصيل')}
                                </button>
                            </form>
                        </div>

                        {/* Account Info Panel */}
                        <div className="h-full">
                            <AccountInfoPanel
                                entityId={selectedId}
                                entityName={doctors.find(d => d.id === selectedId)?.name || ''}
                                entityType="doctor"
                                transactions={transactions}
                                orders={orders}
                                adjustments={adjustments}
                                className="h-full min-h-[300px]"
                            />
                        </div>
                    </div>

                    {/* History Table */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                            <h3 className="font-bold text-gray-800">سجل تحصيلات الأطباء</h3>
                            <DateFilter activeFilter={doctorPaymentFilter} onFilterChange={setDoctorPaymentFilter} />
                        </div>
                        <table className="w-full text-sm text-right">
                            <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">الطبيب</th><th className="p-4 font-medium">البيان</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{['admin', 'accountant'].includes(user?.role || '') && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredDoctorPayments.map(t => (
                                    <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                        <td className="p-4 font-bold text-blue-700">{doctors.find(d => d.id === t.entityId)?.name || 'غير معروف'}</td>
                                        <td className="p-4 text-gray-600">{t.description}</td>
                                        <td className="p-4 font-bold text-green-600">{t.amount.toLocaleString()}</td>
                                        <td className="p-4 text-center">
                                            {t.isRegistered ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md ring-1 ring-blue-700/10">مسجل</span> : <button onClick={() => db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate)} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded">تسجيل</button>}
                                        </td>
                                        {['admin', 'accountant'].includes(user?.role || '') && (
                                            <td className="p-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    {['admin', 'accountant'].includes(user?.role || '') && (
                                                        <button onClick={() => handleEditTransaction(t)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="تعديل"><Edit2 size={16} /></button>
                                                    )}
                                                    {user?.role === 'admin' && (
                                                        <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
                                <tr>
                                    <td colSpan={3} className="p-4 text-gray-700">الإجمالي</td>
                                    <td className="p-4 text-green-700">{calculateTotal(filteredDoctorPayments).toLocaleString()} ج.م</td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* SUPPLIERS TAB */}
            {activeTab === 'suppliers' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                                <span className="w-1 h-6 bg-teal-500 rounded-full"></span>
                                تسجيل سداد لمورد
                            </h3>
                            <form onSubmit={handleAddSupplierPayment} className="space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">المورد</label>
                                        <select aria-label="اختر من القائمة" required value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 transition-all">
                                            <option value="">-- اختر المورد --</option>
                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">التاريخ</label>
                                        <input aria-label="تاريخ المعاملة" required type="date" max={todayDate} value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ</label>
                                        <input aria-label="المبلغ" required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 font-bold" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">بيان</label>
                                    <input aria-label="الوصف" value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500" placeholder="مثال: فاتورة رقم..." />
                                </div>
                                <button disabled={isSubmitting} type="submit" className={clsx("w-full bg-teal-600 text-white py-3 rounded-xl font-bold hover:bg-teal-700 shadow-lg shadow-teal-200 transition-all active:scale-[0.98]", isSubmitting && "opacity-50 cursor-not-allowed")}>
                                    {isSubmitting ? 'جاري التسجيل...' : (editingTransaction ? 'تحديث السداد' : 'تسجيل السداد')}
                                </button>
                            </form>
                        </div>
                        <div className="h-full">
                            <AccountInfoPanel
                                entityId={selectedId}
                                entityName={suppliers.find(s => s.id === selectedId)?.name || ''}
                                entityType="supplier"
                                transactions={transactions}
                                orders={orders}
                                adjustments={adjustments}
                                className="h-full min-h-[300px]"
                            />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                            <h3 className="font-bold text-gray-800">سجل مدفوعات الموردين</h3>
                            <DateFilter activeFilter={supplierPaymentFilter} onFilterChange={setSupplierPaymentFilter} />
                        </div>
                        <table className="w-full text-sm text-right">
                            <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">المورد</th><th className="p-4 font-medium">البيان</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{['admin', 'accountant'].includes(user?.role || '') && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredSupplierPayments.map(t => (
                                    <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                        <td className="p-4 font-bold text-teal-700">{suppliers.find(s => s.id === t.entityId)?.name || 'غير معروف'}</td>
                                        <td className="p-4 text-gray-600">{t.description}</td>
                                        <td className="p-4 font-bold text-red-600">{t.amount.toLocaleString()}</td>
                                        <td className="p-4 text-center">
                                            {t.isRegistered ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md ring-1 ring-blue-700/10">مسجل</span> : <button onClick={() => db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate)} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded">تسجيل</button>}
                                        </td>
                                        {['admin', 'accountant'].includes(user?.role || '') && (
                                            <td className="p-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    {['admin', 'accountant'].includes(user?.role || '') && (
                                                        <button onClick={() => handleEditTransaction(t)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="تعديل"><Edit2 size={16} /></button>
                                                    )}
                                                    {user?.role === 'admin' && (
                                                        <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
                                <tr>
                                    <td colSpan={3} className="p-4 text-gray-700">الإجمالي</td>
                                    <td className="p-4 text-red-700">{calculateTotal(filteredSupplierPayments).toLocaleString()} ج.م</td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* DESIGNERS TAB */}
            {activeTab === 'designers' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                                <span className="w-1 h-6 bg-pink-500 rounded-full"></span>
                                تسجيل سداد لمصمم
                            </h3>
                            <form onSubmit={handleAddDesignerPayment} className="space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">المصمم</label>
                                        <select aria-label="اختر من القائمة" required value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 transition-all">
                                            <option value="">-- اختر المصمم --</option>
                                            {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">التاريخ</label>
                                        <input aria-label="تاريخ المعاملة" required type="date" max={todayDate} value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ</label>
                                        <input aria-label="المبلغ" required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 font-bold" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">بيان</label>
                                    <input aria-label="الوصف" value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500" placeholder="مثال: حساب الأسبوع..." />
                                </div>
                                <button disabled={isSubmitting} type="submit" className={clsx("w-full bg-pink-600 text-white py-3 rounded-xl font-bold hover:bg-pink-700 shadow-lg shadow-pink-200 transition-all active:scale-[0.98]", isSubmitting && "opacity-50 cursor-not-allowed")}>
                                    {isSubmitting ? 'جاري التسجيل...' : (editingTransaction ? 'تحديث السداد' : 'تسجيل السداد')}
                                </button>
                            </form>
                        </div>
                        <div className="h-full">
                            <AccountInfoPanel
                                entityId={selectedId}
                                entityName={designers.find(d => d.id === selectedId)?.name || ''}
                                entityType="designer"
                                transactions={transactions}
                                orders={orders}
                                adjustments={adjustments}
                                className="h-full min-h-[300px]"
                            />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                            <h3 className="font-bold text-gray-800">سجل مدفوعات المصممين</h3>
                            <DateFilter activeFilter={designerPaymentFilter} onFilterChange={setDesignerPaymentFilter} />
                        </div>
                        <table className="w-full text-sm text-right">
                            <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">المصمم</th><th className="p-4 font-medium">البيان</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{['admin', 'accountant'].includes(user?.role || '') && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredDesignerPayments.map(t => (
                                    <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                        <td className="p-4 font-bold text-pink-700">{designers.find(d => d.id === t.entityId)?.name || 'غير معروف'}</td>
                                        <td className="p-4 text-gray-600">{t.description}</td>
                                        <td className="p-4 font-bold text-red-600">{t.amount.toLocaleString()}</td>
                                        <td className="p-4 text-center">
                                            {t.isRegistered ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md ring-1 ring-blue-700/10">مسجل</span> : <button onClick={() => db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate)} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded">تسجيل</button>}
                                        </td>
                                        {['admin', 'accountant'].includes(user?.role || '') && (
                                            <td className="p-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    {['admin', 'accountant'].includes(user?.role || '') && (
                                                        <button onClick={() => handleEditTransaction(t)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="تعديل"><Edit2 size={16} /></button>
                                                    )}
                                                    {user?.role === 'admin' && (
                                                        <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
                                <tr>
                                    <td colSpan={3} className="p-4 text-gray-700">الإجمالي</td>
                                    <td className="p-4 text-red-700">{calculateTotal(filteredDesignerPayments).toLocaleString()} ج.م</td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}


            {/* CAPITAL & ASSETS TAB (ADMIN ONLY) */}
            {activeTab === 'capital' && user?.role === 'admin' && (
                <FinancialSetup />
            )}

            {/* ADJUSTMENTS TAB (ADMIN ONLY) */}
            {activeTab === 'adjustments' && user?.role === 'admin' && (
                <AdjustmentsPanel />
            )}
        </div>
    );
}


