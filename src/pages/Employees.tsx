import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, type User, type EmployeeAdvance, type EmployeeCustody, type EmployeeCommission, type Transaction } from '../services/db';
import { financeService, type Cashbox } from '../services/financeService';
import { getEmployeeFinanceStats, type EmployeeFinanceStats } from '../utils/employeeFinance';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
    Plus,
    Search,
    Users as UsersIcon,
    DollarSign,
    Wallet,
    Briefcase,
    AlertTriangle,
    Filter,
    ChevronRight,
    UserPlus,
    CheckCircle,
    XCircle
} from 'lucide-react';
import clsx from 'clsx';
import { ResponsiveTable } from '../components/ui/ResponsiveTable';

export default function Employees() {
    const { user: currentUser } = useAuth();
    const { success: toastSuccess, error: toastError } = useToast();
    const navigate = useNavigate();

    // Data State
    const [users, setUsers] = useState<User[]>([]);
    const [advances, setAdvances] = useState<EmployeeAdvance[]>([]);
    const [custodies, setCustodies] = useState<EmployeeCustody[]>([]);
    const [commissions, setCommissions] = useState<EmployeeCommission[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
    const [selectedCashboxId, setSelectedCashboxId] = useState('');
    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('active');
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

    // Expense Registration State
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [newExpense, setNewExpense] = useState({
        amount: '',
        category: 'شحن وتوصيل',
        description: '',
        date: new Date().toISOString().split('T')[0]
    });

    // Ref to prevent month resetting on updates
    const hasSetDefaultMonth = useRef(false);

    // Pay All Salaries Confirm Modal
    const [showPayConfirmModal, setShowPayConfirmModal] = useState(false);
    const [payConfirmData, setPayConfirmData] = useState<{ user: User; stats: EmployeeFinanceStats }[]>([]);


    // Add Employee Modal
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newEmp, setNewEmp] = useState<{
        name: string;
        username: string;
        email: string;
        password: string;
        baseSalary: string;
        employeeType: 'sales_rep' | 'accountant' | 'admin' | 'other';
    }>({
        name: '',
        username: '',
        email: '',
        password: '',
        baseSalary: '',
        employeeType: 'sales_rep',
    });

    const loadData = useCallback(async () => {
        try {
            const [allUsers, allAdvances, allCustodies, allCommissions, allTransactions, allCashboxes] = await Promise.all([
                db.getUsers(),
                db.getEmployeeAdvances(),
                db.getEmployeeCustodies(),
                db.getEmployeeCommissions(),
                db.getTransactions(),
                financeService.getCashboxes()
            ]);

            setUsers(allUsers);
            setAdvances(allAdvances);
            setCustodies(allCustodies);
            setCommissions(allCommissions);
            setTransactions(allTransactions);
            setCashboxes(allCashboxes);
        } catch (error) {
            console.error('Error loading employees data:', error);
            toastError('حدث خطأ أثناء تحميل البيانات');
        }
    }, [toastError]);

    useEffect(() => {
        if (currentUser && currentUser.role === 'representative') {
            navigate(`/employees/${currentUser.id}`, { replace: true });
            return;
        }
        loadData();
    }, [loadData, currentUser, navigate]);

    // Helper to get previous month string (YYYY-MM)
    const getPreviousMonthStr = useCallback(() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d.toISOString().slice(0, 7);
    }, []);

    // Helper to get current month string (YYYY-MM)
    const getCurrentMonthStr = useCallback(() => {
        return new Date().toISOString().slice(0, 7);
    }, []);

    // Helper to check if any employee has unpaid salaries in a month
    const hasUnpaidSalariesInMonth = useCallback((month: string, allUsers: User[], allTransactions: Transaction[]) => {
        const activeEmployees = allUsers.filter(user => {
            if (user.username === 'admin') return false;
            if (user.role === 'lab' || user.role === 'doctor') return false;
            if (user.isActive === false) return false;
            if (user.customPermissions?.showAsEmployee === false) return false;
            if (user.customPermissions?.showAsEmployee === true) return true;
            // Any user with a registered baseSalary > 0 is treated as an employee by default
            if (user.baseSalary && user.baseSalary > 0) return true;
            return (
                ['representative', 'accountant'].includes(user.role) ||
                ['sales_rep', 'accountant'].includes(user.employeeType || '')
            );
        });

        return activeEmployees.some(user => {
            const salaryPaid = allTransactions.some(t =>
                t.entityId === user.id &&
                t.category === 'مرتبات وأجور' &&
                (
                    t.effectiveDate
                        ? t.effectiveDate.startsWith(month)   // ✅ financial month first
                        : t.date.startsWith(month)            // fallback
                )
            );
            return !salaryPaid;
        });
    }, []);

    // Auto-select Month Effect
    useEffect(() => {
        if (users.length > 0 && transactions.length > 0 && !hasSetDefaultMonth.current) {
            const prevMonth = getPreviousMonthStr();
            if (hasUnpaidSalariesInMonth(prevMonth, users, transactions)) {
                setSelectedMonth(prevMonth);
            } else {
                setSelectedMonth(getCurrentMonthStr());
            }
            hasSetDefaultMonth.current = true;
        }
    }, [users, transactions, getPreviousMonthStr, getCurrentMonthStr, hasUnpaidSalariesInMonth]);

    // Representative Expenses Review State
    const [expandedReps, setExpandedReps] = useState<Record<string, boolean>>({});

    const toggleRepDetails = (repId: string) => {
        setExpandedReps(prev => ({ ...prev, [repId]: !prev[repId] }));
    };

    const getCashboxForCashOut = (label: string) => {
        if (cashboxes.length === 0) return '';
        if (selectedCashboxId) return selectedCashboxId;
        const options = cashboxes.map((box, index) => `${index + 1}. ${box.name}`).join('\n');
        const answer = prompt(`${label}\nاختر رقم الصندوق:\n${options}`);
        if (!answer) return '';
        const index = Number(answer) - 1;
        return cashboxes[index]?.id || '';
    };

    const addTransferFeeIfNeeded = async (transaction: Transaction, cashboxId: string, effectiveDate?: string) => {
        const cashbox = cashboxes.find(box => box.id === cashboxId);
        const fee = financeService.calculateCashboxFee(cashbox, transaction.amount);
        if (!cashbox?.feeEnabled || fee <= 0) return;
        await db.addTransaction({
            type: 'expense',
            amount: fee,
            category: 'transfer_fee',
            description: `مصاريف بنك/محفظة - ${transaction.description}`.slice(0, 500),
            date: transaction.date,
            effectiveDate,
            entityType: 'general',
            cashboxId,
            linkedTransactionId: transaction.id,
            isSystemGeneratedFee: true,
            isRegistered: true,
            status: 'approved'
        });
    };

    // Calculate aggregated stats
    // A user is treated as an employee when:
    //   a) They have showAsEmployee = true in customPermissions (explicit opt-in), OR
    //   b) They have a recognized employeeType set (legacy / new employees)
    // They are excluded when showAsEmployee is explicitly false.
    const employeesWithStats = useMemo(() => {
        const filteredUsers = users.filter(user => {
            if (user.username === 'admin') return false;
            if (user.role === 'lab' || user.role === 'doctor') return false;
            // Explicit exclusion wins over everything
            if (user.customPermissions?.showAsEmployee === false) return false;
            // Explicit inclusion
            if (user.customPermissions?.showAsEmployee === true) return true;
            // Any user with a registered baseSalary > 0 is treated as an employee by default
            if (user.baseSalary && user.baseSalary > 0) return true;
            // Legacy: infer from role / employeeType
            return (
                ['representative', 'accountant'].includes(user.role) ||
                ['sales_rep', 'accountant'].includes(user.employeeType || '')
            );
        });

        return filteredUsers.map(user => {
            const stats = getEmployeeFinanceStats(
                user,
                selectedMonth,
                advances,
                custodies,
                commissions,
                transactions
            );
            return {
                user,
                stats
            };
        });
    }, [users, selectedMonth, advances, custodies, commissions, transactions]);

    // Pending Representative Expenses
    const pendingExpenses = useMemo(() => {
        const reps = users.filter(u =>
            u.username !== 'admin' &&
            (u.role === 'representative' || u.employeeType === 'sales_rep' || u.role === 'admin')
        );

        return transactions.filter(t =>
            t.type === 'expense' &&
            !t.isRegistered &&
            t.status !== 'settled' &&
            t.status !== 'rejected' &&
            !['bonus', 'deduction', 'مرتبات وأجور'].includes(t.category) &&
            reps.some(r => r.id === t.entityId)
        );
    }, [users, transactions]);

    // Expense Handlers
    const handleApproveExpense = async (expenseId: string) => {
        try {
            await db.updateTransaction(expenseId, { status: 'approved', isApproved: true });
            await loadData();
            toastSuccess('تم اعتماد المصروف بنجاح');
        } catch (error) {
            console.error('Error approving expense:', error);
            toastError('حدث خطأ أثناء اعتماد المصروف');
        }
    };

    const handleRejectExpense = async (expenseId: string, desc: string, amount: number) => {
        if (!confirm(`هل أنت متأكد من رفض هذا المصروف؟\n${desc} - ${amount} ج.م`)) return;
        try {
            await db.updateTransaction(expenseId, { status: 'rejected', isApproved: false });
            await loadData();
            toastSuccess('تم رفض المصروف');
        } catch (error) {
            console.error('Error rejecting expense:', error);
            toastError('حدث خطأ أثناء رفض المصروف');
        }
    };

    const handleApproveAllExpenses = async (repExpenses: Transaction[]) => {
        if (!confirm('هل أنت متأكد من اعتماد جميع المصاريف المعلقة لهذا المندوب؟')) return;
        try {
            const pending = repExpenses.filter(e => e.status === 'pending' || (!e.status && !e.isApproved));
            await Promise.all(pending.map(e => db.updateTransaction(e.id, { status: 'approved', isApproved: true })));
            await loadData();
            toastSuccess('تم اعتماد جميع المصاريف بنجاح');
        } catch (error) {
            console.error('Error approving all expenses:', error);
            toastError('حدث خطأ أثناء اعتماد المصاريف');
        }
    };

    const handleRejectAllExpenses = async (repExpenses: Transaction[]) => {
        if (!confirm('هل أنت متأكد من رفض جميع المصاريف المعلقة لهذا المندوب؟')) return;
        try {
            const pending = repExpenses.filter(e => e.status === 'pending' || (!e.status && !e.isApproved));
            await Promise.all(pending.map(e => db.updateTransaction(e.id, { status: 'rejected', isApproved: false })));
            await loadData();
            toastSuccess('تم رفض جميع المصاريف');
        } catch (error) {
            console.error('Error rejecting all expenses:', error);
            toastError('حدث خطأ أثناء رفض المصاريف');
        }
    };

    const handleSettleRepExpenses = async (_repId: string, repName: string, repExpenses: Transaction[]) => {
        const approved = repExpenses.filter(e => e.status === 'approved' || e.isApproved);
        if (approved.length === 0) {
            toastError('لا توجد مصاريف معتمدة للتسوية');
            return;
        }
        const totalAmount = approved.reduce((sum, e) => sum + e.amount, 0);
        const settledAmountStr = prompt(
            `المبلغ الإجمالي للمصاريف المعتمدة: ${totalAmount} ج.م\nأدخل المبلغ النهائي لتسوية كل هذه المصاريف معاً (يمكنك كتابة رقم أصغر لتسوية مجمعة):`,
            totalAmount.toString()
        );
        if (settledAmountStr === null) return;
        const settledAmount = parseFloat(settledAmountStr);
        if (isNaN(settledAmount) || settledAmount < 0) {
            toastError('مبلغ غير صحيح');
            return;
        }
        const cashboxId = getCashboxForCashOut('تسوية مصاريف المندوب ستخرج من الخزينة.');
        if (cashboxes.length > 0 && !cashboxId) {
            toastError('يرجى اختيار الصندوق قبل التسوية');
            return;
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const combinedDescription = approved.map(e => `${e.description} (${e.amount} ج.م)`).join('، ');

            // 1. Mark all as settled
            await Promise.all(approved.map(exp => 
                db.updateTransaction(exp.id, {
                    status: 'settled',
                    description: `${exp.description} (تمت التسوية بتاريخ ${today} - إجمالي: ${settledAmount} ج.م)`.slice(0, 500)
                })
            ));

            // 2. Add one consolidated transaction for the accounting ledger
            const tx = await db.addTransaction({
                type: 'expense',
                amount: settledAmount,
                category: 'شحن وتوصيل',
                description: `مصاريف شحن المندوب ${repName} لشهر ${selectedMonth} - التفاصيل: ${combinedDescription}`.slice(0, 500),
                date: today,
                entityType: 'general',
                cashboxId,
                isRegistered: false,
                status: 'approved',
                effectiveDate: selectedMonth + '-01'
            });
            await addTransferFeeIfNeeded(tx, cashboxId, selectedMonth + '-01');

            await loadData();
            toastSuccess('تم تسوية المصاريف بنجاح ✅');
        } catch (error) {
            console.error('Error settling expenses:', error);
            toastError('حدث خطأ أثناء تسوية المصاريف');
        }
    };

    const handlePayAllSalaries = () => {
        // Find all employees whose salary is not paid yet
        const unpaidEmployees = employeesWithStats.filter(({ stats, user }) =>
            !stats.salaryPaid && user.isActive !== false && stats.salaryDue > 0
        );

        if (unpaidEmployees.length === 0) {
            toastError('لا توجد رواتب مستحقة للصرف في هذا الشهر');
            return;
        }

        setPayConfirmData(unpaidEmployees);
        setShowPayConfirmModal(true);
    };

    const handleConfirmPayAllSalaries = async () => {
        if (cashboxes.length > 0 && !selectedCashboxId) {
            toastError('يرجى اختيار الصندوق قبل صرف الرواتب');
            return;
        }
        setShowPayConfirmModal(false);
        try {
            const today = new Date().toISOString().split('T')[0];

            await Promise.all(payConfirmData.map(async ({ user, stats }) => {
                // Get all adjustments for this month
                const monthlyAdjustments = transactions.filter(t =>
                    t.type === 'expense' &&
                    t.entityId === user.id &&
                    (t.date.startsWith(selectedMonth) || (t.effectiveDate && t.effectiveDate.startsWith(selectedMonth))) &&
                    ['bonus', 'deduction'].includes(t.category)
                );

                const adjustmentDetails = monthlyAdjustments.map(t =>
                    `${t.category === 'bonus' ? 'منحة' : 'خصم'} (${t.description}: ${t.amount})`
                ).join(' - ');

                const adjustmentsDesc = adjustmentDetails ? ` [تفاصيل: ${adjustmentDetails}]` : '';

                // Record salary payout transaction
                const tx = await db.addTransaction({
                    type: 'expense',
                    amount: stats.salaryDue,
                    category: 'مرتبات وأجور',
                    description: `راتب شهر ${selectedMonth} - ${user.name} (أساسي: ${user.baseSalary || 0})${adjustmentsDesc}`,
                    date: today,
                    entityId: user.id,
                    entityType: 'general',
                    cashboxId: selectedCashboxId,
                    isRegistered: true,
                    status: 'approved',
                    effectiveDate: selectedMonth + '-01'
                });
                await addTransferFeeIfNeeded(tx, selectedCashboxId, selectedMonth + '-01');

                // Remove individual adjustments to prevent double counting
                if (monthlyAdjustments.length > 0) {
                    await Promise.all(monthlyAdjustments.map(t => db.deleteTransaction(t.id)));
                }
            }));

            await loadData();
            toastSuccess('تم صرف جميع الرواتب بنجاح ✅');
        } catch (error) {
            console.error('Error paying all salaries:', error);
            toastError('حدث خطأ أثناء صرف الرواتب الجماعي');
        }
    };

    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser || !newExpense.amount || !newExpense.description) return;

        try {
            await db.addTransaction({
                type: 'expense',
                amount: parseFloat(newExpense.amount),
                category: newExpense.category,
                description: newExpense.description,
                date: newExpense.date,
                entityId: currentUser.id,
                entityType: 'general',
                isRegistered: false,
                status: 'pending',
                effectiveDate: selectedMonth + '-01'
            });

            setNewExpense({
                amount: '',
                category: 'شحن وتوصيل',
                description: '',
                date: new Date().toISOString().split('T')[0]
            });
            setIsExpenseModalOpen(false);
            await loadData();
            toastSuccess('تم تسجيل المصروف بنجاح وهو قيد المراجعة حالياً');
        } catch (error) {
            console.error('Error registering expense:', error);
            toastError('حدث خطأ أثناء تسجيل المصروف');
        }
    };

    // Aggregates for Summary Cards
    const aggregates = useMemo(() => {
        let totalCount = 0;
        let totalSalariesDue = 0;
        let totalAdvances = 0;
        let totalCustody = 0;
        let totalApprovedExpenses = 0;

        employeesWithStats.forEach(({ user, stats }) => {
            if (user.role !== 'doctor') { // System employees only
                if (user.isActive !== false) {
                    totalCount++;
                    totalSalariesDue += stats.salaryDue;
                }
                totalAdvances += stats.outstandingAdvances;
                totalCustody += stats.outstandingCustody;
                totalApprovedExpenses += stats.approvedExpenses;
            }
        });

        return {
            totalCount,
            totalSalariesDue,
            totalAdvances,
            totalCustody,
            totalApprovedExpenses
        };
    }, [employeesWithStats]);

    // Handle form submit for new employee
    const handleAddEmployee = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEmp.name || !newEmp.username || !newEmp.email || !newEmp.password) {
            toastError('يرجى ملء جميع الحقول المطلوبة');
            return;
        }

        try {
            // Map employeeType to role
            let role: 'admin' | 'lab' | 'representative' | 'accountant' | 'designer' | 'doctor' = 'lab';
            if (newEmp.employeeType === 'sales_rep') role = 'representative';
            else if (newEmp.employeeType === 'accountant') role = 'accountant';
            else if (newEmp.employeeType === 'admin') role = 'admin';

            const salary = newEmp.baseSalary ? parseFloat(newEmp.baseSalary) : undefined;

            const newUserData: User & { password?: string } = {
                id: crypto.randomUUID(),
                name: newEmp.name,
                username: newEmp.username,
                email: newEmp.email,
                password: newEmp.password,
                role,
                baseSalary: salary,
                employeeType: newEmp.employeeType,
                isActive: true
            };

            await db.addUser(newUserData);

            toastSuccess('تم إضافة الموظف بنجاح ✅');
            setIsAddModalOpen(false);
            setNewEmp({
                name: '',
                username: '',
                email: '',
                password: '',
                baseSalary: '',
                employeeType: 'sales_rep'
            });
            await loadData();
        } catch (error: unknown) {
            console.error('Error adding employee:', error);
            const errMsg = error instanceof Error ? error.message : 'حدث خطأ أثناء إضافة الموظف';
            toastError(errMsg);
        }
    };


    // Filtered Table Rows
    const filteredEmployees = useMemo(() => {
        return employeesWithStats.filter(({ user }) => {
            // Exclude doctors
            if (user.role === 'doctor') return false;

            // Search Filter
            const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                user.username.toLowerCase().includes(searchTerm.toLowerCase());

            // Type Filter
            const matchesType = typeFilter === 'all' || user.employeeType === typeFilter;

            // Status Filter
            const isActive = user.isActive ?? true;
            const matchesStatus = statusFilter === 'all' ||
                (statusFilter === 'active' && isActive) ||
                (statusFilter === 'inactive' && !isActive);

            return matchesSearch && matchesType && matchesStatus;
        });
    }, [employeesWithStats, searchTerm, typeFilter, statusFilter]);

    const getEmployeeTypeDisplay = (type?: string) => {
        switch (type) {
            case 'sales_rep': return 'مندوب مبيعات';
            case 'accountant': return 'محاسب';
            case 'admin': return 'مدير النظام';
            case 'other': return 'شئون أخرى (مختبر/مصمم)';
            default: return 'غير محدد';
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount) + ' ج.م';
    };

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">إدارة شؤون الموظفين والرواتب</h1>
                    <p className="text-gray-500">إدارة تفصيلية للسلف، العهد، العمولات، وصرف الأجور</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Month quick-select + picker */}
                    <div className="flex items-center gap-1.5 bg-white border rounded-lg shadow-sm px-1.5 py-1">
                        <button
                            onClick={() => setSelectedMonth((() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })())}
                            className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                                selectedMonth === (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })()
                                    ? 'bg-amber-500 text-white shadow'
                                    : 'text-gray-500 hover:bg-gray-100'
                            }`}
                        >
                            الشهر السابق ({new Date(new Date().getFullYear(), new Date().getMonth() - 1).getMonth() + 1})
                        </button>
                        <button
                            onClick={() => setSelectedMonth(new Date().toISOString().slice(0, 7))}
                            className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                                selectedMonth === new Date().toISOString().slice(0, 7)
                                    ? 'bg-brand-blue text-white shadow'
                                    : 'text-gray-500 hover:bg-gray-100'
                            }`}
                        >
                            الشهر الحالي ({new Date().getMonth() + 1})
                        </button>
                        <input
                            type="month"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            className="bg-transparent text-xs text-gray-400 border-r pr-1.5 focus:outline-none cursor-pointer"
                        />
                    </div>
                    <button
                        onClick={handlePayAllSalaries}
                        className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 shadow-sm transition-all text-sm font-medium"
                    >
                        <DollarSign className="h-4 w-4" />
                        <span>صرف رواتب الكل</span>
                    </button>
                    <button
                        onClick={() => setIsExpenseModalOpen(true)}
                        className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 shadow-sm transition-all text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        <span>تسجيل مصروف</span>
                    </button>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2 rounded-lg hover:bg-brand-blue/90 shadow-sm transition-all text-sm font-medium"
                    >
                        <UserPlus className="h-4 w-4" />
                        <span>إضافة موظف جديد</span>
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white p-5 rounded-xl border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">إجمالي الموظفين</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{aggregates.totalCount}</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
                        <UsersIcon className="h-5 w-5" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">الرواتب المستحقة ({selectedMonth})</p>
                        <p className="text-2xl font-bold text-amber-600 mt-1">{formatCurrency(aggregates.totalSalariesDue)}</p>
                    </div>
                    <div className="p-3 bg-amber-50 rounded-lg text-amber-600">
                        <DollarSign className="h-5 w-5" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">إجمالي السلف القائمة</p>
                        <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(aggregates.totalAdvances)}</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-lg text-red-600">
                        <Wallet className="h-5 w-5" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">إجمالي العهدة النقدية القائمة</p>
                        <p className="text-2xl font-bold text-indigo-600 mt-1">{formatCurrency(aggregates.totalCustody)}</p>
                    </div>
                    <div className="p-3 bg-indigo-50 rounded-lg text-indigo-600">
                        <Briefcase className="h-5 w-5" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">إجمالي المصاريف المعتمدة</p>
                        <p className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(aggregates.totalApprovedExpenses)}</p>
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600">
                        <CheckCircle className="h-5 w-5" />
                    </div>
                </div>
            </div>

            {/* Filters and Search */}
            <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-80">
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="ابحث عن موظف..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pr-10 pl-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue text-sm"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Filter className="h-4 w-4" />
                        <span>تصفية:</span>
                    </div>

                    <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        className="bg-white border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    >
                        <option value="all">كل الوظائف</option>
                        <option value="sales_rep">مندوب مبيعات</option>
                        <option value="accountant">محاسب</option>
                        <option value="admin">مدير النظام</option>
                    </select>

                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-white border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    >
                        <option value="all">كل الحالات</option>
                        <option value="active">نشط فقط</option>
                        <option value="inactive">غير نشط فقط</option>
                    </select>
                </div>
            </div>

            {/* Employees Table */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <ResponsiveTable label="جدول الموظفين">
                    <table className="w-full min-w-[900px] text-right border-collapse">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-600">
                                <th className="p-4">اسم الموظف</th>
                                <th className="p-4">النوع الوظيفي</th>
                                <th className="p-4">حالة الراتب ({selectedMonth})</th>
                                <th className="p-4">إجمالي السلف القائمة</th>
                                <th className="p-4">إجمالي العهدة القائمة</th>
                                <th className="p-4">المصاريف المعتمدة</th>
                                <th className="p-4">صافي الرصيد</th>
                                <th className="p-4">التنبيهات</th>
                                <th className="p-4 text-center">الإجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-sm">
                            {filteredEmployees.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="p-8 text-center text-gray-400">
                                        لا يوجد موظفون يطابقون خيارات البحث.
                                    </td>
                                </tr>
                            ) : (
                                filteredEmployees.map(({ user, stats }) => {
                                    return (
                                        <tr
                                            key={user.id}
                                            className="hover:bg-gray-50/80 transition-all cursor-pointer"
                                            onClick={() => navigate(`/employees/${user.id}`)}
                                        >
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-9 w-9 rounded-full bg-brand-blue/10 text-brand-blue flex items-center justify-center font-bold">
                                                        {user.name.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold text-gray-900">{user.name}</div>
                                                        <div className="text-xs text-gray-400">@{user.username}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4 text-gray-600">
                                                {getEmployeeTypeDisplay(user.employeeType)}
                                            </td>
                                            <td className="p-4">
                                                {stats.salaryPaid ? (
                                                    <span className="inline-flex items-center gap-1 text-green-600 bg-green-50 px-2.5 py-1 rounded-full text-xs font-semibold">
                                                        <CheckCircle className="h-3.5 w-3.5" />
                                                        تم الصرف
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full text-xs font-semibold">
                                                        <XCircle className="h-3.5 w-3.5" />
                                                        قيد الانتظار
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-4 text-red-600 font-semibold">
                                                {formatCurrency(stats.outstandingAdvances)}
                                            </td>
                                            <td className="p-4 text-indigo-600 font-semibold">
                                                {formatCurrency(stats.outstandingCustody)}
                                            </td>
                                            <td className="p-4 text-emerald-600 font-semibold">
                                                {formatCurrency(stats.approvedExpenses)}
                                            </td>
                                            <td className={clsx(
                                                "p-4 font-bold",
                                                stats.netBalance > 0 ? "text-green-600" : stats.netBalance < 0 ? "text-red-600" : "text-gray-900"
                                            )}>
                                                {formatCurrency(stats.netBalance)}
                                            </td>
                                            <td className="p-4">
                                                {stats.hasOverdueItems ? (
                                                    <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 px-2.5 py-1 rounded-full text-xs font-bold animate-pulse">
                                                        <AlertTriangle className="h-3.5 w-3.5" />
                                                        تأخير &gt; 30 يوم
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">-</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                                    <button
                                                        onClick={() => navigate(`/employees/${user.id}`)}
                                                        className="inline-flex items-center gap-1 text-brand-blue hover:text-brand-blue/80 font-medium text-xs bg-brand-blue/5 hover:bg-brand-blue/10 px-3 py-1.5 rounded-lg transition-all"
                                                    >
                                                        <span>عرض الملف</span>
                                                        <ChevronRight className="h-3 w-3" />
                                                    </button>
                                                    {stats.approvedExpenses > 0 && (
                                                        <button
                                                            onClick={() => {
                                                                const repExpenses = transactions.filter(t => t.entityId === user.id && t.type === 'expense' && !t.isRegistered && t.status !== 'settled');
                                                                handleSettleRepExpenses(user.id, user.name, repExpenses);
                                                            }}
                                                            className="inline-flex items-center gap-1 text-green-700 hover:text-green-800 font-medium text-xs bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-all"
                                                        >
                                                            <span>صرف المصاريف</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </ResponsiveTable>
            </div>

            {/* Representative Expenses review panel */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden mt-6">
                <div className="p-5 border-b bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">مصاريف الموظفين والمناديب قيد المراجعة</h2>
                        <p className="text-sm text-gray-500 mt-1">المراجعة والاعتماد والتسوية المجمعة للمصاريف اليومية</p>
                    </div>
                    {pendingExpenses.length > 0 && (
                        <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-bold animate-pulse">
                            {pendingExpenses.length} مصاريف معلقة (إجمالي: {pendingExpenses.reduce((sum, e) => sum + e.amount, 0).toLocaleString()} ج.م)
                        </span>
                    )}
                </div>

                <div className="divide-y divide-gray-100">
                    {pendingExpenses.length === 0 ? (
                        <p className="p-8 text-center text-gray-400">لا توجد مصاريف معلقة أو بانتظار المراجعة حالياً.</p>
                    ) : (
                        Object.entries(pendingExpenses.reduce<Record<string, Transaction[]>>((acc, expense) => {
                            const repId = expense.entityId || 'unknown';
                            if (!acc[repId]) acc[repId] = [];
                            acc[repId].push(expense);
                            return acc;
                        }, {})).map(([repId, repExpenses]) => {
                            const repName = users.find(u => u.id === repId)?.name || 'موظف غير معروف';
                            const totalRepExpenses = repExpenses.reduce((sum, e) => sum + e.amount, 0);
                            const pendingRepExpenses = repExpenses.filter(e => e.status === 'pending' || (!e.status && !e.isApproved));
                            const isExpanded = !!expandedReps[repId];

                            return (
                                <div key={repId} className="border-b last:border-0">
                                    <div
                                        className="bg-gray-50/50 px-5 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
                                        onClick={() => toggleRepDetails(repId)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                                {repName.charAt(0)}
                                            </div>
                                            <div>
                                                <span className="font-bold text-gray-900">{repName}</span>
                                                <span className="bg-blue-50 text-blue-700 text-xs px-2.5 py-0.5 rounded-full font-bold ml-3 mr-2">
                                                    إجمالي المعلق: {totalRepExpenses.toLocaleString()} ج.م
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                                            {pendingRepExpenses.length > 0 && (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleApproveAllExpenses(repExpenses)}
                                                        className="text-xs bg-green-50 text-green-700 hover:bg-green-100 border border-green-205 px-3 py-1.5 rounded-lg transition-all font-semibold"
                                                    >
                                                        قبول الكل
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectAllExpenses(repExpenses)}
                                                        className="text-xs bg-red-50 text-red-700 hover:bg-red-100 border border-red-205 px-3 py-1.5 rounded-lg transition-all font-semibold"
                                                    >
                                                        رفض الكل
                                                    </button>
                                                </div>
                                            )}
                                            <button
                                                onClick={() => handleSettleRepExpenses(repId, repName, repExpenses)}
                                                className="text-xs bg-brand-blue text-white hover:bg-brand-blue/90 px-3 py-1.5 rounded-lg shadow-sm transition-all font-semibold"
                                            >
                                                تسوية مجمعة
                                            </button>
                                            <div className="text-gray-400">
                                                {isExpanded ? (
                                                    <span className="text-xs">إغلاق التفاصيل ▲</span>
                                                ) : (
                                                    <span className="text-xs">عرض التفاصيل ({repExpenses.length}) ▼</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="divide-y divide-gray-100 bg-white">
                                            {repExpenses.map(expense => {
                                                const isPending = expense.status === 'pending' || (!expense.status && !expense.isApproved);
                                                const isApproved = expense.status === 'approved' || (!expense.status && expense.isApproved);

                                                return (
                                                    <div key={expense.id} className="p-4 pl-6 pr-12 flex items-center justify-between hover:bg-gray-50/40 transition-colors">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{expense.category}</span>
                                                            <div>
                                                                <p className="text-sm font-semibold text-gray-800">{expense.description}</p>
                                                                <p className="text-xs text-gray-400 mt-0.5">{new Date(expense.date).toLocaleDateString('ar-EG')}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <span className="font-bold text-gray-900 text-base">{expense.amount.toLocaleString()} ج.م</span>
                                                            <div className="flex items-center gap-1.5">
                                                                {isPending && (
                                                                    <>
                                                                        <button
                                                                            onClick={() => handleApproveExpense(expense.id)}
                                                                            className="text-xs bg-green-50 text-green-75 hover:bg-green-100 border border-green-205 px-2 py-1 rounded-lg transition-all"
                                                                            title="اعتماد"
                                                                        >
                                                                            ✔
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleRejectExpense(expense.id, expense.description, expense.amount)}
                                                                            className="text-xs bg-red-50 text-red-75 hover:bg-red-100 border border-red-205 px-2 py-1 rounded-lg transition-all"
                                                                            title="رفض"
                                                                        >
                                                                            ✖
                                                                        </button>
                                                                    </>
                                                                )}
                                                                {isApproved && (
                                                                    <span className="text-xs text-green-600 bg-green-50 px-2.5 py-0.5 rounded-full font-bold">
                                                                        معتمد - بانتظار التسوية
                                                                    </span>
                                                                )}
                                                            </div>
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
            </div>

            {/* Add Employee Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-gray-900">إضافة موظف جديد</h2>
                            <button
                                onClick={() => setIsAddModalOpen(false)}
                                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
                            >
                                &times;
                            </button>
                        </div>
                        <form onSubmit={handleAddEmployee} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">الاسم الكامل *</label>
                                <input
                                    type="text"
                                    required
                                    value={newEmp.name}
                                    onChange={(e) => setNewEmp(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="مثال: أحمد محمد علي"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">اسم المستخدم (للدخول) *</label>
                                    <input
                                        type="text"
                                        required
                                        value={newEmp.username}
                                        onChange={(e) => setNewEmp(prev => ({ ...prev, username: e.target.value }))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                        placeholder="user_ahmed"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">نوع الموظف *</label>
                                    <select
                                        value={newEmp.employeeType}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === 'sales_rep' || val === 'accountant' || val === 'admin' || val === 'other') {
                                                setNewEmp(prev => ({ ...prev, employeeType: val }));
                                            }
                                        }}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    >
                                        <option value="sales_rep">مندوب مبيعات</option>
                                        <option value="accountant">محاسب</option>
                                        <option value="admin">مدير النظام</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">البريد الإلكتروني *</label>
                                <input
                                    type="email"
                                    required
                                    value={newEmp.email}
                                    onChange={(e) => setNewEmp(prev => ({ ...prev, email: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="ahmed@company.com"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">كلمة المرور للدخول *</label>
                                <input
                                    type="password"
                                    required
                                    value={newEmp.password}
                                    onChange={(e) => setNewEmp(prev => ({ ...prev, password: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="8 أرقام أو حروف على الأقل"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">الراتب الأساسي (ج.م)</label>
                                <input
                                    type="number"
                                    value={newEmp.baseSalary}
                                    onChange={(e) => setNewEmp(prev => ({ ...prev, baseSalary: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="مثال: 5000"
                                />
                            </div>

                            <div className="flex gap-3 justify-end pt-3">
                                <button
                                    type="button"
                                    onClick={() => setIsAddModalOpen(false)}
                                    className="border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition-all font-medium text-gray-600"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-blue/90 shadow-sm transition-all font-medium"
                                >
                                    إضافة الموظف
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Expense Registration Modal */}
            {isExpenseModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
                            <h2 className="text-base font-bold text-gray-900">تسجيل مصروف جديد للموظف</h2>
                            <button onClick={() => setIsExpenseModalOpen(false)} className="text-gray-400 text-xl font-bold">&times;</button>
                        </div>
                        <form onSubmit={handleAddExpense} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">نوع المصروف *</label>
                                <select
                                    value={newExpense.category}
                                    onChange={(e) => setNewExpense(prev => ({ ...prev, category: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                >
                                    <option value="شحن وتوصيل">شحن وتوصيل</option>
                                    <option value="انتقالات">انتقالات</option>
                                    <option value="بوفيه وضيافة">بوفيه وضيافة</option>
                                    <option value="أدوات ومهمات">أدوات ومهمات</option>
                                    <option value="أخرى">أخرى</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">المبلغ (ج.م) *</label>
                                <input
                                    type="number"
                                    required
                                    min="0.01"
                                    step="0.01"
                                    value={newExpense.amount}
                                    onChange={(e) => setNewExpense(prev => ({ ...prev, amount: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="مثال: 50"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">الوصف / التفاصيل *</label>
                                <textarea
                                    required
                                    value={newExpense.description}
                                    onChange={(e) => setNewExpense(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    rows={2}
                                    placeholder="تفاصيل المصروف اليومي (مثال: بنزين سيارة التوصيل)..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">التاريخ *</label>
                                <input
                                    type="date"
                                    required
                                    value={newExpense.date}
                                    onChange={(e) => setNewExpense(prev => ({ ...prev, date: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                />
                            </div>
                            <div className="flex gap-3 justify-end pt-3">
                                <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-500">إلغاء</button>
                                <button type="submit" className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-semibold">تسجيل المصروف</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ===== Pay All Salaries Confirm Modal ===== */}
            {showPayConfirmModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
                        {/* Header */}
                        <div className="flex items-center gap-3 p-5 border-b bg-green-50 rounded-t-2xl">
                            <div className="p-2 bg-green-100 rounded-lg">
                                <DollarSign className="h-5 w-5 text-green-700" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-gray-900">تأكيد صرف الرواتب</h3>
                                <p className="text-xs text-gray-500">شهر {selectedMonth} — {payConfirmData.length} موظف مستحق</p>
                            </div>
                        </div>

                        {/* Body - employee breakdown */}
                        <div className="p-5 max-h-72 overflow-y-auto">
                            {cashboxes.length > 0 && (
                                <div className="mb-4">
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">الصندوق الذي سيتم الصرف منه *</label>
                                    <select
                                        required
                                        value={selectedCashboxId}
                                        onChange={(e) => setSelectedCashboxId(e.target.value)}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    >
                                        <option value="">-- اختر الصندوق --</option>
                                        {cashboxes.map(box => <option key={box.id} value={box.id}>{box.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-xs text-gray-500 border-b">
                                        <th className="text-right pb-2">الموظف</th>
                                        <th className="text-right pb-2">الأساسي</th>
                                        <th className="text-right pb-2">المستحق</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payConfirmData.map(({ user, stats }) => (
                                        <tr key={user.id} className="border-b last:border-0">
                                            <td className="py-2 font-medium text-gray-800">{user.name}</td>
                                            <td className="py-2 text-gray-500">{(user.baseSalary || 0).toLocaleString()}</td>
                                            <td className="py-2 font-bold text-green-700">{stats.salaryDue.toLocaleString()} ج.م</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-green-50 rounded">
                                        <td className="py-2 font-bold text-gray-800 pr-1">الإجمالي</td>
                                        <td></td>
                                        <td className="py-2 font-bold text-green-700 text-base">
                                            {payConfirmData.reduce((s, { stats }) => s + stats.salaryDue, 0).toLocaleString()} ج.م
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 justify-end p-5 border-t bg-gray-50 rounded-b-2xl">
                            <button
                                onClick={() => setShowPayConfirmModal(false)}
                                className="border border-gray-300 px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-all"
                            >
                                إلغاء
                            </button>
                            <button
                                onClick={handleConfirmPayAllSalaries}
                                className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-green-700 transition-all shadow-sm"
                            >
                                ✅ تأكيد الصرف
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
