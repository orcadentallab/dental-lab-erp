import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Wallet, TrendingUp, ArrowDownCircle, Banknote, Users, Truck, Megaphone, Coffee, Package, FileSpreadsheet, Trash2, Edit2, Printer } from 'lucide-react'; // Fixed imports
import { db, type Service, type Transaction, type Doctor, type Supplier, type User, type Order } from '../services/db';
import clsx from 'clsx';
import { exportToExcel, printTable } from '../lib/exportUtils';
import { useAuth } from '../context/AuthContext';
import { AccountInfoPanel } from '../components/finance/AccountInfoPanel';

export default function Finance() {
    const { user } = useAuth();
    const canExport = ['admin', 'accountant', 'lab'].includes(user?.role || '');

    const [activeTab, setActiveTab] = useState<'dashboard' | 'expenses' | 'revenue' | 'doctors' | 'suppliers' | 'designers' | 'services'>('dashboard');
    const [services, setServices] = useState<Service[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);

    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [representatives, setRepresentatives] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingService, setEditingService] = useState<Service | null>(null);
    const serviceFormRef = useRef<HTMLFormElement>(null);

    // Forms State
    const [amount, setAmount] = useState(0);
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState(''); // For Expenses
    const [selectedId, setSelectedId] = useState(''); // For Doctors/Suppliers
    const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);

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
                const [servicesData, transactionsData, doctorsData, suppliersData, usersData, ordersData] = await Promise.all([
                    db.getServices(),
                    db.getTransactions(),
                    db.getDoctors(),
                    db.getSuppliers(),
                    db.getUsers(),
                    db.getOrders()
                ]);
                setServices(servicesData);
                setTransactions(transactionsData);
                setDoctors(doctorsData);
                setSuppliers(suppliersData);
                setDesigners(usersData.filter(u => u.role === 'designer'));
                setRepresentatives(usersData.filter(u => u.role === 'representative' || (u.role === 'admin' && u.username !== 'admin')));
                setOrders(ordersData);
            } catch (error) {
                console.error('Error loading finance data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []); // Only load once on mount, or we could reload on tab change but data is shared

    // Financial Metrics - exclude unsettled staff expenses from calculations
    const totalExpenses = transactions
        .filter(t => {
            if (t.type !== 'expense') return false;
            // If it's a rep expense and not settled, don't count it
            const isRepExpense = representatives.some(r => r.id === t.entityId);
            if (isRepExpense && !t.isRegistered) return false;
            return true;
        })
        .reduce((sum, t) => sum + t.amount, 0);
    const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const currentBalance = totalIncome - totalExpenses;

    const handleResetForm = () => {
        setAmount(0);
        setDescription('');
        setCategory('');
        setSelectedId('');
        setTransactionDate(new Date().toISOString().split('T')[0]);
    };

    const handleTransactionUpdate = async () => {
        // Refetch transactions to update lists and balances
        const updatedTx = await db.getTransactions();
        setTransactions(updatedTx);
    };

    const handleAddExpense = async (e: FormEvent) => {
        e.preventDefault();
        try {
            await db.addTransaction({
                type: 'expense',
                amount,
                category: category,
                description,
                date: new Date(transactionDate).toISOString(),
                entityType: 'general'
            });
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding expense:', error);
        }
    };

    const handleAddRevenue = async (e: FormEvent) => {
        e.preventDefault();
        try {
            await db.addTransaction({
                type: 'income',
                amount,
                category: 'إيراد عام',
                description,
                date: new Date(transactionDate).toISOString(),
                entityType: 'general'
            });
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding revenue:', error);
        }
    };

    const handleAddDoctorPayment = async (e: FormEvent) => {
        e.preventDefault();
        try {
            const docName = doctors.find(d => d.id === selectedId)?.name;
            await db.addTransaction({
                type: 'income',
                amount,
                category: 'collection',
                description: `تحصيل من د. ${docName} - ${description}`,
                date: new Date(transactionDate).toISOString(),
                entityType: 'doctor',
                entityId: selectedId
            });
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding payment:', error);
        }
    };

    const handleAddSupplierPayment = async (e: FormEvent) => {
        e.preventDefault();
        try {
            const supName = suppliers.find(s => s.id === selectedId)?.name;
            await db.addTransaction({
                type: 'expense',
                amount,
                category: 'supplier_payment',
                description: `سداد للمورد ${supName} - ${description}`,
                date: new Date(transactionDate).toISOString(),
                entityType: 'supplier',
                entityId: selectedId
            });
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding supplier payment:', error);
        }
    };

    const handleAddDesignerPayment = async (e: FormEvent) => {
        e.preventDefault();
        try {
            const desName = designers.find(d => d.id === selectedId)?.name;
            await db.addTransaction({
                type: 'expense',
                amount,
                category: 'designer_payment',
                description: `سداد للمصمم ${desName} - ${description}`,
                date: new Date(transactionDate).toISOString(),
                entityType: 'designer',
                entityId: selectedId
            });
            await handleTransactionUpdate();
            handleResetForm();
        } catch (error) {
            console.error('Error adding designer payment:', error);
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
            <div className="bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
                <div className="flex gap-1 min-w-max">
                    {[
                        { id: 'dashboard', label: 'نظرة عامة', color: 'blue' },
                        { id: 'expenses', label: 'المصروفات', color: 'red' },
                        { id: 'revenue', label: 'الإيرادات', color: 'green' },
                        { id: 'doctors', label: 'حسابات الأطباء', color: 'blue' },
                        { id: 'suppliers', label: 'حسابات الموردين', color: 'purple' },
                        { id: 'designers', label: 'حسابات المصممين', color: 'pink' },
                        { id: 'services', label: 'قائمة الأسعار', color: 'amber' },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={clsx(
                                "px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200",
                                activeTab === tab.id
                                    ? `bg-${tab.color}-50 text-${tab.color}-600 shadow-sm ring-1 ring-${tab.color}-200`
                                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* DASHBOARD */}
            {activeTab === 'dashboard' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 rounded-2xl text-white shadow-lg shadow-blue-200">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl"><Wallet size={24} /></div>
                            <span className="text-xs font-medium bg-blue-500/30 px-2 py-1 rounded-lg">الميزانية الحالية</span>
                        </div>
                        <div>
                            <p className="text-blue-100 text-sm font-medium mb-1">صافي الرصيد</p>
                            <h3 className="text-3xl font-bold tracking-tight">{currentBalance.toLocaleString()} <span className="text-sm font-normal text-blue-200">ج.م</span></h3>
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-red-100 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-3 bg-red-50 text-red-600 rounded-xl"><ArrowDownCircle size={24} /></div>
                            <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded-lg">مصروفات</span>
                        </div>
                        <div>
                            <p className="text-gray-500 text-sm font-medium mb-1">إجمالي المصروفات</p>
                            <h3 className="text-3xl font-bold text-gray-900">{totalExpenses.toLocaleString()} <span className="text-sm font-normal text-gray-400">ج.م</span></h3>
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-green-100 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-3 bg-green-50 text-green-600 rounded-xl"><TrendingUp size={24} /></div>
                            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-lg">إيرادات</span>
                        </div>
                        <div>
                            <p className="text-gray-500 text-sm font-medium mb-1">إجمالي المقبوضات</p>
                            <h3 className="text-3xl font-bold text-gray-900">{totalIncome.toLocaleString()} <span className="text-sm font-normal text-gray-400">ج.م</span></h3>
                        </div>
                    </div>
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
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ المصروف</label>
                                    <input aria-label="تاريخ المعاملة" required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all" />
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
                                <button type="submit" className="w-full bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-200 transition-all active:scale-[0.98]">تسجيل المصروف</button>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                                <h3 className="font-bold text-gray-800">سجل المصروفات العامة</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-right">
                                    <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">النوع</th><th className="p-4 font-medium">الوصف</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{user?.role === 'admin' && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {transactions.filter(t => t.type === 'expense' && t.entityType === 'general').map(t => (
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
                                                {user?.role === 'admin' && (
                                                    <td className="p-4 text-center">
                                                        <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
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
                                    <input aria-label="تاريخ المعاملة" required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 transition-all" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ (ج.م)</label>
                                    <input aria-label="المبلغ" required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 transition-all font-bold text-lg" placeholder="0.00" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">وصف الإيراد</label>
                                    <textarea aria-label="الوصف" required value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 transition-all" placeholder="مصدر الإيراد..." />
                                </div>
                                <button type="submit" className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-200 transition-all active:scale-[0.98]">تسجيل الإيراد</button>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                                <h3 className="font-bold text-gray-800">سجل الإيرادات العامة</h3>
                            </div>
                            <table className="w-full text-sm text-right">
                                <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">الوصف</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{user?.role === 'admin' && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                                <tbody className="divide-y divide-gray-50">
                                    {transactions.filter(t => t.type === 'income' && t.entityType === 'general').map(t => (
                                        <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                            <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                            <td className="p-4 text-gray-800">{t.description}</td>
                                            <td className="p-4 font-bold text-green-600">{t.amount.toLocaleString()}</td>
                                            <td className="p-4 text-center">
                                                {t.isRegistered ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md ring-1 ring-blue-700/10">مسجل</span> : <button onClick={() => db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate)} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded">تسجيل</button>}
                                            </td>
                                            {user?.role === 'admin' && (
                                                <td className="p-4 text-center">
                                                    <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
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
                                        <select aria-label="اختر من القائمة" required value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 transition-all">
                                            <option value="">-- اختر الطبيب --</option>
                                            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">التاريخ</label>
                                        <input aria-label="تاريخ المعاملة" required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500" />
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
                                <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-[0.98]">تسجيل التحصيل</button>
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
                                className="h-full min-h-[300px]"
                            />
                        </div>
                    </div>

                    {/* History Table */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="font-bold text-gray-800">سجل تحصيلات الأطباء</h3>
                        </div>
                        <table className="w-full text-sm text-right">
                            <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">الطبيب</th><th className="p-4 font-medium">البيان</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{user?.role === 'admin' && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                            <tbody className="divide-y divide-gray-50">
                                {transactions.filter(t => t.type === 'income' && t.entityType === 'doctor').map(t => (
                                    <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                        <td className="p-4 font-bold text-blue-700">{doctors.find(d => d.id === t.entityId)?.name || 'غير معروف'}</td>
                                        <td className="p-4 text-gray-600">{t.description}</td>
                                        <td className="p-4 font-bold text-green-600">{t.amount.toLocaleString()}</td>
                                        <td className="p-4 text-center">
                                            {t.isRegistered ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md ring-1 ring-blue-700/10">مسجل</span> : <button onClick={() => db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate)} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded">تسجيل</button>}
                                        </td>
                                        {user?.role === 'admin' && (
                                            <td className="p-4 text-center">
                                                <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
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
                                <span className="w-1 h-6 bg-purple-500 rounded-full"></span>
                                تسجيل سداد لمورد
                            </h3>
                            <form onSubmit={handleAddSupplierPayment} className="space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">المورد</label>
                                        <select aria-label="اختر من القائمة" required value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 transition-all">
                                            <option value="">-- اختر المورد --</option>
                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">التاريخ</label>
                                        <input aria-label="تاريخ المعاملة" required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ</label>
                                        <input aria-label="المبلغ" required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 font-bold" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">بيان</label>
                                    <input aria-label="الوصف" value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500" placeholder="مثال: فاتورة رقم..." />
                                </div>
                                <button type="submit" className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold hover:bg-purple-700 shadow-lg shadow-purple-200 transition-all active:scale-[0.98]">تسجيل السداد</button>
                            </form>
                        </div>
                        <div className="h-full">
                            <AccountInfoPanel
                                entityId={selectedId}
                                entityName={suppliers.find(s => s.id === selectedId)?.name || ''}
                                entityType="supplier"
                                transactions={transactions}
                                orders={orders}
                                className="h-full min-h-[300px]"
                            />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="font-bold text-gray-800">سجل مدفوعات الموردين</h3>
                        </div>
                        <table className="w-full text-sm text-right">
                            <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">المورد</th><th className="p-4 font-medium">البيان</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{user?.role === 'admin' && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                            <tbody className="divide-y divide-gray-50">
                                {transactions.filter(t => t.type === 'expense' && t.entityType === 'supplier').map(t => (
                                    <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                        <td className="p-4 font-bold text-purple-700">{suppliers.find(s => s.id === t.entityId)?.name || 'غير معروف'}</td>
                                        <td className="p-4 text-gray-600">{t.description}</td>
                                        <td className="p-4 font-bold text-red-600">{t.amount.toLocaleString()}</td>
                                        <td className="p-4 text-center">
                                            {t.isRegistered ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md ring-1 ring-blue-700/10">مسجل</span> : <button onClick={() => db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate)} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded">تسجيل</button>}
                                        </td>
                                        {user?.role === 'admin' && (
                                            <td className="p-4 text-center">
                                                <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
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
                                        <input aria-label="تاريخ المعاملة" required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500" />
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
                                <button type="submit" className="w-full bg-pink-600 text-white py-3 rounded-xl font-bold hover:bg-pink-700 shadow-lg shadow-pink-200 transition-all active:scale-[0.98]">تسجيل السداد</button>
                            </form>
                        </div>
                        <div className="h-full">
                            <AccountInfoPanel
                                entityId={selectedId}
                                entityName={designers.find(d => d.id === selectedId)?.name || ''}
                                entityType="designer"
                                transactions={transactions}
                                orders={orders}
                                className="h-full min-h-[300px]"
                            />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="font-bold text-gray-800">سجل مدفوعات المصممين</h3>
                        </div>
                        <table className="w-full text-sm text-right">
                            <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">التاريخ</th><th className="p-4 font-medium">المصمم</th><th className="p-4 font-medium">البيان</th><th className="p-4 font-medium">المبلغ</th><th className="p-4 font-medium text-center">الحالة</th>{user?.role === 'admin' && <th className="p-4 font-medium text-center">إجراءات</th>}</tr></thead>
                            <tbody className="divide-y divide-gray-50">
                                {transactions.filter(t => t.type === 'expense' && t.entityType === 'designer').map(t => (
                                    <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="p-4 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                        <td className="p-4 font-bold text-pink-700">{designers.find(d => d.id === t.entityId)?.name || 'غير معروف'}</td>
                                        <td className="p-4 text-gray-600">{t.description}</td>
                                        <td className="p-4 font-bold text-red-600">{t.amount.toLocaleString()}</td>
                                        <td className="p-4 text-center">
                                            {t.isRegistered ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md ring-1 ring-blue-700/10">مسجل</span> : <button onClick={() => db.updateTransaction(t.id, { isRegistered: true }).then(handleTransactionUpdate)} className="text-xs bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded">تسجيل</button>}
                                        </td>
                                        {user?.role === 'admin' && (
                                            <td className="p-4 text-center">
                                                <button onClick={() => { if (confirm('حذف؟')) db.deleteTransaction(t.id).then(handleTransactionUpdate); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="حذف" aria-label="حذف"><Trash2 size={16} /></button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* SERVICES */}
            {activeTab === 'services' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-4">
                            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                                <span className="w-1 h-6 bg-amber-500 rounded-full"></span>
                                {editingService ? 'تعديل خدمة' : 'إضافة خدمة جديدة'}
                            </h3>
                            <form ref={serviceFormRef} onSubmit={async (e) => {
                                e.preventDefault();
                                const formData = new FormData(e.currentTarget);
                                const name = formData.get('name')?.toString() || '';
                                const sellingPrice = Number(formData.get('sellingPrice'));
                                const costPrice = Number(formData.get('costPrice'));
                                const millingPrice = Number(formData.get('millingPrice')) || 0;

                                try {
                                    if (editingService) {
                                        await db.updateService(editingService.id, { name, sellingPrice, costPrice, millingPrice });
                                        setEditingService(null);
                                    } else {
                                        await db.addService({ name, sellingPrice, costPrice, millingPrice });
                                    }
                                    const updatedServices = await db.getServices();
                                    setServices(updatedServices);
                                    e.currentTarget.reset();
                                } catch (error) {
                                    console.error('Error saving service:', error);
                                }
                            }} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">اسم الخدمة</label>
                                    <input aria-label="اسم الخدمة" name="name" required defaultValue={editingService?.name} key={editingService?.id} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 transition-all" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">سعر البيع</label>
                                        <input aria-label="سعر البيع" name="sellingPrice" required type="number" defaultValue={editingService?.sellingPrice} key={`s-${editingService?.id}`} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 transition-all" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">التكلفة</label>
                                        <input aria-label="سعر التكلفة" name="costPrice" required type="number" defaultValue={editingService?.costPrice} key={`c-${editingService?.id}`} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 transition-all" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">سعر الخراطة (للمعامل)</label>
                                    <input aria-label="سعر الخراطة" name="millingPrice" type="number" defaultValue={editingService?.millingPrice} key={`m-${editingService?.id}`} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 transition-all" />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button type="submit" className="flex-1 bg-amber-600 text-white py-2.5 rounded-xl font-bold hover:bg-amber-700 shadow-lg shadow-amber-200 transition-all active:scale-[0.98]">
                                        {editingService ? 'تحديث' : 'حفظ'}
                                    </button>
                                    {editingService && (
                                        <button type="button" onClick={() => { setEditingService(null); serviceFormRef.current?.reset(); }} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all">إلغاء</button>
                                    )}
                                </div>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                                <h3 className="font-bold text-gray-800">قائمة أسعار الخدمات</h3>
                                {canExport && (
                                    <div className="flex gap-2">
                                        <button onClick={() => exportToExcel(services.map(s => ({ 'اسم الخدمة': s.name, 'سعر البيع': s.sellingPrice, 'التكلفة': s.costPrice, 'الخراطة': s.millingPrice || 0, 'الربح': s.sellingPrice - s.costPrice })), `services_${new Date().toISOString().split('T')[0]}`, 'الخدمات')} className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="تصدير Excel"><FileSpreadsheet size={18} /></button>
                                        <button onClick={() => printTable(services, [
                                            { key: 'name', label: 'اسم الخدمة' },
                                            { key: 'sellingPrice', label: 'سعر البيع' },
                                            { key: 'costPrice', label: 'التكلفة' },
                                            { key: 'millingPrice', label: 'الخراطة' }
                                        ], 'قائمة الخدمات')} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="طباعة"><Printer size={18} /></button>
                                    </div>
                                )}
                            </div>
                            <table className="w-full text-sm text-right">
                                <thead className="text-gray-500 bg-gray-50/50"><tr><th className="p-4 font-medium">الخدمة</th><th className="p-4 font-medium">سعر البيع</th><th className="p-4 font-medium">التكلفة</th><th className="p-4 font-medium">الخراطة</th><th className="p-4 font-medium text-center">إجراءات</th></tr></thead>
                                <tbody className="divide-y divide-gray-50">
                                    {services.map(s => (
                                        <tr key={s.id} className="hover:bg-gray-50 transition-colors group">
                                            <td className="p-4 font-bold text-gray-800">{s.name}</td>
                                            <td className="p-4 text-blue-600 font-bold">{s.sellingPrice}</td>
                                            <td className="p-4 text-red-600">{s.costPrice}</td>
                                            <td className="p-4 text-gray-500">{s.millingPrice || '-'}</td>
                                            <td className="p-4 text-center">
                                                <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => setEditingService(s)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded-lg" title="تعديل"><Edit2 size={16} /></button>
                                                    <button onClick={() => { if (confirm('حذف؟')) db.deleteService(s.id).then(() => db.getServices().then(setServices)); }} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg" title="حذف"><Trash2 size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


