import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Wallet, TrendingUp, ArrowDownCircle, Banknote, Users, Truck, Megaphone, Coffee, Package, Edit2, Trash2, FileSpreadsheet, Printer } from 'lucide-react';
import { db, type Service, type Transaction } from '../services/db';
import clsx from 'clsx';
import { exportToExcel, printTable } from '../lib/exportUtils';

export default function Finance() {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'expenses' | 'doctors' | 'suppliers' | 'designers' | 'services'>('dashboard');
    const [services, setServices] = useState<Service[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);

    const [doctors, setDoctors] = useState<any[]>([]);
    const [suppliers, setSuppliers] = useState<any[]>([]);
    const [designers, setDesigners] = useState<any[]>([]);
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
                const [servicesData, transactionsData, doctorsData, suppliersData, usersData] = await Promise.all([
                    db.getServices(),
                    db.getTransactions(),
                    db.getDoctors(),
                    db.getSuppliers(),
                    db.getUsers()
                ]);
                setServices(servicesData);
                setTransactions(transactionsData);
                setDoctors(doctorsData);
                setSuppliers(suppliersData);
                setDesigners(usersData.filter(u => u.role === 'designer'));
            } catch (error) {
                console.error('Error loading finance data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [activeTab]);

    // Financial Metrics
    const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const currentBalance = totalIncome - totalExpenses;

    const handleResetForm = () => {
        setAmount(0);
        setDescription('');
        setCategory('');
        setSelectedId('');
        setTransactionDate(new Date().toISOString().split('T')[0]);
    };

    const handleAddExpense = async (e: FormEvent) => {
        e.preventDefault();
        try {
            const tx = await db.addTransaction({
                type: 'expense',
                amount,
                category: category,
                description,
                date: new Date(transactionDate).toISOString(),
                entityType: 'general'
            });
            setTransactions([...transactions, tx]);
            handleResetForm();
        } catch (error) {
            console.error('Error adding expense:', error);
        }
    };

    const handleAddDoctorPayment = async (e: FormEvent) => {
        e.preventDefault();
        try {
            const docName = doctors.find(d => d.id === selectedId)?.name;
            const tx = await db.addTransaction({
                type: 'income',
                amount,
                category: 'collection',
                description: `تحصيل من د. ${docName} - ${description}`,
                date: new Date(transactionDate).toISOString(),
                entityType: 'doctor',
                entityId: selectedId
            });
            setTransactions([...transactions, tx]);
            handleResetForm();
        } catch (error) {
            console.error('Error adding payment:', error);
        }
    };

    const handleAddSupplierPayment = async (e: FormEvent) => {
        e.preventDefault();
        try {
            const supName = suppliers.find(s => s.id === selectedId)?.name;
            const tx = await db.addTransaction({
                type: 'expense',
                amount,
                category: 'supplier_payment',
                description: `سداد للمورد ${supName} - ${description}`,
                date: new Date(transactionDate).toISOString(),
                entityType: 'supplier',
                entityId: selectedId
            });
            setTransactions([...transactions, tx]);
            handleResetForm();
        } catch (error) {
            console.error('Error adding supplier payment:', error);
        }
    };

    const handleAddDesignerPayment = async (e: FormEvent) => {
        e.preventDefault();
        try {
            const desName = designers.find(d => d.id === selectedId)?.name;
            const tx = await db.addTransaction({
                type: 'expense',
                amount,
                category: 'designer_payment',
                description: `سداد للمصمم ${desName} - ${description}`,
                date: new Date(transactionDate).toISOString(),
                entityType: 'designer',
                entityId: selectedId
            });
            setTransactions([...transactions, tx]);
            handleResetForm();
        } catch (error) {
            console.error('Error adding designer payment:', error);
        }
    };

    return (
        <div>
            <h1 className="text-2xl font-bold text-gray-800 mb-6">الإدارة المالية</h1>

            {isLoading && (
                <div className="fixed inset-0 bg-white/50 z-50 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            )}

            {/* Navigation */}
            <div className="flex gap-4 mb-8 border-b border-gray-200 overflow-x-auto pb-1">
                <button onClick={() => setActiveTab('dashboard')} className={clsx("pb-4 px-4 font-medium whitespace-nowrap", activeTab === 'dashboard' ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700")}>نظرة عامة</button>
                <button onClick={() => setActiveTab('expenses')} className={clsx("pb-4 px-4 font-medium whitespace-nowrap", activeTab === 'expenses' ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700")}>المصروفات العامة</button>
                <button onClick={() => setActiveTab('doctors')} className={clsx("pb-4 px-4 font-medium whitespace-nowrap", activeTab === 'doctors' ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700")}>سداد الدكاترة (تحصيل)</button>
                <button onClick={() => setActiveTab('suppliers')} className={clsx("pb-4 px-4 font-medium whitespace-nowrap", activeTab === 'suppliers' ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700")}>سداد الموردين</button>
                <button onClick={() => setActiveTab('designers')} className={clsx("pb-4 px-4 font-medium whitespace-nowrap", activeTab === 'designers' ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700")}>سداد المصممين</button>
                <button onClick={() => setActiveTab('services')} className={clsx("pb-4 px-4 font-medium whitespace-nowrap", activeTab === 'services' ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700")}>قائمة الأسعار</button>
            </div>

            {/* DASHBOARD */}
            {activeTab === 'dashboard' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div className="flex items-center gap-4 mb-2">
                                <div className="p-3 bg-blue-100 text-blue-600 rounded-lg"><Wallet size={24} /></div>
                                <span className="text-gray-500">رصيد الخزنة الحالي</span>
                            </div>
                            <div className="text-3xl font-bold text-gray-900">{currentBalance.toLocaleString()} ج.م</div>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div className="flex items-center gap-4 mb-2">
                                <div className="p-3 bg-red-100 text-red-600 rounded-lg"><ArrowDownCircle size={24} /></div>
                                <span className="text-gray-500">إجمالي المصروفات</span>
                            </div>
                            <div className="text-3xl font-bold text-gray-900">{totalExpenses.toLocaleString()} ج.م</div>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div className="flex items-center gap-4 mb-2">
                                <div className="p-3 bg-green-100 text-green-600 rounded-lg"><TrendingUp size={24} /></div>
                                <span className="text-gray-500">إجمالي التحصيلات</span>
                            </div>
                            <div className="text-3xl font-bold text-gray-900">{totalIncome.toLocaleString()} ج.م</div>
                        </div>
                    </div>
                </div>
            )}

            {/* EXPENSES */}
            {activeTab === 'expenses' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="font-bold mb-4">تسجيل مصروف جديد</h3>
                            <form onSubmit={handleAddExpense} className="space-y-4">
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">تاريخ المعاملة</label>
                                    <input required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">نوع المصروف</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {expenseCategories.map(cat => (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setCategory(cat.label)}
                                                className={clsx(
                                                    "p-2 text-xs border rounded-lg flex flex-col items-center gap-1 transition-colors",
                                                    category === cat.label ? "bg-red-50 border-red-500 text-red-700 font-bold" : "hover:bg-gray-50 bg-white"
                                                )}
                                            >
                                                <cat.icon size={16} />
                                                <span>{cat.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                    {!category && <p className="text-xs text-red-500 mt-1">يرجى اختيار نوع المصروف</p>}
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">المبلغ</label>
                                    <input required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2 border border-gray-200 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">ملاحظات / وصف</label>
                                    <textarea required value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full p-2 border border-gray-200 rounded-lg" placeholder="مثال: فاتورة كهرباء شهر 5" />
                                </div>
                                <button type="submit" className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-700">تسجيل المصروف</button>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                            <h3 className="p-4 font-bold border-b bg-gray-50">سجل المصروفات العامة</h3>
                            <table className="w-full text-sm text-right">
                                <thead className="text-gray-500 bg-gray-50"><tr><th className="p-3">التاريخ</th><th className="p-3">النوع</th><th className="p-3">الوصف</th><th className="p-3">المبلغ</th><th className="p-3">تسجيل؟</th></tr></thead>
                                <tbody>
                                    {transactions.filter(t => t.type === 'expense' && t.entityType === 'general').map(t => (
                                        <tr key={t.id} className="border-t hover:bg-gray-50">
                                            <td className="p-3 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                            <td className="p-3 font-bold">{t.category}</td>
                                            <td className="p-3">{t.description}</td>
                                            <td className="p-3 font-bold text-red-600">{t.amount.toLocaleString()}</td>
                                            <td className="p-3 text-center">
                                                {t.isRegistered ? (
                                                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">مسجل</span>
                                                ) : (
                                                    <button
                                                        onClick={async () => {
                                                            await db.updateTransaction(t.id, { isRegistered: true });
                                                            const updatedTx = await db.getTransactions();
                                                            setTransactions(updatedTx);
                                                        }}
                                                        className="text-[10px] bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded border border-gray-200 transition-colors"
                                                    >
                                                        تسجيل
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {transactions.filter(t => t.type === 'expense' && t.entityType === 'general').length === 0 && (
                                        <tr><td colSpan={4} className="p-4 text-center text-gray-400">لا توجد مصروفات مسجلة</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* DOCTORS INCOME */}
            {activeTab === 'doctors' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="font-bold mb-4">تسجيل دفعة من طبيب</h3>
                            <form onSubmit={handleAddDoctorPayment} className="space-y-4">
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">تاريخ المعاملة</label>
                                    <input required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2 border rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">الطبيب</label>
                                    <select required value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full p-2 border rounded-lg">
                                        <option value="">-- اختر الطبيب --</option>
                                        {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">المبلغ المدفوع</label>
                                    <input required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2 border rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">بيان / ملاحظات</label>
                                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full p-2 border rounded-lg" placeholder="مثال: دفعة تحت الحساب" />
                                </div>
                                <button type="submit" className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">تسجيل التحصيل</button>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                            <h3 className="p-4 font-bold border-b bg-gray-50">سجل تحصيلات الأطباء</h3>
                            <table className="w-full text-sm text-right">
                                <thead className="text-gray-500 bg-gray-50"><tr><th className="p-3">التاريخ</th><th className="p-3">الطبيب</th><th className="p-3">البيان</th><th className="p-3">المبلغ</th><th className="p-3">تسجيل؟</th></tr></thead>
                                <tbody>
                                    {transactions.filter(t => t.type === 'income' && t.entityType === 'doctor').map(t => {
                                        const docName = doctors.find(d => d.id === t.entityId)?.name || 'غير معروف';
                                        return (
                                            <tr key={t.id} className="border-t hover:bg-gray-50">
                                                <td className="p-3 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                                <td className="p-3 font-bold text-blue-700">{docName}</td>
                                                <td className="p-3">{t.description}</td>
                                                <td className="p-3 text-green-600 font-bold">{t.amount.toLocaleString()}</td>
                                                <td className="p-3 text-center">
                                                    {t.isRegistered ? (
                                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">مسجل</span>
                                                    ) : (
                                                        <button
                                                            onClick={async () => {
                                                                await db.updateTransaction(t.id, { isRegistered: true });
                                                                const updatedTx = await db.getTransactions();
                                                                setTransactions(updatedTx);
                                                            }}
                                                            className="text-[10px] bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded border border-gray-200 transition-colors"
                                                        >
                                                            تسجيل
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {transactions.filter(t => t.type === 'income' && t.entityType === 'doctor').length === 0 && (
                                        <tr><td colSpan={4} className="p-4 text-center text-gray-400">لا توجد تحصيلات مسجلة</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* SUPPLIERS PAYMENT */}
            {activeTab === 'suppliers' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="font-bold mb-4">تسجيل سداد لمورد</h3>
                            <form onSubmit={handleAddSupplierPayment} className="space-y-4">
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">تاريخ المعاملة</label>
                                    <input required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2 border rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">المورد / المعمل</label>
                                    <select required value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full p-2 border rounded-lg">
                                        <option value="">-- اختر المورد --</option>
                                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">المبلغ المدفوع</label>
                                    <input required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2 border rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">بيان / ملاحظات</label>
                                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full p-2 border rounded-lg" placeholder="مثال: باقي حساب فاتورة رقم 5" />
                                </div>
                                <button type="submit" className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-700">تسجيل السداد</button>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                            <h3 className="p-4 font-bold border-b bg-gray-50">سجل سداد الموردين</h3>
                            <table className="w-full text-sm text-right">
                                <thead className="text-gray-500 bg-gray-50"><tr><th className="p-3">التاريخ</th><th className="p-3">المورد</th><th className="p-3">البيان</th><th className="p-3">المبلغ</th><th className="p-3">تسجيل؟</th></tr></thead>
                                <tbody>
                                    {transactions.filter(t => t.type === 'expense' && t.entityType === 'supplier').map(t => {
                                        const supName = suppliers.find(s => s.id === t.entityId)?.name || 'غير معروف';
                                        return (
                                            <tr key={t.id} className="border-t hover:bg-gray-50">
                                                <td className="p-3 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                                <td className="p-3 font-bold text-purple-700">{supName}</td>
                                                <td className="p-3">{t.description}</td>
                                                <td className="p-3 text-red-600 font-bold">{t.amount.toLocaleString()}</td>
                                                <td className="p-3 text-center">
                                                    {t.isRegistered ? (
                                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">مسجل</span>
                                                    ) : (
                                                        <button
                                                            onClick={async () => {
                                                                await db.updateTransaction(t.id, { isRegistered: true });
                                                                const updatedTx = await db.getTransactions();
                                                                setTransactions(updatedTx);
                                                            }}
                                                            className="text-[10px] bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded border border-gray-200 transition-colors"
                                                        >
                                                            تسجيل
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {transactions.filter(t => t.type === 'expense' && t.entityType === 'supplier').length === 0 && (
                                        <tr><td colSpan={4} className="p-4 text-center text-gray-400">لا توجد سدادات مسجلة</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* DESIGNERS PAYMENT */}
            {activeTab === 'designers' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="font-bold mb-4">تسجيل سداد لمصمم</h3>
                            <form onSubmit={handleAddDesignerPayment} className="space-y-4">
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">تاريخ المعاملة</label>
                                    <input required type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="w-full p-2 border rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">المصمم</label>
                                    <select required value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full p-2 border rounded-lg">
                                        <option value="">-- اختر المصمم --</option>
                                        {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">المبلغ المدفوع</label>
                                    <input required type="number" min="0" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-2 border rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">بيان / ملاحظات</label>
                                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full p-2 border rounded-lg" placeholder="مثال: حساب الأسبوع" />
                                </div>
                                <button type="submit" className="w-full bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700">تسجيل السداد</button>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                            <h3 className="p-4 font-bold border-b bg-gray-50">سجل سداد المصممين</h3>
                            <table className="w-full text-sm text-right">
                                <thead className="text-gray-500 bg-gray-50"><tr><th className="p-3">التاريخ</th><th className="p-3">المصمم</th><th className="p-3">البيان</th><th className="p-3">المبلغ</th><th className="p-3">تسجيل؟</th></tr></thead>
                                <tbody>
                                    {transactions.filter(t => t.type === 'expense' && t.entityType === 'designer').map(t => {
                                        const desName = designers.find(d => d.id === t.entityId)?.name || 'غير معروف';
                                        return (
                                            <tr key={t.id} className="border-t hover:bg-gray-50">
                                                <td className="p-3 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                                <td className="p-3 font-bold text-purple-700">{desName}</td>
                                                <td className="p-3">{t.description}</td>
                                                <td className="p-3 text-red-600 font-bold">{t.amount.toLocaleString()}</td>
                                                <td className="p-3 text-center">
                                                    {t.isRegistered ? (
                                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">مسجل</span>
                                                    ) : (
                                                        <button
                                                            onClick={async () => {
                                                                await db.updateTransaction(t.id, { isRegistered: true });
                                                                const updatedTx = await db.getTransactions();
                                                                setTransactions(updatedTx);
                                                            }}
                                                            className="text-[10px] bg-gray-100 hover:bg-blue-600 hover:text-white px-2 py-1 rounded border border-gray-200 transition-colors"
                                                        >
                                                            تسجيل
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {transactions.filter(t => t.type === 'expense' && t.entityType === 'designer').length === 0 && (
                                        <tr><td colSpan={4} className="p-4 text-center text-gray-400">لا توجد سدادات مسجلة</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* SERVICES LIST */}
            {activeTab === 'services' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="font-bold mb-4">{editingService ? 'تعديل خدمة' : 'إضافة خدمة'}</h3>
                            <form ref={serviceFormRef} onSubmit={async (e) => {
                                e.preventDefault();
                                const formData = new FormData(e.currentTarget);
                                const name = formData.get('name') as string;
                                const sellingPrice = Number(formData.get('sellingPrice'));
                                const costPrice = Number(formData.get('costPrice'));
                                const millingPrice = Number(formData.get('millingPrice')) || 0;

                                try {
                                    if (editingService) {
                                        // Update existing service
                                        await db.updateService(editingService.id, { name, sellingPrice, costPrice, millingPrice });
                                        setEditingService(null);
                                    } else {
                                        // Add new service
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
                                    <label className="block text-sm text-gray-600 mb-1">اسم الخدمة</label>
                                    <input name="name" required type="text" defaultValue={editingService?.name || ''} key={editingService?.id || 'new'} className="w-full p-2 border border-gray-200 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">سعر البيع</label>
                                    <input name="sellingPrice" required type="number" defaultValue={editingService?.sellingPrice || ''} key={`sell-${editingService?.id || 'new'}`} className="w-full p-2 border border-gray-200 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">سعر التكلفة</label>
                                    <input name="costPrice" required type="number" defaultValue={editingService?.costPrice || ''} key={`cost-${editingService?.id || 'new'}`} className="w-full p-2 border border-gray-200 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-600 mb-1">سعر الخراطة</label>
                                    <input name="millingPrice" type="number" defaultValue={editingService?.millingPrice || 0} key={`mill-${editingService?.id || 'new'}`} className="w-full p-2 border border-gray-200 rounded-lg" />
                                </div>
                                <div className="flex gap-2">
                                    <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700">
                                        {editingService ? 'تحديث' : 'حفظ الخدمة'}
                                    </button>
                                    {editingService && (
                                        <button type="button" onClick={() => { setEditingService(null); serviceFormRef.current?.reset(); }} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">إلغاء</button>
                                    )}
                                </div>
                            </form>
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                                <h3 className="font-bold">قائمة أسعار الخدمات</h3>
                                <div className="flex gap-2 items-center">
                                    <button
                                        onClick={() => {
                                            exportToExcel(
                                                services.map(s => ({
                                                    'اسم الخدمة': s.name,
                                                    'سعر البيع': s.sellingPrice,
                                                    'التكلفة': s.costPrice,
                                                    'الخراطة': s.millingPrice || 0,
                                                    'الربح': s.sellingPrice - s.costPrice
                                                })),
                                                `services_${new Date().toISOString().split('T')[0]}`,
                                                'الخدمات'
                                            );
                                        }}
                                        className="p-2 text-green-600 hover:bg-green-50 rounded"
                                        title="تصدير Excel"
                                    >
                                        <FileSpreadsheet size={18} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            printTable(
                                                services.map(s => ({
                                                    name: s.name,
                                                    sell: s.sellingPrice,
                                                    cost: s.costPrice,
                                                    mill: s.millingPrice || 0,
                                                    profit: s.sellingPrice - s.costPrice
                                                })),
                                                [
                                                    { key: 'name', label: 'اسم الخدمة' },
                                                    { key: 'sell', label: 'سعر البيع' },
                                                    { key: 'cost', label: 'التكلفة' },
                                                    { key: 'mill', label: 'الخراطة' },
                                                    { key: 'profit', label: 'الربح' }
                                                ],
                                                'قائمة أسعار الخدمات'
                                            );
                                        }}
                                        className="p-2 text-gray-600 hover:bg-gray-50 rounded"
                                        title="طباعة"
                                    >
                                        <Printer size={18} />
                                    </button>
                                    <span className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded">سري للغاية</span>
                                </div>
                            </div>
                            <table className="w-full text-sm text-right">
                                <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                        <th className="p-4">اسم الخدمة</th>
                                        <th className="p-4">سعر البيع</th>
                                        <th className="p-4 text-red-600">التكلفة</th>
                                        <th className="p-4 text-amber-600">الخراطة</th>
                                        <th className="p-4">الربح</th>
                                        <th className="p-4">إجراءات</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {services.map(s => (
                                        <tr key={s.id} className={editingService?.id === s.id ? 'bg-blue-50' : ''}>
                                            <td className="p-4 font-bold">{s.name}</td>
                                            <td className="p-4 text-blue-600 font-bold">{s.sellingPrice}</td>
                                            <td className="p-4 text-red-600 font-bold bg-red-50">{s.costPrice}</td>
                                            <td className="p-4 text-amber-600 font-bold bg-amber-50">{s.millingPrice || 0}</td>
                                            <td className="p-4 text-green-600 font-bold">{s.sellingPrice - s.costPrice}</td>
                                            <td className="p-4 flex gap-2">
                                                <button onClick={() => setEditingService(s)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="تعديل">
                                                    <Edit2 size={16} />
                                                </button>
                                                <button onClick={async () => {
                                                    if (confirm('هل أنت متأكد من حذف هذه الخدمة؟')) {
                                                        await db.deleteService(s.id);
                                                        setServices(services.filter(x => x.id !== s.id));
                                                    }
                                                }} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="حذف">
                                                    <Trash2 size={16} />
                                                </button>
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
