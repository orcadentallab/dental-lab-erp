import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, type User, type EmployeeAdvance, type EmployeeCustody, type EmployeeCommission, type Transaction } from '../services/db';
import { getEmployeeFinanceStats } from '../utils/employeeFinance';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
    ArrowRight,
    Wallet,
    Briefcase,
    AlertTriangle,
    Plus,
    CheckCircle,
    XCircle,
    Trash2,
    Calendar,
    Award
} from 'lucide-react';
import clsx from 'clsx';

export default function EmployeeDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user: currentUser } = useAuth();
    const { success: toastSuccess, error: toastError } = useToast();

    // Data State
    const [users, setUsers] = useState<User[]>([]);
    const [employee, setEmployee] = useState<User | null>(null);
    const [advances, setAdvances] = useState<EmployeeAdvance[]>([]);
    const [custodies, setCustodies] = useState<EmployeeCustody[]>([]);
    const [commissions, setCommissions] = useState<EmployeeCommission[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

    // Form Modals
    const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
    const [newAdvance, setNewAdvance] = useState({ amount: '', reason: '', date: new Date().toISOString().split('T')[0] });

    const [isCustodyModalOpen, setIsCustodyModalOpen] = useState(false);
    const [newCustody, setNewCustody] = useState({
        description: '',
        amount: '',
        item: '',
        dateGiven: new Date().toISOString().split('T')[0],
        notes: ''
    });

    const [isCommissionModalOpen, setIsCommissionModalOpen] = useState(false);
    const [newCommission, setNewCommission] = useState({
        amount: '',
        date: new Date().toISOString().split('T')[0],
        period: new Date().toISOString().slice(0, 7), // YYYY-MM
        note: ''
    });

    // Adjustment Form Modal (for salary bonuses/deductions)
    const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
    const [adjustmentType, setAdjustmentType] = useState<'bonus' | 'deduction'>('bonus');
    const [newAdjustment, setNewAdjustment] = useState({ amount: '', description: '' });

    // Daily Expenses State (for representative daily expenses)
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [newExpense, setNewExpense] = useState({
        amount: '',
        category: 'شحن وتوصيل',
        description: '',
        date: new Date().toISOString().split('T')[0]
    });

    const loadData = useCallback(async () => {
        if (!id) return;
        setIsLoading(true);
        try {
            const [allUsers, allAdvances, allCustodies, allCommissions, allTransactions] = await Promise.all([
                db.getUsers(),
                db.getEmployeeAdvances(id),
                db.getEmployeeCustodies(id),
                db.getEmployeeCommissions(id),
                db.getTransactions()
            ]);

            setUsers(allUsers);
            const emp = allUsers.find(u => u.id === id);
            if (emp) {
                setEmployee(emp);
            } else {
                toastError('الموظف غير موجود');
                navigate('/employees');
            }

            setAdvances(allAdvances);
            setCustodies(allCustodies);
            setCommissions(allCommissions);
            setTransactions(allTransactions);
        } catch (error) {
            console.error('Error loading employee details:', error);
            toastError('حدث خطأ أثناء تحميل بيانات الموظف');
        } finally {
            setIsLoading(false);
        }
    }, [id, navigate, toastError]);

    const isAuthorized = useMemo(() => {
        if (!currentUser) return false;
        if (['admin', 'accountant'].includes(currentUser.role)) return true;
        return currentUser.id === id;
    }, [currentUser, id]);

    useEffect(() => {
        if (currentUser && !isAuthorized) {
            toastError('غير مصرح لك بعرض بيانات موظف آخر');
            navigate('/dashboard', { replace: true });
            return;
        }
        loadData();
    }, [loadData, currentUser, isAuthorized]);

    // Financial calculations for the selected month
    const stats = useMemo(() => {
        if (!employee) return null;
        return getEmployeeFinanceStats(
            employee,
            selectedMonth,
            advances,
            custodies,
            commissions,
            transactions
        );
    }, [employee, selectedMonth, advances, custodies, commissions, transactions]);

    // Get current month adjustments (bonuses/deductions) for display
    const monthlyAdjustments = useMemo(() => {
        if (!employee) return [];
        return transactions.filter(t =>
            t.entityId === employee.id &&
            (
                t.effectiveDate
                    ? t.effectiveDate.startsWith(selectedMonth)
                    : t.date.startsWith(selectedMonth)
            ) &&
            ['bonus', 'deduction'].includes(t.category)
        );
    }, [employee, selectedMonth, transactions]);

    const activeBonuses = useMemo(() => monthlyAdjustments.filter(t => t.category === 'bonus'), [monthlyAdjustments]);
    const activeDeductions = useMemo(() => monthlyAdjustments.filter(t => t.category === 'deduction'), [monthlyAdjustments]);

    // Representative Daily Expenses
    const repDailyExpenses = useMemo(() => {
        if (!employee) return [];
        return transactions.filter(t =>
            t.entityId === employee.id &&
            t.type === 'expense' &&
            !['bonus', 'deduction', 'مرتبات وأجور'].includes(t.category)
        ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [employee, transactions]);

    interface LedgerItem {
        id: string;
        date: string;
        type: 'salary' | 'advance' | 'custody' | 'expense' | 'commission';
        description: string;
        amount: number | null;
        itemDetail?: string;
        status: string;
    }

    const ledgerItems = useMemo(() => {
        if (!employee) return [];
        const items: LedgerItem[] = [];

        // 1. Add all transactions (salaries, adjustments, commissions, expenses)
        transactions.forEach(t => {
            if (t.entityId !== employee.id) return;
            
            let label = 'معاملة مالية';
            if (t.category === 'مرتبات وأجور') label = 'صرف راتب';
            else if (t.category === 'bonus') label = 'منحة / مكافأة';
            else if (t.category === 'deduction') label = 'خصم / جزاء';
            else if (['شحن وتوصيل', 'انتقالات', 'بوفيه وضيافة', 'أدوات ومهمات', 'أخرى'].includes(t.category)) {
                label = `مصروف (${t.category})`;
            } else if (t.category === 'commission') {
                label = 'عمولة يدوية';
            }

            let statusStr = 'نشط';
            if (t.status === 'pending') statusStr = 'قيد المراجعة';
            else if (t.status === 'approved') statusStr = 'معتمد';
            else if (t.status === 'rejected') statusStr = 'مرفوض';
            else if (t.status === 'settled') statusStr = 'تمت التسوية';

            items.push({
                id: t.id,
                date: t.date,
                type: t.category === 'مرتبات وأجور' ? 'salary' : 
                      ['bonus', 'deduction'].includes(t.category) ? 'salary' : 'expense',
                description: `${label}: ${t.description}`,
                amount: t.amount,
                status: statusStr
            });
        });

        // 2. Add Advances
        advances.forEach(a => {
            items.push({
                id: a.id,
                date: a.date,
                type: 'advance',
                description: `سلفة: ${a.reason}`,
                amount: a.amount,
                status: a.status === 'settled' ? 'مسواة' : 'قائمة'
            });
        });

        // 3. Add Custody
        custodies.forEach(c => {
            items.push({
                id: c.id,
                date: c.dateGiven,
                type: 'custody',
                description: `عهدة: ${c.description}`,
                amount: c.amount ?? null,
                itemDetail: c.item ?? undefined,
                status: c.status === 'closed' ? 'مسترجعة' : 'مفتوحة'
            });
        });

        // 4. Add manual commissions
        commissions.forEach(c => {
            items.push({
                id: c.id,
                date: c.date,
                type: 'commission',
                description: `عمولة مدخلة لشهر ${c.period} - ملاحظة: ${c.note || 'بدون'}`,
                amount: c.amount,
                status: 'معتمدة'
            });
        });

        // Sort by date descending
        return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [employee, transactions, advances, custodies, commissions]);

    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!employee || !newExpense.amount || !newExpense.description) return;

        try {
            await db.addTransaction({
                type: 'expense',
                amount: parseFloat(newExpense.amount),
                category: newExpense.category,
                description: newExpense.description,
                date: newExpense.date,
                entityId: employee.id,
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
            console.error('Error adding expense:', error);
            toastError('حدث خطأ أثناء تسجيل المصروف');
        }
    };

    // Format helpers
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount) + ' ج.م';
    };

    const getUserName = (userId?: string | null) => {
        if (!userId) return 'تلقائي';
        return users.find(u => u.id === userId)?.name || 'غير معروف';
    };

    const handleEditBaseSalary = async () => {
        if (!employee) return;
        const currentSalary = employee.baseSalary || 0;
        const newSalaryStr = prompt(`تعديل الراتب الأساسي لـ ${employee.name}:`, currentSalary.toString());
        if (newSalaryStr === null) return; // cancelled
        
        const newSalary = parseFloat(newSalaryStr);
        if (isNaN(newSalary) || newSalary < 0) {
            toastError('الراتب المدخل غير صحيح');
            return;
        }

        try {
            await db.updateUser({
                ...employee,
                baseSalary: newSalary
            });
            await loadData();
            toastSuccess('تم تحديث الراتب الأساسي بنجاح ✅');
        } catch (error) {
            console.error('Error updating base salary:', error);
            toastError('حدث خطأ أثناء تحديث الراتب الأساسي');
        }
    };

    // Salary Payout
    const handlePaySalary = async () => {
        if (!employee || !stats) return;
        if (stats.salaryPaid) {
            toastError('تم صرف راتب هذا الشهر بالفعل');
            return;
        }

        const confirmMsg = `هل أنت متأكد من صرف الراتب للموظف ${employee.name} لشهر ${selectedMonth} بمبلغ ${formatCurrency(stats.salaryDue)}؟\nملاحظة: هذا الإجراء سيسجل مصروفاً ولا يسوي السلف أو العهد تلقائياً.`;
        if (!confirm(confirmMsg)) return;

        try {
            const today = new Date().toISOString().split('T')[0];
            const adjustmentsDesc = monthlyAdjustments.length > 0
                ? ` - تسويات: ${monthlyAdjustments.map(t => `${t.description} (${t.amount} ج.م)`).join('، ')}`
                : '';

            // 1. Create consolidated expense transaction
            await db.addTransaction({
                type: 'expense',
                amount: stats.salaryDue,
                category: 'مرتبات وأجور',
                description: `راتب شهر ${selectedMonth} - ${employee.name} (أساسي: ${employee.baseSalary || 0} - عمولة: ${commissions.filter(c => c.period === selectedMonth).reduce((sum, c) => sum + c.amount, 0)} - منح: ${activeBonuses.reduce((sum, b) => sum + b.amount, 0)} - خصومات: ${activeDeductions.reduce((sum, d) => sum + d.amount, 0)})${adjustmentsDesc}`,
                date: today,
                entityId: employee.id,
                entityType: 'general',
                isRegistered: true,
                effectiveDate: selectedMonth + '-01'
            });

            // 2. Delete monthly adjustment tokens (bonuses/deductions)
            if (monthlyAdjustments.length > 0) {
                await Promise.all(monthlyAdjustments.map(t => db.deleteTransaction(t.id)));
            }

            await loadData();
            toastSuccess('تم صرف الراتب بنجاح ✅');
        } catch (error) {
            console.error('Error paying salary:', error);
            toastError('حدث خطأ أثناء صرف الراتب');
        }
    };

    // Add Bonus/Deduction Adjustment
    const handleAddAdjustment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!employee || !newAdjustment.amount || !newAdjustment.description) return;

        try {
            await db.addTransaction({
                type: 'expense',
                amount: parseFloat(newAdjustment.amount),
                description: newAdjustment.description,
                date: selectedMonth + '-01',
                category: adjustmentType,
                entityId: employee.id,
                entityType: 'general',
                isRegistered: false,
                effectiveDate: selectedMonth + '-01'
            });

            setNewAdjustment({ amount: '', description: '' });
            setIsAdjustmentModalOpen(false);
            await loadData();
            toastSuccess('تم إضافة التسوية بنجاح');
        } catch (error) {
            console.error('Error adding adjustment:', error);
            toastError('حدث خطأ أثناء إضافة التسوية');
        }
    };

    // Add Loan/Advance
    const handleAddAdvance = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!employee || !newAdvance.amount || !newAdvance.reason) return;

        try {
            await db.addEmployeeAdvance({
                employeeId: employee.id,
                amount: parseFloat(newAdvance.amount),
                reason: newAdvance.reason,
                date: newAdvance.date,
                status: 'pending',
                createdBy: currentUser?.id || null
            });

            setNewAdvance({ amount: '', reason: '', date: new Date().toISOString().split('T')[0] });
            setIsAdvanceModalOpen(false);
            await loadData();
            toastSuccess('تم تسجيل السلفة بنجاح');
        } catch (error) {
            console.error('Error adding advance:', error);
            toastError('حدث خطأ أثناء تسجيل السلفة');
        }
    };

    // Settle Loan/Advance (Manual)
    const handleSettleAdvance = async (advanceId: string) => {
        if (!confirm('هل تريد تسوية هذه السلفة يدوياً؟')) return;
        try {
            await db.updateEmployeeAdvance(advanceId, { status: 'settled' });
            await loadData();
            toastSuccess('تم تسوية السلفة بنجاح');
        } catch (error) {
            console.error('Error settling advance:', error);
            toastError('حدث خطأ أثناء تسوية السلفة');
        }
    };

    // Add Custody
    const handleAddCustody = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!employee || !newCustody.description) return;
        if (!newCustody.amount && !newCustody.item) {
            toastError('يجب إدخال مبلغ مالي أو اسم عهدة عينية (أدوات)');
            return;
        }

        try {
            await db.addEmployeeCustody({
                employeeId: employee.id,
                description: newCustody.description,
                amount: newCustody.amount ? parseFloat(newCustody.amount) : null,
                item: newCustody.item || null,
                dateGiven: newCustody.dateGiven,
                status: 'open',
                notes: newCustody.notes || null,
                createdBy: currentUser?.id || null
            });

            setNewCustody({ description: '', amount: '', item: '', dateGiven: new Date().toISOString().split('T')[0], notes: '' });
            setIsCustodyModalOpen(false);
            await loadData();
            toastSuccess('تم تسليم العهدة بنجاح');
        } catch (error) {
            console.error('Error adding custody:', error);
            toastError('حدث خطأ أثناء تسجيل العهدة');
        }
    };

    // Close Custody (Manual)
    const handleCloseCustody = async (custodyId: string) => {
        if (!confirm('هل تم إرجاع/إغلاق هذه العهدة بالكامل؟')) return;
        try {
            const today = new Date().toISOString().split('T')[0];
            await db.updateEmployeeCustody(custodyId, { status: 'closed', dateReturned: today });
            await loadData();
            toastSuccess('تم إغلاق العهدة بنجاح');
        } catch (error) {
            console.error('Error closing custody:', error);
            toastError('حدث خطأ أثناء إغلاق العهدة');
        }
    };

    // Add Manual Commission
    const handleAddCommission = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!employee || !newCommission.amount || !newCommission.period) return;

        try {
            await db.addEmployeeCommission({
                employeeId: employee.id,
                amount: parseFloat(newCommission.amount),
                date: newCommission.date,
                period: newCommission.period,
                note: newCommission.note || null,
                createdBy: currentUser?.id || null
            });

            setNewCommission({ amount: '', date: new Date().toISOString().split('T')[0], period: new Date().toISOString().slice(0, 7), note: '' });
            setIsCommissionModalOpen(false);
            await loadData();
            toastSuccess('تم تسجيل العمولة بنجاح');
        } catch (error) {
            console.error('Error adding commission:', error);
            toastError('حدث خطأ أثناء إضافة العمولة');
        }
    };

    // Delete Commission
    const handleDeleteCommission = async (commId: string) => {
        if (!confirm('هل تريد حذف هذه العمولة اليدوية؟')) return;
        try {
            await db.deleteEmployeeCommission(commId);
            await loadData();
            toastSuccess('تم حذف العمولة اليدوية');
        } catch (error) {
            console.error('Error deleting commission:', error);
            toastError('حدث خطأ أثناء حذف العمولة');
        }
    };

    // Calculate dates over 30 days old for alerts
    const getIsOverdue = (dateStr: string) => {
        const itemDate = new Date(dateStr);
        const today = new Date();
        const diffTime = Math.abs(today.getTime() - itemDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 30;
    };

    const hasOverdueAdvance = useMemo(() => {
        return advances.some(a => a.status === 'pending' && getIsOverdue(a.date));
    }, [advances]);

    const hasOverdueCustody = useMemo(() => {
        return custodies.some(c => c.status === 'open' && getIsOverdue(c.dateGiven));
    }, [custodies]);

    if (isLoading) return <div className="text-center py-12 text-gray-500">جاري تحميل الملف...</div>;
    if (!employee || !stats) return <div className="text-center py-12 text-red-500">الموظف غير موجود</div>;

    const isSalesRep = employee.employeeType === 'sales_rep';
    const isAdminOrAccountant = ['admin', 'accountant'].includes(currentUser?.role || '');

    return (
        <div className="space-y-6">
            {/* Header / Back */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <button
                    onClick={() => navigate('/employees')}
                    className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-all font-semibold"
                >
                    <ArrowRight className="h-4 w-4" />
                    <span>العودة لقائمة الموظفين</span>
                </button>
                <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="bg-white px-3 py-1.5 border rounded-lg shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    />
                </div>
            </div>

            {/* Profile Overview Card */}
            <div className="bg-white p-6 rounded-xl border shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                <div className="flex items-center gap-4 border-l md:border-l border-gray-100 pl-6">
                    <div className="h-16 w-16 rounded-full bg-brand-blue/15 text-brand-blue flex items-center justify-center font-bold text-2xl">
                        {employee.name.charAt(0)}
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-xl font-bold text-gray-900">{employee.name}</h1>
                            {stats.hasOverdueItems && (
                                <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 text-xs px-2 rounded-full font-bold animate-pulse">
                                    <AlertTriangle className="h-3 w-3" />
                                    <span>تأخير &gt; 30 يوم</span>
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-gray-500">@{employee.username}</p>
                        <span className={clsx(
                            "inline-block mt-2 text-xs px-2.5 py-0.5 rounded-full font-bold",
                            employee.isActive !== false ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        )}>
                            {employee.isActive !== false ? 'نشط في النظام' : 'غير نشط / موقوف'}
                        </span>
                    </div>
                </div>

                <div className="space-y-2 text-sm text-gray-600 pr-6 border-l border-gray-100 h-full flex flex-col justify-center">
                    <div><strong>نوع الموظف:</strong> {isSalesRep ? 'مندوب مبيعات' : employee.employeeType === 'accountant' ? 'محاسب' : employee.employeeType === 'admin' ? 'مدير نظام' : 'أخرى'}</div>
                    <div><strong>البريد الإلكتروني:</strong> {employee.email || 'لا يوجد'}</div>
                    <div className="flex items-center gap-2">
                        <strong>الراتب الأساسي:</strong>
                        <span>{formatCurrency(employee.baseSalary || 0)}</span>
                        {isAdminOrAccountant && (
                            <button
                                onClick={handleEditBaseSalary}
                                className="text-2xs text-brand-blue hover:underline bg-brand-blue/5 hover:bg-brand-blue/10 px-2 py-0.5 rounded transition-all font-semibold"
                            >
                                تعديل
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex flex-col items-center justify-center bg-gray-50/50 p-4 rounded-xl">
                    <span className="text-sm text-gray-500 font-medium">صافي الرصيد الحالي ({selectedMonth})</span>
                    <span className={clsx(
                        "text-3xl font-extrabold mt-1",
                        stats.netBalance > 0 ? "text-green-600" : stats.netBalance < 0 ? "text-red-600" : "text-gray-900"
                    )}>
                        {formatCurrency(stats.netBalance)}
                    </span>
                    <span className="text-xs text-gray-400 mt-2 text-center">يشمل: الراتب والعمولات (مضافاً) مطروحاً منها السلف والعهدة النقدية</span>
                </div>
            </div>

            {/* Financial Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-gray-500">السلف القائمة</p>
                        <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(stats.outstandingAdvances)}</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-lg text-red-600">
                        <Wallet className="h-6 w-6" />
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-gray-500">العهدة النقدية المفتوحة</p>
                        <p className="text-2xl font-bold text-indigo-600 mt-1">{formatCurrency(stats.outstandingCustody)}</p>
                    </div>
                    <div className="p-3 bg-indigo-50 rounded-lg text-indigo-600">
                        <Briefcase className="h-6 w-6" />
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl border shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-gray-500">العمولات المستحقة ({selectedMonth})</p>
                        <p className="text-2xl font-bold text-green-600 mt-1">
                            {formatCurrency(commissions.filter(c => c.period === selectedMonth).reduce((sum, c) => sum + c.amount, 0))}
                        </p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg text-green-600">
                        <Award className="h-6 w-6" />
                    </div>
                </div>
            </div>

            {/* Main Tabs Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 1. Salaries & Payroll Section */}
                <div className="bg-white p-6 rounded-xl border shadow-sm space-y-4">
                    <div className="flex justify-between items-center border-b pb-3">
                        <h2 className="text-lg font-bold text-gray-900">مسير الرواتب والمستحقات للشهر</h2>
                        {stats.salaryPaid ? (
                            <span className="bg-green-50 text-green-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
                                <CheckCircle className="h-3.5 w-3.5" />
                                تم الصرف
                            </span>
                        ) : (
                            <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
                                <XCircle className="h-3.5 w-3.5" />
                                قيد الانتظار
                            </span>
                        )}
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between text-sm py-1 border-b border-gray-50">
                            <span className="text-gray-500">الراتب الأساسي</span>
                            <span className="font-semibold text-gray-900">{formatCurrency(employee.baseSalary || 0)}</span>
                        </div>
                        {isSalesRep && (
                            <div className="flex justify-between text-sm py-1 border-b border-gray-50">
                                <span className="text-gray-500">العمولة اليدوية لشهر {selectedMonth}</span>
                                <span className="font-semibold text-green-600">
                                    + {formatCurrency(commissions.filter(c => c.period === selectedMonth).reduce((sum, c) => sum + c.amount, 0))}
                                </span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm py-1 border-b border-gray-50">
                            <span className="text-gray-500">مكافآت ومنح للشهر</span>
                            <span className="font-semibold text-green-600">+ {formatCurrency(activeBonuses.reduce((sum, b) => sum + b.amount, 0))}</span>
                        </div>
                        <div className="flex justify-between text-sm py-1 border-b border-gray-50">
                            <span className="text-gray-500">خصومات وجزاءات للشهر</span>
                            <span className="font-semibold text-red-600">- {formatCurrency(activeDeductions.reduce((sum, d) => sum + d.amount, 0))}</span>
                        </div>
                        <div className="flex justify-between text-base font-bold pt-2 border-t border-dashed">
                            <span>صافي الراتب المستحق للصرف</span>
                            <span className="text-brand-blue">{formatCurrency(stats.salaryDue)}</span>
                        </div>
                    </div>

                    {isAdminOrAccountant && (
                        <div className="flex gap-3 pt-3">
                            <button
                                onClick={handlePaySalary}
                                disabled={stats.salaryPaid || employee.isActive === false}
                                className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:opacity-50 font-bold transition-all text-sm shadow-sm"
                            >
                                {stats.salaryPaid ? 'تم صرف راتب الشهر' : 'صرف الراتب وتسجيل المصروف'}
                            </button>
                            <button
                                onClick={() => setIsAdjustmentModalOpen(true)}
                                className="bg-gray-100 text-gray-700 hover:bg-gray-200 py-2 px-4 rounded-lg font-semibold transition-all text-sm"
                            >
                                إضافة منحة / خصم
                            </button>
                        </div>
                    )}
                </div>

                {/* 2. Advances Section (السلف) */}
                <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col space-y-4">
                    <div className="flex justify-between items-center border-b pb-3">
                        <h2 className="text-lg font-bold text-gray-900">إدارة القروض والسلف</h2>
                        {isAdminOrAccountant && (
                            <button
                                onClick={() => setIsAdvanceModalOpen(true)}
                                className="inline-flex items-center gap-1 text-xs text-white bg-brand-blue hover:bg-brand-blue/90 px-2.5 py-1.5 rounded-lg font-medium transition-all"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                <span>طلب سلفة</span>
                            </button>
                        )}
                    </div>

                    {hasOverdueAdvance && (
                        <div className="bg-red-50 text-red-800 p-3 rounded-lg flex items-start gap-2 text-xs border border-red-100">
                            <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <strong>تنبيه مالي:</strong> توجد سلف قائمة لم تتم تسويتها منذ أكثر من 30 يوماً. يرجى المراجعة والتسوية.
                            </div>
                        </div>
                    )}

                    <div className="overflow-y-auto max-h-60 flex-1 border rounded-lg">
                        <table className="w-full text-right text-xs">
                            <thead className="bg-gray-50 sticky top-0 font-semibold text-gray-600 border-b">
                                <tr>
                                    <th className="p-3">التاريخ</th>
                                    <th className="p-3">السبب</th>
                                    <th className="p-3">القيمة</th>
                                    <th className="p-3">الحالة</th>
                                    <th className="p-3">بواسطة</th>
                                    {isAdminOrAccountant && <th className="p-3 text-center">إجراء</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {advances.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-4 text-center text-gray-400">لا توجد سلف مسجلة.</td>
                                    </tr>
                                ) : (
                                    advances.map(adv => (
                                        <tr key={adv.id} className="hover:bg-gray-50/50">
                                            <td className="p-3">{adv.date}</td>
                                            <td className="p-3 font-medium">{adv.reason}</td>
                                            <td className="p-3 text-red-600 font-bold">{formatCurrency(adv.amount)}</td>
                                            <td className="p-3">
                                                <span className={clsx(
                                                    "px-2 py-0.5 rounded-full font-semibold",
                                                    adv.status === 'settled' ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700 animate-pulse"
                                                )}>
                                                    {adv.status === 'settled' ? 'مسواة' : 'قائمة'}
                                                </span>
                                            </td>
                                            <td className="p-3 text-gray-500">{getUserName(adv.createdBy)}</td>
                                            {isAdminOrAccountant && (
                                                <td className="p-3 text-center">
                                                    {adv.status === 'pending' && (
                                                        <button
                                                            onClick={() => handleSettleAdvance(adv.id)}
                                                            className="bg-brand-blue text-white px-2 py-1 rounded text-2xs font-semibold hover:bg-brand-blue/90"
                                                        >
                                                            تسوية
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 3. Custody Section (العهدة) */}
                <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col space-y-4">
                    <div className="flex justify-between items-center border-b pb-3">
                        <h2 className="text-lg font-bold text-gray-900">عهدة الموظف (أجهزة ونقدية)</h2>
                        {isAdminOrAccountant && (
                            <button
                                onClick={() => setIsCustodyModalOpen(true)}
                                className="inline-flex items-center gap-1 text-xs text-white bg-brand-blue hover:bg-brand-blue/90 px-2.5 py-1.5 rounded-lg font-medium transition-all"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                <span>تسليم عهدة</span>
                            </button>
                        )}
                    </div>

                    {hasOverdueCustody && (
                        <div className="bg-red-50 text-red-800 p-3 rounded-lg flex items-start gap-2 text-xs border border-red-100">
                            <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <strong>تنبيه بالعهدة:</strong> توجد عهد مفتوحة تحت مسؤولية الموظف منذ أكثر من 30 يوماً. يرجى متابعة تسليمها.
                            </div>
                        </div>
                    )}

                    <div className="overflow-y-auto max-h-60 flex-1 border rounded-lg">
                        <table className="w-full text-right text-xs">
                            <thead className="bg-gray-50 sticky top-0 font-semibold text-gray-600 border-b">
                                <tr>
                                    <th className="p-3">تاريخ الاستلام</th>
                                    <th className="p-3">التفاصيل</th>
                                    <th className="p-3">العهدة</th>
                                    <th className="p-3">الحالة</th>
                                    <th className="p-3">بواسطة</th>
                                    {isAdminOrAccountant && <th className="p-3 text-center">إجراء</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {custodies.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-4 text-center text-gray-400">لا توجد عهد مسجلة.</td>
                                    </tr>
                                ) : (
                                    custodies.map(cust => (
                                        <tr key={cust.id} className="hover:bg-gray-50/50">
                                            <td className="p-3">{cust.dateGiven}</td>
                                            <td className="p-3">
                                                <div className="font-semibold">{cust.description}</div>
                                                {cust.notes && <div className="text-gray-400 text-2xs">{cust.notes}</div>}
                                            </td>
                                            <td className="p-3">
                                                {cust.amount ? (
                                                    <span className="text-indigo-600 font-bold">{formatCurrency(cust.amount)}</span>
                                                ) : (
                                                    <span className="text-gray-600 bg-gray-100 px-2 py-0.5 rounded font-mono font-semibold">{cust.item}</span>
                                                )}
                                            </td>
                                            <td className="p-3">
                                                <span className={clsx(
                                                    "px-2 py-0.5 rounded-full font-semibold",
                                                    cust.status === 'closed' ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                                                )}>
                                                    {cust.status === 'closed' ? 'مستلمة/مغلقة' : 'مفتوحة'}
                                                </span>
                                            </td>
                                            <td className="p-3 text-gray-500">{getUserName(cust.createdBy)}</td>
                                            {isAdminOrAccountant && (
                                                <td className="p-3 text-center">
                                                    {cust.status === 'open' && (
                                                        <button
                                                            onClick={() => handleCloseCustody(cust.id)}
                                                            className="bg-brand-blue text-white px-2 py-1 rounded text-2xs font-semibold hover:bg-brand-blue/90"
                                                        >
                                                            استلام
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 4. Manual Commissions (العمولات) - Sales Reps Only */}
                {isSalesRep && (
                    <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col space-y-4">
                        <div className="flex justify-between items-center border-b pb-3">
                            <h2 className="text-lg font-bold text-gray-900">سجل إدخال العمولات اليدوي</h2>
                            {isAdminOrAccountant && (
                                <button
                                    onClick={() => setIsCommissionModalOpen(true)}
                                    className="inline-flex items-center gap-1 text-xs text-white bg-brand-blue hover:bg-brand-blue/90 px-2.5 py-1.5 rounded-lg font-medium transition-all"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    <span>تسجيل عمولة</span>
                                </button>
                            )}
                        </div>

                        <div className="overflow-y-auto max-h-60 flex-1 border rounded-lg">
                            <table className="w-full text-right text-xs">
                                <thead className="bg-gray-50 sticky top-0 font-semibold text-gray-600 border-b">
                                    <tr>
                                        <th className="p-3">التاريخ</th>
                                        <th className="p-3">شهر الاستحقاق</th>
                                        <th className="p-3">مبلغ العمولة</th>
                                        <th className="p-3">ملاحظات</th>
                                        <th className="p-3">بواسطة</th>
                                        {isAdminOrAccountant && <th className="p-3 text-center">حذف</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {commissions.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="p-4 text-center text-gray-400">لا توجد عمولات مدخلة.</td>
                                        </tr>
                                    ) : (
                                        commissions.map(comm => (
                                            <tr key={comm.id} className="hover:bg-gray-50/50">
                                                <td className="p-3">{comm.date}</td>
                                                <td className="p-3 font-semibold text-brand-blue">{comm.period}</td>
                                                <td className="p-3 text-green-600 font-bold">{formatCurrency(comm.amount)}</td>
                                                <td className="p-3 text-gray-500">{comm.note || '-'}</td>
                                                <td className="p-3 text-gray-500">{getUserName(comm.createdBy)}</td>
                                                {isAdminOrAccountant && (
                                                    <td className="p-3 text-center">
                                                        <button
                                                            onClick={() => handleDeleteCommission(comm.id)}
                                                            className="text-red-500 hover:text-red-700"
                                                        >
                                                            <Trash2 className="h-4 w-4 inline" />
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* 5. Daily Expenses Section (المصاريف اليومية) */}
                {employee && (
                    <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col space-y-4">
                        <div className="flex justify-between items-center border-b pb-3">
                            <h2 className="text-lg font-bold text-gray-900">سجل المصاريف اليومية للموظف</h2>
                            {(currentUser?.id === employee.id || isAdminOrAccountant) && (
                                <button
                                    onClick={() => setIsExpenseModalOpen(true)}
                                    className="inline-flex items-center gap-1 text-xs text-white bg-brand-blue hover:bg-brand-blue/90 px-2.5 py-1.5 rounded-lg font-medium transition-all"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    <span>تسجيل مصروف</span>
                                </button>
                            )}
                        </div>

                        <div className="overflow-y-auto max-h-60 flex-1 border rounded-lg">
                            <table className="w-full text-right text-xs">
                                <thead className="bg-gray-50 sticky top-0 font-semibold text-gray-600 border-b">
                                    <tr>
                                        <th className="p-3">التاريخ</th>
                                        <th className="p-3">نوع المصروف</th>
                                        <th className="p-3">الوصف</th>
                                        <th className="p-3">المبلغ</th>
                                        <th className="p-3">الحالة</th>
                                        {isAdminOrAccountant && <th className="p-3 text-center">إجراء</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {repDailyExpenses.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="p-4 text-center text-gray-400">لا توجد مصاريف مسجلة.</td>
                                        </tr>
                                    ) : (
                                        repDailyExpenses.map(exp => {
                                            const isPending = exp.status === 'pending' || (!exp.status && !exp.isApproved);
                                            const isApproved = exp.status === 'approved' || (!exp.status && exp.isApproved);
                                            const isRejected = exp.status === 'rejected';

                                            return (
                                                <tr key={exp.id} className="hover:bg-gray-50/50">
                                                    <td className="p-3">{exp.date}</td>
                                                    <td className="p-3 font-semibold text-gray-700">{exp.category}</td>
                                                    <td className="p-3 text-gray-500">{exp.description}</td>
                                                    <td className="p-3 font-bold text-gray-900">{formatCurrency(exp.amount)}</td>
                                                    <td className="p-3">
                                                        <span className={clsx(
                                                            "px-2 py-0.5 rounded-full font-semibold",
                                                            isPending ? "bg-amber-50 text-amber-700" :
                                                            isApproved ? "bg-green-50 text-green-700" :
                                                            isRejected ? "bg-red-50 text-red-75" :
                                                            "bg-indigo-50 text-indigo-700" // settled
                                                        )}>
                                                            {isPending ? 'قيد المراجعة' :
                                                             isApproved ? 'معتمد' :
                                                             isRejected ? 'مرفوض' : 'تمت التسوية'}
                                                        </span>
                                                    </td>
                                                    {isAdminOrAccountant && (
                                                        <td className="p-3 text-center">
                                                            {isPending && (
                                                                <div className="flex justify-center gap-1">
                                                                    <button
                                                                        onClick={async () => {
                                                                            await db.updateTransaction(exp.id, { status: 'approved', isApproved: true });
                                                                            await loadData();
                                                                            toastSuccess('تم اعتماد المصروف');
                                                                        }}
                                                                        className="bg-green-50 text-green-700 p-1 rounded hover:bg-green-100 font-bold"
                                                                        title="اعتماد"
                                                                    >
                                                                        ✔
                                                                    </button>
                                                                    <button
                                                                        onClick={async () => {
                                                                            if (confirm(`هل أنت متأكد من رفض المصروف؟\n${exp.description}`)) {
                                                                                await db.updateTransaction(exp.id, { status: 'rejected', isApproved: false });
                                                                                await loadData();
                                                                                toastSuccess('تم رفض المصروف');
                                                                            }
                                                                        }}
                                                                        className="bg-red-50 text-red-75 p-1 rounded hover:bg-red-100 font-bold"
                                                                        title="رفض"
                                                                    >
                                                                        ✖
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Unified Historical Financial Ledger */}
            <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col space-y-4 mt-6">
                <div className="border-b pb-3 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">كشف الحساب المالي الموحد للموظف</h2>
                        <p className="text-sm text-gray-500 mt-1">سجل تاريخي شامل لجميع الرواتب، السلف، العهد، والمصاريف اليومية</p>
                    </div>
                </div>

                <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-right text-xs">
                        <thead className="bg-gray-50 font-semibold text-gray-600 border-b">
                            <tr>
                                <th className="p-3">التاريخ</th>
                                <th className="p-3">النوع</th>
                                <th className="p-3">البيان / الوصف</th>
                                <th className="p-3">القيمة</th>
                                <th className="p-3">الحالة / تفاصيل العهدة</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y text-gray-700">
                            {ledgerItems.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-6 text-center text-gray-400 font-medium">لا توجد سجلات مالية سابقة مسجلة لهذا الموظف.</td>
                                </tr>
                            ) : (
                                ledgerItems.map((item, index) => {
                                    let typeBadge = 'bg-gray-50 text-gray-700';
                                    let typeLabel = 'أخرى';
                                    if (item.type === 'salary') {
                                        typeBadge = 'bg-green-50 text-green-700';
                                        typeLabel = 'راتب / تسوية';
                                    } else if (item.type === 'advance') {
                                        typeBadge = 'bg-amber-50 text-amber-700';
                                        typeLabel = 'سلفة';
                                    } else if (item.type === 'custody') {
                                        typeBadge = 'bg-indigo-50 text-indigo-700';
                                        typeLabel = 'عهدة';
                                    } else if (item.type === 'expense') {
                                        typeBadge = 'bg-blue-50 text-blue-750';
                                        typeLabel = 'مصروف مندوب';
                                    } else if (item.type === 'commission') {
                                        typeBadge = 'bg-emerald-50 text-emerald-700';
                                        typeLabel = 'عمولة';
                                    }

                                    return (
                                        <tr key={item.id + '-' + index} className="hover:bg-gray-50/55 transition-colors">
                                            <td className="p-3 font-medium text-gray-500">{item.date}</td>
                                            <td className="p-3">
                                                <span className={clsx("px-2 py-0.5 rounded-full font-bold", typeBadge)}>
                                                    {typeLabel}
                                                </span>
                                            </td>
                                            <td className="p-3 font-semibold text-gray-800">{item.description}</td>
                                            <td className="p-3 font-bold text-gray-900">
                                                {item.amount !== null ? formatCurrency(item.amount) : '-'}
                                            </td>
                                            <td className="p-3">
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-gray-600">{item.status}</span>
                                                    {item.itemDetail && (
                                                        <span className="text-2xs text-gray-400 mt-0.5">تفاصيل العهدة: {item.itemDetail}</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Adjustments Form Modal (منحة/خصم) */}
            {isAdjustmentModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
                            <h2 className="text-base font-bold text-gray-900">إضافة منحة أو خصم</h2>
                            <button onClick={() => setIsAdjustmentModalOpen(false)} className="text-gray-400 text-xl font-bold">&times;</button>
                        </div>
                        <form onSubmit={handleAddAdjustment} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">النوع</label>
                                <select
                                    value={adjustmentType}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === 'bonus' || val === 'deduction') {
                                            setAdjustmentType(val);
                                        }
                                    }}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                >
                                    <option value="bonus">منحة / مكافأة (+)</option>
                                    <option value="deduction">خصم / جزاء (-)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">المبلغ (ج.م)</label>
                                <input
                                    type="number"
                                    required
                                    min="0.01"
                                    step="0.01"
                                    value={newAdjustment.amount}
                                    onChange={(e) => setNewAdjustment(prev => ({ ...prev, amount: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="مثال: 200"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">السبب / التفاصيل</label>
                                <textarea
                                    required
                                    value={newAdjustment.description}
                                    onChange={(e) => setNewAdjustment(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    rows={2}
                                    placeholder="اكتب تفاصيل أو سبب المنحة/الخصم..."
                                />
                            </div>
                            <div className="flex gap-3 justify-end pt-3">
                                <button type="button" onClick={() => setIsAdjustmentModalOpen(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-500">إلغاء</button>
                                <button type="submit" className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm">حفظ</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Advance Request Modal */}
            {isAdvanceModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
                            <h2 className="text-base font-bold text-gray-900">تسجيل سلفة للموظف</h2>
                            <button onClick={() => setIsAdvanceModalOpen(false)} className="text-gray-400 text-xl font-bold">&times;</button>
                        </div>
                        <form onSubmit={handleAddAdvance} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">مبلغ السلفة (ج.م) *</label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    value={newAdvance.amount}
                                    onChange={(e) => setNewAdvance(prev => ({ ...prev, amount: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="مثال: 1000"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">السبب *</label>
                                <input
                                    type="text"
                                    required
                                    value={newAdvance.reason}
                                    onChange={(e) => setNewAdvance(prev => ({ ...prev, reason: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="مثال: سلفة شخصية طارئة"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">التاريخ</label>
                                <input
                                    type="date"
                                    required
                                    value={newAdvance.date}
                                    onChange={(e) => setNewAdvance(prev => ({ ...prev, date: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                />
                            </div>
                            <div className="flex gap-3 justify-end pt-3">
                                <button type="button" onClick={() => setIsAdvanceModalOpen(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-500">إلغاء</button>
                                <button type="submit" className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm">تسجيل</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Custody Request Modal */}
            {isCustodyModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
                            <h2 className="text-base font-bold text-gray-900">تسليم عهدة للموظف</h2>
                            <button onClick={() => setIsCustodyModalOpen(false)} className="text-gray-400 text-xl font-bold">&times;</button>
                        </div>
                        <form onSubmit={handleAddCustody} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">وصف العهدة *</label>
                                <input
                                    type="text"
                                    required
                                    value={newCustody.description}
                                    onChange={(e) => setNewCustody(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="مثال: لابتوب عمل / عهدة مكتبية"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">العهدة النقدية (ج.م)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={newCustody.amount}
                                        onChange={(e) => setNewCustody(prev => ({ ...prev, amount: e.target.value }))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                        placeholder="اختياري"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">العهدة العينية (أدوات)</label>
                                    <input
                                        type="text"
                                        value={newCustody.item}
                                        onChange={(e) => setNewCustody(prev => ({ ...prev, item: e.target.value }))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                        placeholder="مثال: Lenovo E15"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">تاريخ التسليم</label>
                                <input
                                    type="date"
                                    required
                                    value={newCustody.dateGiven}
                                    onChange={(e) => setNewCustody(prev => ({ ...prev, dateGiven: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">ملاحظات إضافية</label>
                                <textarea
                                    value={newCustody.notes}
                                    onChange={(e) => setNewCustody(prev => ({ ...prev, notes: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    rows={2}
                                    placeholder="سيريال نمبر أو تفاصيل أخرى..."
                                />
                            </div>
                            <div className="flex gap-3 justify-end pt-3">
                                <button type="button" onClick={() => setIsCustodyModalOpen(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-500">إلغاء</button>
                                <button type="submit" className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm">تسجيل عهدة</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Commission Modal */}
            {isCommissionModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
                            <h2 className="text-base font-bold text-gray-900">تسجيل عمولة يدوية للمندوب</h2>
                            <button onClick={() => setIsCommissionModalOpen(false)} className="text-gray-400 text-xl font-bold">&times;</button>
                        </div>
                        <form onSubmit={handleAddCommission} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">قيمة العمولة (ج.م) *</label>
                                <input
                                    type="number"
                                    required
                                    min="0.01"
                                    step="0.01"
                                    value={newCommission.amount}
                                    onChange={(e) => setNewCommission(prev => ({ ...prev, amount: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    placeholder="مثال: 500"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">شهر الاستحقاق *</label>
                                    <input
                                        type="month"
                                        required
                                        value={newCommission.period}
                                        onChange={(e) => setNewCommission(prev => ({ ...prev, period: e.target.value }))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">التاريخ</label>
                                    <input
                                        type="date"
                                        required
                                        value={newCommission.date}
                                        onChange={(e) => setNewCommission(prev => ({ ...prev, date: e.target.value }))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">ملاحظة / وصف</label>
                                <textarea
                                    value={newCommission.note}
                                    onChange={(e) => setNewCommission(prev => ({ ...prev, note: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                                    rows={2}
                                    placeholder="تفاصيل تصفية المبيعات..."
                                />
                            </div>
                            <div className="flex gap-3 justify-end pt-3">
                                <button type="button" onClick={() => setIsCommissionModalOpen(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-500">إلغاء</button>
                                <button type="submit" className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm">حفظ</button>
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
                            <h2 className="text-base font-bold text-gray-900">تسجيل مصروف جديد للمندوب</h2>
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
                                <button type="submit" className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm">تسجيل المصروف</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
