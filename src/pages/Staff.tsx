

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../services/db';
import type { User, Transaction } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { Plus, DollarSign, AlertCircle, Wallet, Truck, Package, Banknote, Users as UsersIcon, MapPin, Trash2, CheckCircle, XCircle } from 'lucide-react';
import clsx from 'clsx';

// Helper: Calculate Commission Rate
const getCommissionRate = (totalSales: number) => {
    if (totalSales > 100000) return 0.03;
    if (totalSales > 25000) return 0.02;
    return 0.01;
};

const expenseCategories = [
    { id: 'work_shipping', label: 'شحن شغل', icon: Truck },      // Work Shipping
    { id: 'transport', label: 'انتقالات', icon: MapPin },       // Transportation
    { id: 'supplies', label: 'مستلزمات', icon: Package },       // Supplies
    { id: 'other', label: 'أخرى', icon: Banknote },             // Other
    { id: 'salaries', label: 'رواتب', icon: UsersIcon },        // Internal for Payouts
];

interface RepresentativeStats {
    user: User;
    totalSales: number;
    baseSalary: number;
    fixedSalary: number;
    variableSalary: number;
    kpiPercent: number;
    commissionRate: number;
    commissionAmount: number;
    approvedExpenses: number; // Pending Payout
    netPayout: number;
    isSalaryPaid?: boolean;
}

export default function Staff() {
    const { user: currentUser } = useAuth();
    const [stats, setStats] = useState<RepresentativeStats[]>([]);
    const [expenses, setExpenses] = useState<Transaction[]>([]);

    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

    // KPI State
    const [kpiMap, setKpiMap] = useState<Record<string, number>>({});

    // Expense Form
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [newExpense, setNewExpense] = useState({ amount: '', description: '', category: '' });

    // Load Data
    const loadData = useCallback(async () => {
        try {
            const [allUsers, allOrders, allTransactions] = await Promise.all([
                db.getUsers(),
                db.getAllOrdersUnpaginated(),
                db.getTransactions()
            ]);

            // Representatives = role='representative' OR (role='admin' AND username !== 'admin')
            // Super Admin (username='admin') is excluded
            const representatives = allUsers.filter(u =>
                u.role === 'representative' ||
                (u.role === 'admin' && u.username !== 'admin')
            );

            // Filter expenses related to staff (reps + admins)
            const staffExpenses = allTransactions.filter(t =>
                t.type === 'expense' &&
                representatives.some(r => r.id === t.entityId)
            );

            setExpenses(staffExpenses);

            const newStats = representatives.map(rep => {
                // Filter Orders by Selected Month for Sales/Commission
                const repOrders = allOrders.filter(o =>
                    o.representativeId === rep.id &&
                    ['Completed', 'Delivered'].includes(o.status) &&
                    o.createdAt.startsWith(selectedMonth) // Simple string match for YYYY-MM
                );

                const totalSales = repOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
                const baseSalary = rep.baseSalary || 0;
                const fixedPart = baseSalary * (2 / 3);

                const kpi = kpiMap[rep.id] ?? 100;
                const variablePart = (baseSalary * (1 / 3)) * (kpi / 100);

                const rate = getCommissionRate(totalSales);
                const commission = totalSales * rate;

                // Pending Expenses (All time, or just this month? Usually all pending need distinct settlement)
                // We keep expenses cumulative as they are irrelevant to the month of Salary
                // Only count APPROVED expenses (awaiting settlement)
                const unpaidExpenses = staffExpenses
                    .filter(e => e.entityId === rep.id && e.isApproved && !e.isRegistered)
                    .reduce((sum, e) => sum + e.amount, 0);

                // Check if Salary is already paid for this month
                // Look for transaction: category='salaries', entityId=rep.id, date startsWith selectedMonth
                const isSalaryPaid = allTransactions.some(t =>
                    t.category === 'salaries' &&
                    t.entityId === rep.id &&
                    t.date.startsWith(selectedMonth)
                );

                return {
                    user: rep,
                    totalSales,
                    baseSalary,
                    fixedSalary: fixedPart,
                    variableSalary: variablePart,
                    kpiPercent: kpi,
                    commissionRate: rate,
                    commissionAmount: commission,
                    approvedExpenses: unpaidExpenses,
                    netPayout: fixedPart + variablePart + commission, // Salary Payout Only
                    isSalaryPaid // New Flag
                };
            });
            setStats(newStats);
        } catch (error) {
            console.error('Error loading staff data:', error);
        } finally {
            // Loading finished
        }
    }, [kpiMap, selectedMonth]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Handlers
    const handleKpiChange = (userId: string, val: string) => {
        const num = Math.min(100, Math.max(0, parseInt(val) || 0));
        setKpiMap(prev => ({ ...prev, [userId]: num }));
    };

    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser) return;

        try {
            await db.addTransaction({
                type: 'expense',
                amount: parseFloat(newExpense.amount),
                description: newExpense.description,
                date: new Date().toISOString().split('T')[0],
                category: newExpense.category || 'other',
                entityId: currentUser.id,
                entityType: 'general',
                isRegistered: false
            });

            setNewExpense({ amount: '', description: '', category: '' });
            setIsExpenseModalOpen(false);
            await loadData();
        } catch (error) {
            console.error("Error adding expense", error);
        }
    };

    // 1. Pay Monthly Salary
    const handlePaySalary = async (stat: RepresentativeStats) => {
        if (!confirm(`هل أنت متأكد من صرف راتب شهر ${selectedMonth} للمندوب ${stat.user.name}؟\nالمبلغ: ${stat.netPayout.toFixed(0)} ج.م`)) return;

        // Or use selectedMonth + '-01'? No, payment date is now.
        // But we want to tag it as belonging to selectedMonth. We can put it in description.

        try {
            await db.addTransaction({
                type: 'expense',
                amount: stat.netPayout,
                category: 'salaries',
                description: `راتب شهر ${selectedMonth} - ${stat.user.name}`,
                date: selectedMonth + '-01', // Force date to be 1st of selected month for easy checking? 
                // Better: Use real date, but check is done by finding *any* salary tx in that month range? 
                // Or we store 'reference_month' in metadata? We don't have metadata column.
                // Let's rely on the record Date being in that month. 
                // Wait, if I pay January salary in February, the transaction date is Feb.
                // But I check `t.date.startsWith(selectedMonth)`. 
                // So I MUST set the transaction date to be within the payroll month to "lock" it.
                // OR I rely on Description parsing. 
                // Let's set the date to the END of the payroll month (or 1st) to ensure it appears in that month's filter.
                // User requirement: "Filter by month... get salary status".
                // If I set date to '2023-10-28' (payment date) but salary is for '2023-09', it won't show as paid in Sept view if I filter by date.
                // TRADEOFF: Set transaction date to the selected month (e.g., 28th of selected month) so it registers as "Paid" for that month.
                entityId: stat.user.id,
                entityType: 'general',
                isRegistered: true
            });

            await loadData();
            alert('تم صرف الراتب بنجاح ✅');
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء صرف الراتب');
        }
    };

    // 2. Settle Expenses
    const handleSettleExpenses = async (stat: RepresentativeStats) => {
        // Only settle APPROVED expenses
        const approvedExpenses = expenses.filter(e => e.entityId === stat.user.id && e.isApproved && !e.isRegistered);
        if (approvedExpenses.length === 0) {
            alert('لا توجد مصاريف معتمدة للتسوية');
            return;
        }
        const totalAmount = approvedExpenses.reduce((sum, e) => sum + e.amount, 0);
        if (!confirm(`هل أنت متأكد من تسوية المصاريف المعتمدة للمندوب ${stat.user.name}؟\nعدد المصاريف: ${approvedExpenses.length}\nالمبلغ الإجمالي: ${totalAmount.toFixed(0)} ج.م`)) return;

        try {
            // Clear entityId to move it out of "staff expenses" and into "general expenses" for accountant to register
            // Append Rep Name to description for attribution
            await Promise.all(approvedExpenses.map(exp =>
                db.updateTransaction(exp.id, {
                    entityId: undefined, // Clear entityId - no longer a "staff" expense
                    description: `${exp.description} - ${stat.user.name}`
                })
            ));

            await loadData();
            alert('تم تسوية المصاريف بنجاح ✅');
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء تسوية المصاريف');
        }
    };

    // 3. Approve Individual Expense
    const handleApproveExpense = async (expense: Transaction) => {
        try {
            await db.updateTransaction(expense.id, { isApproved: true });
            await loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء اعتماد المصروف');
        }
    };

    // 4. Reject (Delete) Expense
    const handleRejectExpense = async (expense: Transaction) => {
        if (!confirm(`هل أنت متأكد من رفض وحذف هذا المصروف؟\n${expense.description} - ${expense.amount} ج.م`)) return;
        try {
            await db.deleteTransaction(expense.id);
            await loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء حذف المصروف');
        }
    };

    // 5. Delete Any Transaction (Admin Only)
    const handleDeleteTransaction = async (tx: Transaction) => {
        if (!confirm(`هل أنت متأكد من حذف هذه العملية المالية؟\n${tx.description} - ${tx.amount} ج.م`)) return;
        try {
            await db.deleteTransaction(tx.id);
            await loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء حذف العملية');
        }
    };

    const isAdminOrAccountant = ['admin', 'accountant'].includes(currentUser?.role || '');
    const isAdmin = currentUser?.role === 'admin';
    const isRep = currentUser?.role === 'representative' || (currentUser?.role === 'admin' && currentUser?.username !== 'admin');

    // Memoize expensive filtering operations
    const pendingExpenses = useMemo(() =>
        expenses.filter(e => !e.isRegistered).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [expenses]
    );

    const myExpenses = useMemo(() =>
        expenses.filter(e => e.entityId === currentUser?.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [expenses, currentUser?.id]
    );

    const myStat = useMemo(() =>
        stats.find(s => s.user.id === currentUser?.id),
        [stats, currentUser?.id]
    );

    if (!currentUser) return null;

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">شئون الموظفين والرواتب</h1>
                    <p className="text-gray-500">إدارة الرواتب، العمولات، والمصاريف</p>
                </div>
                <div className="flex items-center gap-4">
                    {isAdminOrAccountant && (
                        <div className="flex items-center gap-2 bg-white p-2 rounded-lg border shadow-sm">
                            <span className="text-sm text-gray-500 font-bold">شهر:</span>
                            <input
                                type="month"
                                aria-label="اختر الشهر"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="border-none focus:ring-0 text-sm font-bold text-blue-600"
                            />
                        </div>
                    )}
                    {isRep && (
                        <button
                            onClick={() => setIsExpenseModalOpen(true)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
                        >
                            <Plus size={20} />
                            تسجيل مصروف
                        </button>
                    )}
                </div>
            </div>

            {/* Admin/Accountant View */}
            {isAdminOrAccountant && (
                <div className="space-y-6">
                    {/* Stats Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50">
                            <h2 className="font-bold text-gray-700 flex items-center gap-2">
                                <DollarSign size={18} />
                                كشف رواتب المندوبين ({selectedMonth})
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-right">
                                <thead className="bg-gray-50 text-gray-600 text-sm">
                                    <tr>
                                        <th className="p-4">المندوب</th>
                                        <th className="p-4">المبيعات (ش)</th>
                                        <th className="p-4">الأساسي</th>
                                        <th className="p-4">الثابت / المتغير</th>
                                        <th className="p-4">العمولة</th>
                                        <th className="p-4">الراتب المستحق</th>
                                        <th className="p-4">حالة الراتب</th>
                                        <th className="p-4">مصاريف معلقة</th>
                                        <th className="p-4">إجراءات</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {stats.map(stat => (
                                        <tr key={stat.user.id} className="hover:bg-gray-50">
                                            <td className="p-4 font-medium">{stat.user.name}</td>
                                            <td className="p-4 text-gray-500">{stat.totalSales.toLocaleString()}</td>
                                            <td className="p-4 text-gray-500">{stat.baseSalary.toLocaleString()}</td>
                                            <td className="p-4 text-xs">
                                                <div>ث: {stat.fixedSalary.toFixed(0)}</div>
                                                {!stat.isSalaryPaid && (
                                                    <div className="flex items-center gap-1 mt-1">
                                                        <span>م:</span>
                                                        <input
                                                            type="number"
                                                            min="0" max="100"
                                                            value={stat.kpiPercent}
                                                            onChange={(e) => handleKpiChange(stat.user.id, e.target.value)}
                                                            aria-label="نسبة المتغير"
                                                            className="w-12 px-1 py-0.5 border rounded text-center text-xs"
                                                        />
                                                        <span>%</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-green-600">
                                                <div className="flex flex-col text-xs">
                                                    <span className="font-bold">{stat.commissionAmount.toFixed(0)}</span>
                                                    <span className="text-gray-400">{(stat.commissionRate * 100).toFixed(0)}%</span>
                                                </div>
                                            </td>
                                            <td className="p-4 font-bold text-blue-600">
                                                {stat.netPayout.toFixed(0)} ج.م
                                            </td>
                                            <td className="p-4">
                                                {stat.isSalaryPaid ? (
                                                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">مدفوع</span>
                                                ) : (
                                                    <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">غير مدفوع</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-orange-600 font-bold">
                                                {stat.approvedExpenses.toFixed(0)}
                                            </td>
                                            <td className="p-4 flex flex-col gap-2">
                                                {!stat.isSalaryPaid && stat.netPayout > 0 && (
                                                    <button
                                                        onClick={() => handlePaySalary(stat)}
                                                        className="flex items-center justify-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-green-700"
                                                    >
                                                        <Wallet size={14} />
                                                        صرف الراتب
                                                    </button>
                                                )}
                                                {stat.approvedExpenses > 0 && (
                                                    <button
                                                        onClick={() => handleSettleExpenses(stat)}
                                                        className="flex items-center justify-center gap-1 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-orange-600"
                                                    >
                                                        <DollarSign size={14} />
                                                        تسوية المصاريف
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Expenses List */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                        <div className="p-4 border-b border-gray-100 bg-gray-50">
                            <h2 className="font-bold text-gray-700 flex items-center gap-2">
                                <AlertCircle size={18} />
                                سجل المصاريف (المعلقة والمعتمدة)
                            </h2>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {pendingExpenses.length === 0 ? (
                                <p className="p-8 text-center text-gray-400">لا يوجد مصاريف معلقة أو غير مسواة</p>
                            ) : (
                                pendingExpenses.map(expense => {
                                    const cat = expenseCategories.find(c => c.label === expense.category);
                                    const Icon = cat?.icon || Banknote;
                                    const isPending = !expense.isApproved;
                                    const isApproved = expense.isApproved && !expense.isRegistered;

                                    return (
                                        <div key={expense.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                                            <div className="flex items-center gap-4">
                                                <div className={clsx("w-10 h-10 rounded-full flex items-center justify-center", isPending ? "bg-amber-100 text-amber-600" : "bg-green-100 text-green-600")}>
                                                    <Icon size={20} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">{expense.category || 'أخرى'}</span>
                                                    </div>
                                                    <p className="text-sm text-gray-500">{expense.description} • {new Date(expense.date).toLocaleDateString('ar-EG')}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="font-bold text-lg">{expense.amount} ج.م</span>

                                                {/* Status Badge */}
                                                {isPending && (
                                                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-100">في انتظار الموافقة</span>
                                                )}
                                                {isApproved && (
                                                    <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">معتمد - في انتظار التسوية</span>
                                                )}

                                                {/* Action Buttons */}
                                                {isPending && (
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => handleApproveExpense(expense)}
                                                            className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                                                            title="اعتماد المصروف"
                                                        >
                                                            <CheckCircle size={18} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleRejectExpense(expense)}
                                                            className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                                                            title="رفض وحذف المصروف"
                                                        >
                                                            <XCircle size={18} />
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Admin Delete Button for Approved Expenses */}
                                                {isApproved && isAdmin && (
                                                    <button
                                                        onClick={() => handleDeleteTransaction(expense)}
                                                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                                                        title="حذف المصروف"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Representative View */}
            {isRep && (
                <div className="space-y-6">
                    {/* My Stats Cards */}
                    {myStat && (
                        <div key="my-stats" className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                                <p className="text-sm text-gray-500 mb-1">صافي الراتب (الحالي)</p>
                                <p className="text-2xl font-bold text-blue-600">{myStat.netPayout.toFixed(0)} ج.م</p>
                                <p className="text-xs text-blue-400 mt-1">بانتظار الصرف: {myStat.approvedExpenses} ج.م مصاريف</p>
                            </div>
                            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                                <p className="text-sm text-gray-500 mb-1">إجمالي المبيعات</p>
                                <p className="text-2xl font-bold text-gray-900">{myStat.totalSales.toLocaleString()} ج.م</p>
                            </div>
                            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                                <p className="text-sm text-gray-500 mb-1">العمولة الحالية</p>
                                <div className="flex items-baseline gap-2">
                                    <p className="text-2xl font-bold text-green-600">{myStat.commissionAmount.toFixed(0)}</p>
                                    <span className="text-xs text-green-500 bg-green-50 px-2 py-0.5 rounded-full">
                                        {(myStat.commissionRate * 100).toFixed(0)}%
                                    </span>
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                                <p className="text-sm text-gray-500 mb-1">تقييم الأداء (KPI)</p>
                                <p className="text-2xl font-bold text-purple-600">{myStat.kpiPercent}%</p>
                            </div>
                        </div>
                    )}

                    {/* My Expenses List */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h2 className="font-bold text-gray-700">سجل المصاريف</h2>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {myExpenses.map(expense => (
                                <div key={expense.id} className="p-4 flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-medium text-gray-900">{expense.description}</p>
                                            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{expense.category}</span>
                                        </div>
                                        <p className="text-xs text-gray-500">{new Date(expense.date).toLocaleDateString('ar-EG')}</p>
                                    </div>
                                    <div className="text-left">
                                        <p className="font-bold">{expense.amount} ج.م</p>
                                        <span className={clsx(
                                            "text-xs px-2 py-0.5 rounded-full",
                                            expense.isRegistered ? "bg-blue-100 text-blue-700" :
                                                "bg-green-100 text-green-700"
                                        )}>
                                            {expense.isRegistered ? 'تم الصرف (Settled)' : 'بانتظار الصرف'}
                                        </span>
                                    </div>
                                </div>
                            ))
                            }
                        </div>
                    </div>
                </div>
            )}

            {/* Add Expense Modal */}
            {isExpenseModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold mb-4">تسجيل مصروف جديد</h2>
                        <form onSubmit={handleAddExpense} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">نوع المصروف</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {expenseCategories.filter(c => c.id !== 'salaries').map(cat => (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            onClick={() => setNewExpense({ ...newExpense, category: cat.label })}
                                            className={clsx(
                                                "p-2 text-xs border rounded-lg flex flex-col items-center gap-1 transition-colors",
                                                newExpense.category === cat.label ? "bg-blue-50 border-blue-500 text-blue-700 font-bold" : "hover:bg-gray-50 bg-white"
                                            )}
                                        >
                                            <cat.icon size={16} />
                                            <span>{cat.label}</span>
                                        </button>
                                    ))}
                                </div>
                                {!newExpense.category && <p className="text-xs text-red-500 mt-1">يرجى اختيار النوع</p>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ</label>
                                <input
                                    type="number"
                                    required
                                    min="0"
                                    value={newExpense.amount}
                                    onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="0.00"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">الوصف</label>
                                <textarea
                                    required
                                    value={newExpense.description}
                                    onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                    rows={3}
                                    placeholder="تفاصيل المصروف..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsExpenseModalOpen(false)}
                                    className="flex-1 py-2 text-gray-600 hover:bg-gray-50 rounded-lg border"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                                >
                                    حفظ
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
