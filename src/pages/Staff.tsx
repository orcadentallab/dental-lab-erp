

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../services/db';
import type { User, Transaction } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { Plus, DollarSign, AlertCircle, Wallet, Truck, Package, Banknote, Users as UsersIcon, Coffee, Trash2, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';

// Helper: Calculate Commission Rate
const getCommissionRate = (totalSales: number) => {
    if (totalSales > 100000) return 0.03;
    if (totalSales > 25000) return 0.02;
    return 0.01;
};

const expenseCategories = [
    { id: 'shipping', label: 'شحن وتوصيل', icon: Truck },
    { id: 'meetings', label: 'اجتماعات ونثريات', icon: Coffee },
    { id: 'material', label: 'خامات ومستهلكات', icon: Package },
    { id: 'other', label: 'مصروفات أخرى', icon: Banknote },
    { id: 'bonus', label: 'منحة/مكافأة', icon: DollarSign },
    { id: 'deduction', label: 'خصم/جزاء', icon: AlertCircle },
    { id: 'salaries', label: 'مرتبات وأجور', icon: UsersIcon },
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
    totalBonuses: number;
    totalDeductions: number;
    netPayout: number;
    isSalaryPaid?: boolean;
}

export default function Staff() {
    const { user: currentUser } = useAuth();
    const [stats, setStats] = useState<RepresentativeStats[]>([]);
    const [expenses, setExpenses] = useState<Transaction[]>([]);
    const [expandedReps, setExpandedReps] = useState<Record<string, boolean>>({});

    const toggleRepDetails = (repId: string) => setExpandedReps(prev => ({ ...prev, [repId]: !prev[repId] }));

    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

    // KPI State
    const [kpiMap, setKpiMap] = useState<Record<string, string | number>>({});

    // Commission Override State
    const [commissionMap, setCommissionMap] = useState<Record<string, string | number>>({});

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
                const fixedPart = Math.round(baseSalary * (2 / 3));

                const kpiVal = kpiMap[rep.id] ?? 100;
                const kpi = typeof kpiVal === 'string' ? (parseInt(kpiVal) || 0) : kpiVal;
                const variablePart = Math.round((baseSalary * (1 / 3)) * (kpi / 100));

                const rate = getCommissionRate(totalSales);
                const calculatedCommission = Math.round(totalSales * rate);
                let commission = calculatedCommission;
                const commissionVal = commissionMap[rep.id];
                if (commissionVal !== undefined && commissionVal !== '') {
                    const parsed = typeof commissionVal === 'string' ? parseFloat(commissionVal) : commissionVal;
                    if (!isNaN(parsed)) commission = parsed;
                }

                // Pending Expenses (All time, or just this month? Usually all pending need distinct settlement)
                // We keep expenses cumulative as they are irrelevant to the month of Salary
                // Only count APPROVED expenses (awaiting settlement)
                const unpaidExpenses = staffExpenses
                    .filter(e => e.entityId === rep.id && e.status === 'approved' && !e.isRegistered && !['bonus', 'deduction'].includes(e.category));

                const approvedExpensesAmount = unpaidExpenses.reduce((sum, e) => sum + e.amount, 0);

                // Bonuses and Deductions for THIS MONTH
                const monthlyAdjustments = staffExpenses.filter(t =>
                    t.entityId === rep.id &&
                    t.date.startsWith(selectedMonth)
                );

                const totalBonuses = monthlyAdjustments
                    .filter(t => t.category === 'bonus')
                    .reduce((sum, t) => sum + t.amount, 0);

                const totalDeductions = monthlyAdjustments
                    .filter(t => t.category === 'deduction')
                    .reduce((sum, t) => sum + t.amount, 0);

                // Check if Salary is already paid for this month
                // Check by description containing "ratib shahr YYYY-MM"
                const isSalaryPaid = allTransactions.some(t =>
                    t.entityId === rep.id &&
                    t.description &&
                    t.description.includes(`راتب شهر ${selectedMonth}`)
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
                    approvedExpenses: approvedExpensesAmount,
                    totalBonuses,
                    totalDeductions,
                    netPayout: Math.round(fixedPart + variablePart + commission + totalBonuses - totalDeductions), // Salary Payout Only
                    isSalaryPaid // New Flag
                };
            });
            setStats(newStats);
        } catch (error) {
            console.error('Error loading staff data:', error);
        } finally {
            // Loading finished
        }
    }, [kpiMap, commissionMap, selectedMonth]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Handlers
    const handleKpiChange = (userId: string, val: string) => {
        setKpiMap(prev => ({ ...prev, [userId]: val }));
    };

    const handleKpiBlur = (userId: string, val: string) => {
        const num = Math.min(100, Math.max(0, parseInt(val) || 0));
        setKpiMap(prev => ({ ...prev, [userId]: num }));
    };

    const handleCommissionChange = (userId: string, val: string) => {
        setCommissionMap(prev => ({ ...prev, [userId]: val }));
    };

    const handleCommissionBlur = (userId: string, val: string) => {
        if (val === '') {
            setCommissionMap(prev => {
                const next = { ...prev };
                delete next[userId];
                return next;
            });
        } else {
            const num = parseFloat(val);
            if (!isNaN(num)) {
                setCommissionMap(prev => ({ ...prev, [userId]: num }));
            } else {
                setCommissionMap(prev => {
                    const next = { ...prev };
                    delete next[userId];
                    return next;
                });
            }
        }
    };

    // Adjustment Modal
    const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
    const [selectedRepForAdjustment, setSelectedRepForAdjustment] = useState<string | null>(null);
    const [adjustmentType, setAdjustmentType] = useState<'bonus' | 'deduction'>('bonus');

    const handleAddAdjustment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRepForAdjustment) return;

        try {
            await db.addTransaction({
                type: 'expense',
                amount: parseFloat(newExpense.amount),
                description: newExpense.description, // e.g. "Bonus for excellence"
                date: selectedMonth + '-01', // Keep adjustments in the month they belong to? Or today?
                // User said "whether salary or bonus... put in 'meratabat'".
                // But for adjustments, let's keep them as markers in the month.
                // The User primarily cares about the FINAL payout date.
                category: adjustmentType,
                entityId: selectedRepForAdjustment,
                entityType: 'general',
                isRegistered: false, // Not registered yet, will be "settled" upon salary payment
                effectiveDate: selectedMonth + '-01'
            });

            setNewExpense({ amount: '', description: '', category: '' });
            setIsAdjustmentModalOpen(false);
            setSelectedRepForAdjustment(null);
            await loadData();
        } catch (error) {
            console.error("Error adding adjustment", error);
            alert('حدث خطأ');
        }
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
                category: newExpense.category || 'مصروفات أخرى',
                entityId: currentUser.id,
                entityType: 'representative',
                isRegistered: false,
                status: 'pending',
                effectiveDate: selectedMonth + '-01'
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

        try {
            // Get all adjustments for this month to delete them (prevent double counting)
            // We need to fetch fresh transactions to be sure
            const allTransactions = await db.getTransactions();
            const monthlyAdjustments = allTransactions.filter(t =>
                t.type === 'expense' &&
                t.entityId === stat.user.id &&
                t.date.startsWith(selectedMonth) &&
                ['bonus', 'deduction'].includes(t.category)
            );

            // Construct detailed description from adjustments
            const adjustmentDetails = monthlyAdjustments.map(t =>
                `${t.category === 'bonus' ? 'منحة' : 'خصم'} (${t.description}: ${t.amount})`
            ).join(' - ');

            const adjustmentsDesc = adjustmentDetails ? ` [تفاصيل: ${adjustmentDetails}]` : '';

            await db.addTransaction({
                type: 'expense',
                amount: stat.netPayout,
                category: 'مرتبات وأجور', // Correct Category Label
                description: `راتب شهر ${selectedMonth} - ${stat.user.name} (أساسي: ${stat.baseSalary} - عمولة: ${stat.commissionAmount.toFixed(0)} - إجمالي منح: ${stat.totalBonuses} - إجمالي خصم: ${stat.totalDeductions})${adjustmentsDesc}`,
                date: new Date().toISOString().split('T')[0], // Pay Date = Today
                entityId: stat.user.id,
                entityType: 'general',
                isRegistered: true,
                effectiveDate: selectedMonth + '-01'
            });

            // Delete the individual adjustment transactions so they don't count twice
            if (monthlyAdjustments.length > 0) {
                await Promise.all(monthlyAdjustments.map(t => db.deleteTransaction(t.id)));
            }

            await loadData();
            alert('تم صرف الراتب بنجاح ✅');
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء صرف الراتب');
        }
    };

    // 2. Settle Expenses
    const handleSettleExpenses = async (stat: RepresentativeStats) => {
        // Fix: catch both status='approved' and legacy isApproved=true, skip already-settled
        const approvedExpenses = expenses.filter(e =>
            e.entityId === stat.user.id &&
            (e.status === 'approved' || (e.isApproved && e.status !== 'settled')) &&
            !e.isRegistered &&
            !['bonus', 'deduction'].includes(e.category)
        );
        if (approvedExpenses.length === 0) {
            alert('لا توجد مصاريف معتمدة للتسوية');
            return;
        }
        const totalAmount = approvedExpenses.reduce((sum, e) => sum + e.amount, 0);

        const settledAmountStr = prompt(
            `المبلغ الإجمالي للمصاريف: ${totalAmount.toFixed(0)} ج.م\nأدخل المبلغ النهائي لتسوية كل هذه المصاريف معاً (يمكنك كتابة رقم أصغر لتسوية مجمعة):`,
            totalAmount.toFixed(0)
        );

        if (settledAmountStr === null) return;

        const settledAmount = parseFloat(settledAmountStr);
        if (isNaN(settledAmount) || settledAmount < 0) {
            alert('مبلغ غير صحيح');
            return;
        }

        if (settledAmount !== totalAmount) {
            if (!confirm(`هل أنت متأكد من تسوية المصاريف المعتمدة للمندوب ${stat.user.name} بمبلغ ${settledAmount} ج.م بدلاً من ${totalAmount.toFixed(0)} ج.م؟`)) return;
        } else {
            if (!confirm(`هل أنت متأكد من تسوية المصاريف المعتمدة للمندوب ${stat.user.name} بمبلغ ${totalAmount.toFixed(0)} ج.م؟`)) return;
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const combinedDescription = approvedExpenses.map(e => `${e.description} (${e.amount} ج.م)`).join('، ');

            // Always mark ALL individual expenses as 'settled' — they leave pending but stay as audit history
            await Promise.all(approvedExpenses.map(exp => {
                const settledDesc = `${exp.description} (تمت التسوية بتاريخ ${today} - إجمالي: ${settledAmount} ج.م)`;
                return db.updateTransaction(exp.id, {
                    status: 'settled',
                    description: settledDesc.slice(0, 500)
                });
            }));

            // Always add one consolidated general expense for accountant to register
            const fullDesc = `مصاريف شحن المندوب ${stat.user.name} لشهر ${selectedMonth} - التفاصيل: ${combinedDescription}`;
            await db.addTransaction({
                type: 'expense',
                amount: settledAmount,
                category: 'شحن وتوصيل',
                description: fullDesc.slice(0, 500),
                date: today,
                entityId: undefined,
                entityType: 'general',
                isRegistered: false,
                status: 'approved',
                effectiveDate: selectedMonth + '-01'
            });

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
            await db.updateTransaction(expense.id, { status: 'approved', isApproved: true });
            await loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء اعتماد المصروف');
        }
    };

    // 4. Reject (Delete) Expense
    const handleRejectExpense = async (expense: Transaction) => {
        if (!confirm(`هل أنت متأكد من رفض هذا المصروف؟\n${expense.description} - ${expense.amount} ج.م`)) return;
        try {
            await db.updateTransaction(expense.id, { status: 'rejected', isApproved: false });
            await loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء رفض المصروف');
        }
    };

    // Appove All Expenses for a rep
    const handleApproveAllExpenses = async (repExpenses: Transaction[]) => {
        if (!confirm('هل أنت متأكد من اعتماد جميع المصاريف المعلقة لهذا المندوب؟')) return;
        try {
            const pending = repExpenses.filter(e => e.status === 'pending' || (!e.status && !e.isApproved));
            await Promise.all(pending.map(e => db.updateTransaction(e.id, { status: 'approved', isApproved: true })));
            await loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء اعتماد المصاريف');
        }
    };

    // Reject All Expenses for a rep
    const handleRejectAllExpenses = async (repExpenses: Transaction[]) => {
        if (!confirm('هل أنت متأكد من رفض وتجاهل جميع المصاريف المعلقة لهذا المندوب؟')) return;
        try {
            const pending = repExpenses.filter(e => e.status === 'pending' || (!e.status && !e.isApproved));
            await Promise.all(pending.map(e => db.updateTransaction(e.id, { status: 'rejected', isApproved: false })));
            await loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء رفض المصاريف');
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
        expenses.filter(e => !e.isRegistered && e.status !== 'settled' && !['bonus', 'deduction'].includes(e.category)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [expenses]
    );

    const settledExpenses = useMemo(() =>
        expenses.filter(e => e.status === 'settled' && !['bonus', 'deduction'].includes(e.category)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [expenses]
    );

    const [expenseTab, setExpenseTab] = useState<'pending' | 'settled'>('pending');

    const myExpenses = useMemo(() =>
        expenses.filter(e => e.entityId === currentUser?.id && !['bonus', 'deduction'].includes(e.category)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
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
                            {/* eslint-disable-next-line -- month type not supported in all browsers */}
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
                                        <th className="p-4">المنح / الخصومات</th>
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
                                                            value={kpiMap[stat.user.id] !== undefined ? kpiMap[stat.user.id] : stat.kpiPercent}
                                                            onChange={(e) => handleKpiChange(stat.user.id, e.target.value)}
                                                            onBlur={(e) => handleKpiBlur(stat.user.id, e.target.value)}
                                                            aria-label="نسبة المتغير"
                                                            className="w-12 px-1 py-0.5 border rounded text-center text-xs"
                                                        />
                                                        <span>%</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-xs">
                                                <div className="flex flex-col gap-1">
                                                    <div className="text-green-600">+{stat.totalBonuses}</div>
                                                    <div className="text-red-500">-{stat.totalDeductions}</div>
                                                    {!stat.isSalaryPaid && (
                                                        <button
                                                            onClick={() => {
                                                                setSelectedRepForAdjustment(stat.user.id);
                                                                setIsAdjustmentModalOpen(true);
                                                                setNewExpense({ amount: '', description: '', category: '' });
                                                            }}
                                                            className="text-blue-500 text-[10px] hover:underline"
                                                        >
                                                            + إضافة
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 text-green-600">
                                                <div className="flex flex-col text-xs">
                                                    {!stat.isSalaryPaid ? (
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                aria-label="Commission amount"
                                                                value={commissionMap[stat.user.id] !== undefined ? commissionMap[stat.user.id] : stat.commissionAmount.toFixed(0)}
                                                                onChange={(e) => handleCommissionChange(stat.user.id, e.target.value)}
                                                                onBlur={(e) => handleCommissionBlur(stat.user.id, e.target.value)}
                                                                className="w-16 px-1 py-0.5 border rounded text-center text-xs text-green-600 font-bold"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <span className="font-bold">{stat.commissionAmount.toFixed(0)}</span>
                                                    )}
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

                    {/* Expenses Panel — Tabs */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                        {/* Tab Header */}
                        <div className="flex border-b border-gray-100">
                            <button
                                onClick={() => setExpenseTab('pending')}
                                className={clsx(
                                    "flex-1 p-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors",
                                    expenseTab === 'pending' ? "text-blue-600 border-b-2 border-blue-500 bg-blue-50/50" : "text-gray-500 hover:bg-gray-50"
                                )}
                            >
                                <AlertCircle size={16} />
                                المصاريف المعلقة والمعتمدة
                                {pendingExpenses.length > 0 && (
                                    <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs">{pendingExpenses.length}</span>
                                )}
                            </button>
                            {isAdmin && (
                                <button
                                    onClick={() => setExpenseTab('settled')}
                                    className={clsx(
                                        "flex-1 p-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors",
                                        expenseTab === 'settled' ? "text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50/50" : "text-gray-500 hover:bg-gray-50"
                                    )}
                                >
                                    <CheckCircle size={16} />
                                    السجل التاريخي (متسوية)
                                    {settledExpenses.length > 0 && (
                                        <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs">{settledExpenses.length}</span>
                                    )}
                                </button>
                            )}
                        </div>

                        {/* Pending Tab */}
                        {expenseTab === 'pending' && (
                            <div className="divide-y divide-gray-100">
                                {pendingExpenses.length === 0 ? (
                                    <p className="p-8 text-center text-gray-400">لا يوجد مصاريف معلقة أو غير مسواة</p>
                                ) : (
                                    Object.entries(pendingExpenses.reduce<Record<string, typeof pendingExpenses>>((acc, expense) => {
                                        const repId = expense.entityId || 'unknown';
                                        if (!acc[repId]) acc[repId] = [];
                                        acc[repId].push(expense);
                                        return acc;
                                    }, {})).map(([repId, repExpenses]) => {
                                        const repName = stats.find(s => s.user.id === repId)?.user.name || 'مندوب غير معروف';
                                        const totalRepExpenses = repExpenses.reduce((sum, e) => sum + e.amount, 0);
                                        const pendingRepExpenses = repExpenses.filter(e => e.status === 'pending' || (!e.status && !e.isApproved));
                                        const isExpanded = !!expandedReps[repId];

                                        return (
                                            <div key={repId} className="border-b last:border-0">
                                                <div
                                                    className="bg-gray-50/80 px-4 py-3 text-sm font-bold text-gray-700 flex items-center justify-between cursor-pointer hover:bg-gray-100"
                                                    onClick={() => toggleRepDetails(repId)}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <UsersIcon size={16} className="text-blue-500" />
                                                        {repName}
                                                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs ml-2">
                                                            الإجمالي: {totalRepExpenses} ج.م
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        {pendingRepExpenses.length > 0 && isAdminOrAccountant && (
                                                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                                <button
                                                                    onClick={() => handleApproveAllExpenses(pendingRepExpenses)}
                                                                    className="text-xs flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200"
                                                                >
                                                                    <CheckCircle size={14} /> قبول الكل
                                                                </button>
                                                                <button
                                                                    onClick={() => handleRejectAllExpenses(pendingRepExpenses)}
                                                                    className="text-xs flex items-center gap-1 bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200"
                                                                >
                                                                    <XCircle size={14} /> رفض الكل
                                                                </button>
                                                            </div>
                                                        )}
                                                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                                    </div>
                                                </div>
                                                {isExpanded && (
                                                    <div className="divide-y divide-gray-100 bg-white">
                                                        {repExpenses.map(expense => {
                                                            const cat = expenseCategories.find(c => c.label === expense.category);
                                                            const Icon = cat?.icon || Banknote;
                                                            const isPending = expense.status === 'pending' || (!expense.status && !expense.isApproved);
                                                            const isApproved = expense.status === 'approved' || (!expense.status && expense.isApproved && !expense.isRegistered);
                                                            const isRejected = expense.status === 'rejected';

                                                            return (
                                                                <div key={expense.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                                                                    <div className="flex items-center gap-4">
                                                                        <div className={clsx(
                                                                            "w-10 h-10 rounded-full flex items-center justify-center",
                                                                            isPending ? "bg-amber-100 text-amber-600" :
                                                                                isRejected ? "bg-red-100 text-red-600" :
                                                                                    "bg-green-100 text-green-600"
                                                                        )}>
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
                                                                        {isPending && (
                                                                            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-100">في انتظار الموافقة</span>
                                                                        )}
                                                                        {isApproved && (
                                                                            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">معتمد - في انتظار التسوية</span>
                                                                        )}
                                                                        {isRejected && (
                                                                            <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100">مرفوض</span>
                                                                        )}
                                                                        {isPending && (
                                                                            <div className="flex items-center gap-1">
                                                                                <button onClick={() => handleApproveExpense(expense)} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="اعتماد المصروف"><CheckCircle size={18} /></button>
                                                                                <button onClick={() => handleRejectExpense(expense)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="رفض المصروف"><XCircle size={18} /></button>
                                                                            </div>
                                                                        )}
                                                                        {(isApproved || isRejected) && isAdmin && (
                                                                            <button onClick={() => handleDeleteTransaction(expense)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="حذف المصروف"><Trash2 size={18} /></button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}

                        {/* Settled History Tab — Admin Only */}
                        {expenseTab === 'settled' && isAdmin && (
                            <div className="divide-y divide-gray-100">
                                {settledExpenses.length === 0 ? (
                                    <p className="p-8 text-center text-gray-400">لا توجد مصاريف مسواة بعد</p>
                                ) : (
                                    Object.entries(settledExpenses.reduce<Record<string, typeof settledExpenses>>((acc, expense) => {
                                        const repId = expense.entityId || 'unknown';
                                        if (!acc[repId]) acc[repId] = [];
                                        acc[repId].push(expense);
                                        return acc;
                                    }, {})).map(([repId, repExpenses]) => {
                                        const repName = stats.find(s => s.user.id === repId)?.user.name || 'مندوب غير معروف';
                                        const totalSettled = repExpenses.reduce((sum, e) => sum + e.amount, 0);
                                        const isExpanded = !!expandedReps[`settled_${repId}`];
                                        return (
                                            <div key={repId} className="border-b last:border-0">
                                                <div
                                                    className="bg-indigo-50/60 px-4 py-3 text-sm font-bold text-indigo-800 flex items-center justify-between cursor-pointer hover:bg-indigo-50"
                                                    onClick={() => toggleRepDetails(`settled_${repId}`)}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <UsersIcon size={16} className="text-indigo-500" />
                                                        {repName}
                                                        <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs ml-2">
                                                            إجمالي متسوى: {totalSettled} ج.م
                                                        </span>
                                                    </div>
                                                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                                </div>
                                                {isExpanded && (
                                                    <div className="divide-y divide-gray-100 bg-white">
                                                        {repExpenses.map(expense => (
                                                            <div key={expense.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                                                                <div>
                                                                    <p className="text-sm font-medium text-gray-700">{expense.description}</p>
                                                                    <p className="text-xs text-gray-400">{new Date(expense.date).toLocaleDateString('ar-EG')} • {expense.category}</p>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <span className="font-bold text-gray-700">{expense.amount} ج.م</span>
                                                                    <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100">تمت التسوية</span>
                                                                    {isAdmin && (
                                                                        <button onClick={() => handleDeleteTransaction(expense)} className="p-1.5 text-red-400 hover:bg-red-50 rounded" title="حذف"><Trash2 size={16} /></button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Representative View */}
            {isRep && (
                <div className="space-y-6">
                    {/* My Stats Cards */}
                    {myStat && (
                        <div key="my-stats" className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                                <p className="text-sm text-gray-500 mb-1">الراتب الأساسي (الثابت)</p>
                                <p className="text-2xl font-bold text-blue-600">{myStat.baseSalary.toLocaleString()} ج.م</p>
                            </div>
                            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                                <p className="text-sm text-gray-500 mb-1">إجمالي المبيعات</p>
                                <p className="text-2xl font-bold text-gray-900">{myStat.totalSales.toLocaleString()} ج.م</p>
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
                                                expense.status === 'rejected' ? "bg-red-100 text-red-700" :
                                                    expense.status === 'settled' ? "bg-indigo-100 text-indigo-700" :
                                                        expense.status === 'approved' || expense.isApproved ? "bg-green-100 text-green-700" :
                                                            "bg-amber-100 text-amber-700"
                                        )}>
                                            {expense.isRegistered ? 'تم الصرف (Settled)' :
                                                expense.status === 'rejected' ? 'مرفوض' :
                                                    expense.status === 'settled' ? 'تمت التسوية إجمالياً' :
                                                        expense.status === 'approved' || expense.isApproved ? 'بانتظار الصرف' : 'قيد المراجعة'}
                                        </span>
                                    </div>
                                </div>
                            ))
                            }
                        </div>
                    </div>
                </div>
            )}

            {/* Add Adjustment Modal */}
            {isAdjustmentModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold mb-4">إضافة تعديل على الراتب</h2>
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setAdjustmentType('bonus')}
                                className={clsx("flex-1 py-2 rounded-lg font-bold transition-colors", adjustmentType === 'bonus' ? "bg-green-100 text-green-700 ring-2 ring-green-500" : "bg-gray-100 text-gray-600")}
                            >
                                <DollarSign size={16} className="inline mr-1" /> منحة / مكافأة
                            </button>
                            <button
                                onClick={() => setAdjustmentType('deduction')}
                                className={clsx("flex-1 py-2 rounded-lg font-bold transition-colors", adjustmentType === 'deduction' ? "bg-red-100 text-red-700 ring-2 ring-red-500" : "bg-gray-100 text-gray-600")}
                            >
                                <AlertCircle size={16} className="inline mr-1" /> خصم / جزاء
                            </button>
                        </div>
                        <form onSubmit={handleAddAdjustment} className="space-y-4">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">السبب</label>
                                <textarea
                                    required
                                    value={newExpense.description}
                                    onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                    rows={3}
                                    placeholder="سبب المنحة أو الخصم..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAdjustmentModalOpen(false)}
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
