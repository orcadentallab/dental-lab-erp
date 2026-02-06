import { useEffect, useState, useCallback, useMemo } from 'react';
import { db } from '../services/db';
import { TrendingUp, Activity, Wallet, Calendar, ArrowDownRight, Award, Zap, Package, Users, DollarSign, BarChart3, RefreshCcw, ArrowUpRight, CreditCard, Receipt, Clock, AlertCircle, PiggyBank, TrendingDown, Banknote, FileText } from 'lucide-react';
import clsx from 'clsx';
import React from 'react';

// KPICard component defined outside of Analytics to avoid recreation on each render
const KPICard = ({ title, value, subtext, icon: Icon, type, percentage, percentageLabel, isPercentage = true }: {
    title: string;
    value: number;
    subtext: string;
    icon: React.ComponentType<{ size: number; className?: string }>;
    type: string;
    percentage?: number;
    percentageLabel?: string;
    isPercentage?: boolean;
}) => {
    const styleMap: Record<string, { bg: string; text: string; iconBg: string; border: string }> = {
        profit: { bg: 'bg-emerald-50', text: 'text-emerald-700', iconBg: 'bg-gradient-to-br from-emerald-500 to-emerald-600', border: 'border-emerald-100' },
        revenue: { bg: 'bg-blue-50', text: 'text-blue-700', iconBg: 'bg-gradient-to-br from-blue-500 to-blue-600', border: 'border-blue-100' },
        expense: { bg: 'bg-rose-50', text: 'text-rose-700', iconBg: 'bg-gradient-to-br from-rose-500 to-rose-600', border: 'border-rose-100' },
        neutral: { bg: 'bg-slate-50', text: 'text-slate-700', iconBg: 'bg-gradient-to-br from-slate-500 to-slate-600', border: 'border-slate-100' },
    };
    const styles = styleMap[type] || styleMap.neutral;

    return (
        <div className={clsx(
            "bg-white p-5 rounded-2xl border shadow-sm hover:shadow-lg transition-all duration-300 group cursor-pointer relative overflow-hidden",
            styles.border
        )}>
            {/* Subtle gradient overlay */}
            <div className={clsx("absolute inset-0 opacity-[0.03] pointer-events-none", styles.iconBg)} />

            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <div className={clsx("p-3 rounded-xl text-white shadow-lg transition-transform group-hover:scale-105 duration-300", styles.iconBg)}>
                        <Icon size={22} />
                    </div>
                </div>

                <h3 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight mb-1">
                    {value.toLocaleString()} <span className="text-xs font-semibold text-slate-400">ج.م</span>
                </h3>

                {/* Percentage/Metric Display */}
                {percentage !== undefined && (
                    <div className="flex items-center gap-2 mb-2">
                        <span className={clsx(
                            "text-sm font-bold px-2 py-0.5 rounded-lg",
                            isPercentage
                                ? (percentage >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")
                                : "bg-blue-50 text-blue-600"
                        )}>
                            {isPercentage ? (
                                <>{percentage >= 0 ? '+' : ''}{percentage.toFixed(1)}%</>
                            ) : (
                                <>{Math.round(percentage).toLocaleString()}</>
                            )}
                        </span>
                        {percentageLabel && (
                            <span className="text-xs text-slate-400">{percentageLabel}</span>
                        )}
                    </div>
                )}

                <p className="text-sm font-semibold text-slate-700 mb-0.5">{title}</p>
                <p className="text-xs text-slate-400">{subtext}</p>
            </div>
        </div>
    );
};


export default function Analytics() {
    const [stats, setStats] = useState({
        totalRevenue: 0,
        deliveredRevenue: 0,
        grossProfit: 0,
        netProfit: 0,
        operatingExpenses: 0,
        productionCosts: 0,
        pendingRevenue: 0,
        orderCount: 0,
        activeOrders: 0,
        totalUnits: 0,
        topExpenseCategory: '',
        topExpenseAmount: 0
    });
    const [topDoctors, setTopDoctors] = useState<{ name: string; revenue: number; count: number }[]>([]);
    const [topServices, setTopServices] = useState<{ name: string; count: number; revenue: number }[]>([]);

    // Tab state
    const [activeTab, setActiveTab] = useState<'overview' | 'financial'>('overview');

    // Financial Analysis State
    const [financialStats, setFinancialStats] = useState({
        // Cash Flow
        totalCollections: 0,
        totalPayments: 0,
        netCashFlow: 0,
        // P&L
        salesRevenue: 0,
        cogs: 0,
        grossProfit: 0,
        grossMargin: 0,
        operatingExpenses: 0,
        operatingIncome: 0,
        operatingMargin: 0,
        // Receivables
        totalReceivables: 0,
        aging0to30: 0,
        aging30to60: 0,
        aging60to90: 0,
        aging90plus: 0,
        dso: 0,
        // Payables
        totalPayables: 0
    });

    // Date Range Logic - use useMemo instead of useEffect to derive dates

    const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'year' | 'all' | 'custom'>('month');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    const { startDate, endDate } = useMemo(() => {
        if (dateRange === 'custom') {
            return { startDate: customStartDate, endDate: customEndDate };
        }

        const today = new Date();
        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        switch (dateRange) {
            case 'today':
                return { startDate: formatDate(today), endDate: formatDate(today) };
            case 'week': {
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - 7);
                return { startDate: formatDate(weekStart), endDate: formatDate(today) };
            }
            case 'month':
                return {
                    startDate: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)),
                    endDate: formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 0))
                };
            case 'year':
                return {
                    startDate: formatDate(new Date(today.getFullYear(), 0, 1)),
                    endDate: formatDate(new Date(today.getFullYear(), 11, 31))
                };
            case 'all':
                return { startDate: '', endDate: '' };
        }
    }, [dateRange, customStartDate, customEndDate]);


    const calculateStats = useCallback(async () => {

        try {
            const [orders, transactionsData, doctorsData] = await Promise.all([
                db.getAllOrdersUnpaginated(),
                db.getTransactions(),
                db.getDoctors()
            ]);



            const isInRange = (dateStr: string) => {
                if (!dateStr) return false;
                if (dateRange === 'all') return true;
                const d = dateStr.split('T')[0];
                return d >= (startDate || '') && d <= (endDate || '');
            };

            const filteredOrders = orders.filter(o => {
                const status = (o.status || '').toLowerCase();
                const isCompleted = status === 'delivered' || status === 'completed';
                const date = isCompleted ? (o.deliveryDate || o.createdAt) : o.createdAt;
                return isInRange(date);
            });

            const filteredTransactions = transactionsData.filter(t => isInRange(t.date));

            const completedOrders = filteredOrders.filter(o =>
                ['delivered', 'completed'].includes((o.status || '').toLowerCase())
            );

            // 1. Total Sales Value
            const totalSalesValue = completedOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

            // 2. Units
            const totalUnits = completedOrders.reduce((sum, o) => {
                return sum + (o.items || []).reduce((itemSum, item: { teethNumbers?: string[] }) => {
                    const count = item.teethNumbers?.length || 1;
                    return itemSum + count;
                }, 0);
            }, 0);

            // 3. Collected Revenue
            const collectedRevenue = filteredTransactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            // 4. Profit
            const totalCostOfGoods = completedOrders.reduce((sum, o) => sum + (o.cost || 0), 0);
            const grossProfit = totalSalesValue - totalCostOfGoods;


            let totalProductionCosts = 0;
            let totalOperatingExpenses = 0;
            const expenseCategories = new Map<string, number>();

            filteredTransactions.filter(t => t.type === 'expense').forEach(t => {
                if (t.entityType === 'supplier' || t.entityType === 'designer') {
                    totalProductionCosts += (t.amount || 0);
                } else {
                    totalOperatingExpenses += (t.amount || 0);
                    const cat = t.category || 'Other';
                    expenseCategories.set(cat, (expenseCategories.get(cat) || 0) + (t.amount || 0));
                }
            });

            let topExpenseCategory = 'None';
            let topExpenseAmount = 0;

            for (const [cat, amount] of expenseCategories.entries()) {
                if (amount > topExpenseAmount) {
                    topExpenseAmount = amount;
                    topExpenseCategory = cat;
                }
            }

            const netProfit = grossProfit - totalOperatingExpenses;

            setStats({
                totalRevenue: collectedRevenue,
                deliveredRevenue: totalSalesValue,
                grossProfit,
                netProfit,
                operatingExpenses: totalOperatingExpenses,
                productionCosts: totalProductionCosts,
                pendingRevenue: totalSalesValue - collectedRevenue,
                orderCount: completedOrders.length,
                activeOrders: 0,
                totalUnits,
                topExpenseCategory,
                topExpenseAmount
            });

            // Top Doctors
            const doctorStats = new Map<string, { revenue: number; count: number }>();
            completedOrders.forEach(o => {
                const current = doctorStats.get(o.doctorId) || { revenue: 0, count: 0 };
                current.revenue += (o.totalPrice || 0);
                current.count += 1;
                doctorStats.set(o.doctorId, current);
            });

            const sortedDoctors = Array.from(doctorStats.entries())
                .map(([id, stat]) => {
                    const doc = doctorsData.find(d => d.id === id);
                    return { name: doc ? doc.name : 'Unknown', ...stat };
                })
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5);
            setTopDoctors(sortedDoctors);

            // Top Services
            const serviceStats = new Map<string, { count: number; revenue: number }>();
            completedOrders.forEach(o => {
                (o.items || []).forEach((item: { serviceType: string; teethNumbers?: string[]; price?: number }) => {
                    const current = serviceStats.get(item.serviceType) || { count: 0, revenue: 0 };
                    const unitCount = item.teethNumbers?.length || 1;
                    current.count += unitCount;
                    current.revenue += (item.price || 0) * unitCount;
                    serviceStats.set(item.serviceType, current);
                });
            });

            const sortedServices = Array.from(serviceStats.entries())
                .map(([name, stat]) => ({ name, ...stat }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);
            setTopServices(sortedServices);

            // ========== FINANCIAL ANALYSIS ==========

            // Cash Flow Analysis
            const totalCollections = filteredTransactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            const totalPayments = filteredTransactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            const netCashFlow = totalCollections - totalPayments;

            // P&L Analysis
            const salesRevenue = totalSalesValue;
            const cogs = totalCostOfGoods;
            const grossMargin = salesRevenue > 0 ? (grossProfit / salesRevenue) * 100 : 0;
            const operatingIncome = grossProfit - totalOperatingExpenses;
            const operatingMargin = salesRevenue > 0 ? (operatingIncome / salesRevenue) * 100 : 0;

            // Accounts Receivable Analysis (All unpaid orders)
            const today = new Date();
            let totalReceivables = 0;
            let aging0to30 = 0;
            let aging30to60 = 0;
            let aging60to90 = 0;
            let aging90plus = 0;

            // Calculate per-doctor balances for receivables
            const doctorBalances = new Map<string, number>();
            orders.forEach(o => {
                if (['delivered', 'completed'].includes((o.status || '').toLowerCase())) {
                    const current = doctorBalances.get(o.doctorId) || 0;
                    doctorBalances.set(o.doctorId, current + (o.totalPrice || 0));
                }
            });

            // Subtract payments
            transactionsData
                .filter(t => t.type === 'income' && t.entityType === 'doctor')
                .forEach(t => {
                    if (t.entityId) {
                        const current = doctorBalances.get(t.entityId) || 0;
                        doctorBalances.set(t.entityId, current - (t.amount || 0));
                    }
                });

            // Calculate aging based on oldest unpaid order per doctor
            doctorBalances.forEach((balance, doctorId) => {
                if (balance > 0) {
                    totalReceivables += balance;
                    // Find oldest unpaid order for this doctor
                    const doctorOrders = orders
                        .filter(o => o.doctorId === doctorId && ['delivered', 'completed'].includes((o.status || '').toLowerCase()))
                        .sort((a, b) => new Date(a.deliveryDate || a.createdAt).getTime() - new Date(b.deliveryDate || b.createdAt).getTime());

                    if (doctorOrders.length > 0) {
                        const oldestDate = new Date(doctorOrders[0].deliveryDate || doctorOrders[0].createdAt);
                        const daysDiff = Math.floor((today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));

                        if (daysDiff <= 30) aging0to30 += balance;
                        else if (daysDiff <= 60) aging30to60 += balance;
                        else if (daysDiff <= 90) aging60to90 += balance;
                        else aging90plus += balance;
                    }
                }
            });

            // DSO (Days Sales Outstanding)
            const avgDailyRevenue = totalSalesValue / (dateRange === 'month' ? 30 : dateRange === 'year' ? 365 : 30);
            const dso = avgDailyRevenue > 0 ? Math.round(totalReceivables / avgDailyRevenue) : 0;

            // Accounts Payable (suppliers + designers)
            const supplierBalances = new Map<string, number>();
            orders.forEach(o => {
                if (['delivered', 'completed'].includes((o.status || '').toLowerCase())) {
                    const cost = o.cost || 0;
                    // Distribute cost to suppliers (simplified - using a generic key)
                    const current = supplierBalances.get('all_suppliers') || 0;
                    supplierBalances.set('all_suppliers', current + cost);
                }
            });

            // Subtract supplier payments
            const supplierPaymentsTotal = transactionsData
                .filter(t => t.type === 'expense' && (t.entityType === 'supplier' || t.entityType === 'designer'))
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            const totalPayables = Math.max(0, (supplierBalances.get('all_suppliers') || 0) - supplierPaymentsTotal);

            setFinancialStats({
                totalCollections,
                totalPayments,
                netCashFlow,
                salesRevenue,
                cogs,
                grossProfit,
                grossMargin,
                operatingExpenses: totalOperatingExpenses,
                operatingIncome,
                operatingMargin,
                totalReceivables,
                aging0to30,
                aging30to60,
                aging60to90,
                aging90plus,
                dso,
                totalPayables
            });

        } catch (error) {
            console.error('Error loading analytics:', error);
        }
    }, [startDate, endDate, dateRange]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Data fetching requires setting state after async operations
        if ((startDate && endDate) || dateRange === 'all') calculateStats();
    }, [startDate, endDate, dateRange, calculateStats]);

    const dateRangeLabels: Record<string, string> = {
        today: 'اليوم',
        week: 'أسبوع',
        month: 'شهر',
        year: 'سنة',
        all: 'الكل'
    };

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 sm:p-8 rounded-2xl shadow-xl text-white relative overflow-hidden">
                {/* Background decorations */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-blue-500/10 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-emerald-500/10 to-transparent rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

                <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-white/10 rounded-xl backdrop-blur-sm">
                                <BarChart3 size={24} className="text-blue-400" />
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-bold">التقارير والتحليلات</h1>
                        </div>
                        <p className="text-slate-400 text-sm sm:text-base max-w-xl">
                            متابعة شاملة للأداء المالي والتشغيلي للمعمل
                        </p>
                    </div>

                    {/* Date Range Picker */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="bg-white/10 backdrop-blur-md p-1 rounded-xl flex flex-wrap items-center gap-1 border border-white/10">
                            {(['today', 'week', 'month', 'year', 'all'] as const).map((range) => (
                                <button
                                    key={range}
                                    onClick={() => setDateRange(range)}
                                    className={clsx(
                                        "px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer",
                                        dateRange === range
                                            ? "bg-white text-slate-900 shadow-lg"
                                            : "text-slate-300 hover:bg-white/10 hover:text-white"
                                    )}
                                >
                                    {dateRangeLabels[range]}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setDateRange('custom')}
                            className={clsx(
                                "p-2.5 rounded-xl transition-all cursor-pointer",
                                dateRange === 'custom'
                                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                                    : "bg-white/10 text-white/60 hover:text-white hover:bg-white/20"
                            )}
                            title="تاريخ مخصص"
                        >
                            <Calendar size={18} />
                        </button>
                    </div>
                </div>

                {/* Custom Date Inputs */}
                {dateRange === 'custom' && (
                    <div className="mt-6 flex flex-wrap gap-4 animate-in fade-in slide-in-from-top-2 duration-300 relative z-10">
                        <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10">
                            <label className="text-xs text-slate-400">من</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={e => setCustomStartDate(e.target.value)}
                                className="bg-transparent border-none text-white text-sm outline-none"
                                aria-label="Start Date"
                            />
                        </div>
                        <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10">
                            <label className="text-xs text-slate-400">إلى</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={e => setCustomEndDate(e.target.value)}
                                className="bg-transparent border-none text-white text-sm outline-none"
                                aria-label="End Date"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div className="bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex gap-1">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={clsx(
                            "flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2",
                            activeTab === 'overview'
                                ? "bg-slate-900 text-white shadow-lg"
                                : "text-slate-600 hover:bg-slate-50"
                        )}
                    >
                        <BarChart3 size={18} />
                        نظرة عامة
                    </button>
                    <button
                        onClick={() => setActiveTab('financial')}
                        className={clsx(
                            "flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2",
                            activeTab === 'financial'
                                ? "bg-slate-900 text-white shadow-lg"
                                : "text-slate-600 hover:bg-slate-50"
                        )}
                    >
                        <FileText size={18} />
                        التحليل المالي
                    </button>
                </div>
            </div>

            {/* Overview Tab Content */}
            {activeTab === 'overview' && (
                <>
                    {/* KPI Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

                        <KPICard
                            title="المبيعات"
                            value={stats.deliveredRevenue}
                            subtext="قيمة الأعمال المسلمة"
                            icon={TrendingUp}
                            type="revenue"
                            percentage={stats.totalUnits > 0 ? stats.deliveredRevenue / stats.totalUnits : undefined}
                            percentageLabel="ج.م/وحدة"
                            isPercentage={false}
                        />
                        <KPICard
                            title="مجمل الربح"
                            value={stats.grossProfit}
                            subtext="المبيعات - تكلفة الإنتاج"
                            icon={Zap}
                            type="profit"
                            percentage={stats.deliveredRevenue > 0 ? (stats.grossProfit / stats.deliveredRevenue) * 100 : undefined}
                            percentageLabel="هامش إجمالي"
                        />
                        <KPICard
                            title="مصروفات التشغيل"
                            value={stats.operatingExpenses}
                            subtext="إيجار، شحن، نثريات..."
                            icon={ArrowDownRight}
                            type="expense"
                            percentage={stats.deliveredRevenue > 0 ? -((stats.operatingExpenses / stats.deliveredRevenue) * 100) : undefined}
                            percentageLabel="من المبيعات"
                        />
                        <KPICard
                            title="صافي الربح"
                            value={stats.netProfit}
                            subtext="مجمل الربح - مصروفات التشغيل"
                            icon={Wallet}
                            type={stats.netProfit >= 0 ? 'profit' : 'expense'}
                            percentage={stats.deliveredRevenue > 0 ? (stats.netProfit / stats.deliveredRevenue) * 100 : undefined}
                            percentageLabel="هامش صافي"
                        />
                    </div>

                    {/* Main Content Grid */}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

                        {/* Insights Panel */}
                        <div className="xl:col-span-1">
                            <div className="bg-gradient-to-b from-slate-50 to-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full">
                                <div className="flex items-center gap-2 mb-6">
                                    <div className="p-2 bg-amber-100 rounded-lg">
                                        <Zap size={18} className="text-amber-600" />
                                    </div>
                                    <h3 className="font-bold text-lg text-slate-800">تحليل سريع</h3>
                                </div>

                                <div className="space-y-4">
                                    {/* Profit Margin */}
                                    <div className="bg-white p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors cursor-pointer">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-bold text-slate-500">هامش الربح</span>
                                            <span className={clsx(
                                                "text-[10px] font-bold px-2 py-0.5 rounded-full",
                                                stats.deliveredRevenue > 0 && (stats.netProfit / stats.deliveredRevenue) > 0.3
                                                    ? "bg-emerald-100 text-emerald-700"
                                                    : "bg-amber-100 text-amber-700"
                                            )}>
                                                {stats.deliveredRevenue > 0 && (stats.netProfit / stats.deliveredRevenue) > 0.3 ? 'ممتاز' : 'متوسط'}
                                            </span>
                                        </div>
                                        <div className="text-2xl font-black text-slate-800">
                                            {stats.deliveredRevenue > 0 ? ((stats.netProfit / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                        </div>
                                        <p className="text-xs text-slate-400 mt-1">
                                            حافظ على نسبة مصروفات أقل من 30%
                                        </p>
                                    </div>

                                    {/* Collection Rate */}
                                    <div className="bg-white p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors cursor-pointer">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-bold text-slate-500">أداء التحصيل</span>
                                        </div>
                                        <div className="text-2xl font-black text-slate-800 mb-2">
                                            {stats.deliveredRevenue > 0 ? ((stats.totalRevenue / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                        </div>
                                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                            <div
                                                className="bg-gradient-to-r from-blue-500 to-blue-400 h-full rounded-full transition-all duration-700"
                                                style={{ width: `${Math.min(100, (stats.totalRevenue / (stats.deliveredRevenue || 1)) * 100)}%` }}
                                            />
                                        </div>
                                        <p className="text-xs text-slate-400 mt-2">
                                            نسبة التحصيل من الأعمال المسلمة
                                        </p>
                                    </div>

                                    {/* Expense Efficiency */}
                                    <div className="bg-white p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors cursor-pointer">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-bold text-slate-500">كفاءة المصروفات</span>
                                            <span className={clsx(
                                                "text-[10px] font-bold px-2 py-0.5 rounded-full",
                                                stats.deliveredRevenue > 0 && (stats.operatingExpenses / stats.deliveredRevenue) < 0.3
                                                    ? "bg-emerald-100 text-emerald-700"
                                                    : "bg-amber-100 text-amber-700"
                                            )}>
                                                {stats.deliveredRevenue > 0 && (stats.operatingExpenses / stats.deliveredRevenue) < 0.3 ? 'كفء' : 'مرتفع'}
                                            </span>
                                        </div>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-2xl font-black text-slate-800">
                                                {stats.deliveredRevenue > 0 ? ((stats.operatingExpenses / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                            </span>
                                            <span className="text-xs text-slate-400">من المبيعات</span>
                                        </div>

                                        {stats.topExpenseCategory && stats.topExpenseAmount > 0 && (
                                            <div className="mt-3 pt-3 border-t border-slate-50">
                                                <p className="text-[10px] text-slate-400 mb-1">الأكثر استهلاكاً:</p>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="font-bold text-slate-600">{stats.topExpenseCategory}</span>
                                                    <span className="font-medium text-slate-500">{stats.topExpenseAmount.toLocaleString()} ج.م</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Top Doctors */}
                        <div className="xl:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <div className="flex justify-between items-center mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-amber-100 rounded-lg">
                                        <Users size={18} className="text-amber-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg text-slate-800">أكثر العملاء نشاطاً</h3>
                                        <p className="text-slate-400 text-xs">بناءً على إجمالي الإيرادات</p>
                                    </div>
                                </div>
                                <div className="p-2 bg-slate-50 rounded-lg">
                                    <Award size={18} className="text-slate-400" />
                                </div>
                            </div>

                            <div className="space-y-4">
                                {topDoctors.map((doc, idx) => {
                                    const maxVal = topDoctors[0]?.revenue || 1;
                                    const percent = (doc.revenue / maxVal) * 100;
                                    return (
                                        <div key={idx} className="group cursor-pointer">
                                            <div className="flex justify-between items-end mb-2">
                                                <div className="flex items-center gap-3">
                                                    <div className={clsx(
                                                        "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm",
                                                        idx === 0 ? "bg-amber-100 text-amber-600" :
                                                            idx === 1 ? "bg-slate-100 text-slate-600" :
                                                                idx === 2 ? "bg-orange-100 text-orange-600" :
                                                                    "bg-slate-50 text-slate-400"
                                                    )}>
                                                        {idx + 1}
                                                    </div>
                                                    <span className="font-semibold text-slate-700">{doc.name}</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="block font-bold text-slate-800">{doc.revenue.toLocaleString()} ج.م</span>
                                                    <span className="text-[10px] text-slate-400">{doc.count} حالة</span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                                <div
                                                    className={clsx(
                                                        "h-full rounded-full transition-all duration-700 ease-out",
                                                        idx === 0 ? "bg-gradient-to-r from-amber-400 to-amber-500" : "bg-gradient-to-r from-blue-400 to-blue-500"
                                                    )}
                                                    style={{ width: `${percent}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                                {topDoctors.length === 0 && (
                                    <div className="text-center py-10 text-slate-400">لا توجد بيانات كافية للتحليل</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Top Services Section */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-100 rounded-lg">
                                    <Package size={18} className="text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-slate-800">أكثر الخدمات طلباً</h3>
                                    <p className="text-slate-400 text-xs">بناءً على عدد الوحدات المنفذة</p>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                            {topServices.map((service, idx) => {
                                const maxVal = topServices[0]?.count || 1;
                                const percent = (service.count / maxVal) * 100;
                                return (
                                    <div key={idx} className="group bg-slate-50 p-4 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all cursor-pointer">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className={clsx(
                                                "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm",
                                                idx === 0 ? "bg-emerald-100 text-emerald-600" :
                                                    idx === 1 ? "bg-blue-100 text-blue-600" :
                                                        idx === 2 ? "bg-purple-100 text-purple-600" :
                                                            "bg-slate-100 text-slate-500"
                                            )}>
                                                {idx + 1}
                                            </div>
                                            <span className="font-semibold text-slate-700 text-sm truncate">{service.name}</span>
                                        </div>
                                        <div className="text-center mb-3">
                                            <span className="text-3xl font-black text-slate-800">{service.count}</span>
                                            <span className="text-xs text-slate-400 block">وحدة</span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                            <div
                                                className={clsx(
                                                    "h-full rounded-full transition-all duration-700",
                                                    idx === 0 ? "bg-emerald-500" : "bg-slate-400"
                                                )}
                                                style={{ width: `${percent}%` }}
                                            />
                                        </div>
                                        <div className="mt-2 text-center">
                                            <span className="text-xs text-slate-500">{service.revenue.toLocaleString()} ج.م</span>
                                        </div>
                                    </div>
                                );
                            })}
                            {topServices.length === 0 && (
                                <div className="col-span-full text-center py-10 text-slate-400">لا توجد بيانات كافية للتحليل</div>
                            )}
                        </div>
                    </div>

                    {/* Quick Stats Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-gradient-to-br from-indigo-50 to-white p-5 rounded-xl border border-indigo-100 text-center hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex justify-center mb-2">
                                <div className="p-2 bg-indigo-100 rounded-lg">
                                    <Activity size={16} className="text-indigo-600" />
                                </div>
                            </div>
                            <p className="text-indigo-600 text-xs font-bold uppercase mb-1">إجمالي الحالات</p>
                            <p className="text-2xl font-black text-indigo-900">{stats.orderCount}</p>
                        </div>
                        <div className="bg-gradient-to-br from-purple-50 to-white p-5 rounded-xl border border-purple-100 text-center hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex justify-center mb-2">
                                <div className="p-2 bg-purple-100 rounded-lg">
                                    <Package size={16} className="text-purple-600" />
                                </div>
                            </div>
                            <p className="text-purple-600 text-xs font-bold uppercase mb-1">إجمالي الوحدات</p>
                            <p className="text-2xl font-black text-purple-900">{stats.totalUnits}</p>
                        </div>
                        <div className="bg-gradient-to-br from-blue-50 to-white p-5 rounded-xl border border-blue-100 text-center hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex justify-center mb-2">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                    <DollarSign size={16} className="text-blue-600" />
                                </div>
                            </div>
                            <p className="text-blue-600 text-xs font-bold uppercase mb-1">متوسط سعر الوحدة</p>
                            <p className="text-2xl font-black text-blue-900">{stats.totalUnits > 0 ? Math.round(stats.deliveredRevenue / stats.totalUnits) : 0}</p>
                        </div>
                        <div className="bg-gradient-to-br from-teal-50 to-white p-5 rounded-xl border border-teal-100 text-center hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex justify-center mb-2">
                                <div className="p-2 bg-teal-100 rounded-lg">
                                    <RefreshCcw size={16} className="text-teal-600" />
                                </div>
                            </div>
                            <p className="text-teal-600 text-xs font-bold uppercase mb-1">نسبة الإرجاع</p>
                            <p className="text-2xl font-black text-teal-900">0%</p>
                        </div>
                    </div>
                </>
            )}

            {/* Financial Analysis Tab Content */}

            {activeTab === 'financial' && (
                <div className="space-y-6">
                    {/* Cash Flow Section */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-emerald-100 rounded-lg">
                                <Banknote size={20} className="text-emerald-600" />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-slate-800">التدفقات النقدية</h3>
                                <p className="text-slate-400 text-xs">Cash Flow Analysis</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-gradient-to-br from-emerald-50 to-white p-5 rounded-xl border border-emerald-100">
                                <div className="flex items-center gap-2 mb-3">
                                    <ArrowUpRight size={18} className="text-emerald-600" />
                                    <span className="text-sm font-medium text-slate-600">المقبوضات</span>
                                </div>
                                <p className="text-2xl font-black text-emerald-700">{financialStats.totalCollections.toLocaleString()} <span className="text-xs font-normal text-slate-400">ج.م</span></p>
                            </div>
                            <div className="bg-gradient-to-br from-rose-50 to-white p-5 rounded-xl border border-rose-100">
                                <div className="flex items-center gap-2 mb-3">
                                    <TrendingDown size={18} className="text-rose-600" />
                                    <span className="text-sm font-medium text-slate-600">المدفوعات</span>
                                </div>
                                <p className="text-2xl font-black text-rose-700">{financialStats.totalPayments.toLocaleString()} <span className="text-xs font-normal text-slate-400">ج.م</span></p>
                            </div>
                            <div className={clsx(
                                "bg-gradient-to-br p-5 rounded-xl border",
                                financialStats.netCashFlow >= 0
                                    ? "from-blue-50 to-white border-blue-100"
                                    : "from-amber-50 to-white border-amber-100"
                            )}>
                                <div className="flex items-center gap-2 mb-3">
                                    <Wallet size={18} className={financialStats.netCashFlow >= 0 ? "text-blue-600" : "text-amber-600"} />
                                    <span className="text-sm font-medium text-slate-600">صافي التدفق</span>
                                </div>
                                <p className={clsx(
                                    "text-2xl font-black",
                                    financialStats.netCashFlow >= 0 ? "text-blue-700" : "text-amber-700"
                                )}>{financialStats.netCashFlow.toLocaleString()} <span className="text-xs font-normal text-slate-400">ج.م</span></p>
                            </div>
                        </div>
                    </div>

                    {/* P&L Section */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Receipt size={20} className="text-blue-600" />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-slate-800">قائمة الدخل</h3>
                                <p className="text-slate-400 text-xs">Profit & Loss Statement</p>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {/* Revenue Row */}
                            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                                <span className="font-medium text-slate-700">إجمالي المبيعات</span>
                                <span className="text-xl font-bold text-slate-800">{financialStats.salesRevenue.toLocaleString()} ج.م</span>
                            </div>
                            {/* COGS Row */}
                            <div className="flex items-center justify-between p-4 bg-rose-50 rounded-xl">
                                <span className="font-medium text-slate-700">تكلفة البضائع المباعة (COGS)</span>
                                <span className="text-xl font-bold text-rose-600">({financialStats.cogs.toLocaleString()}) ج.م</span>
                            </div>
                            {/* Gross Profit Row */}
                            <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-xl border-r-4 border-emerald-500">
                                <div>
                                    <span className="font-bold text-emerald-700">مجمل الربح</span>
                                    <span className="text-xs text-emerald-500 mr-2">(هامش: {financialStats.grossMargin.toFixed(1)}%)</span>
                                </div>
                                <span className="text-xl font-black text-emerald-700">{financialStats.grossProfit.toLocaleString()} ج.م</span>
                            </div>
                            {/* Operating Expenses Row */}
                            <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl">
                                <span className="font-medium text-slate-700">مصروفات التشغيل</span>
                                <span className="text-xl font-bold text-amber-600">({financialStats.operatingExpenses.toLocaleString()}) ج.م</span>
                            </div>
                            {/* Operating Income Row */}
                            <div className={clsx(
                                "flex items-center justify-between p-4 rounded-xl border-r-4",
                                financialStats.operatingIncome >= 0
                                    ? "bg-blue-50 border-blue-500"
                                    : "bg-rose-50 border-rose-500"
                            )}>
                                <div>
                                    <span className={clsx("font-bold", financialStats.operatingIncome >= 0 ? "text-blue-700" : "text-rose-700")}>صافي الربح التشغيلي</span>
                                    <span className={clsx("text-xs mr-2", financialStats.operatingIncome >= 0 ? "text-blue-500" : "text-rose-500")}>(هامش: {financialStats.operatingMargin.toFixed(1)}%)</span>
                                </div>
                                <span className={clsx("text-xl font-black", financialStats.operatingIncome >= 0 ? "text-blue-700" : "text-rose-700")}>{financialStats.operatingIncome.toLocaleString()} ج.م</span>
                            </div>
                        </div>
                    </div>

                    {/* Receivables & Payables Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Accounts Receivable */}
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-amber-100 rounded-lg">
                                    <CreditCard size={20} className="text-amber-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-slate-800">الذمم المدينة</h3>
                                    <p className="text-slate-400 text-xs">Accounts Receivable</p>
                                </div>
                            </div>

                            <div className="text-center mb-6 p-4 bg-gradient-to-br from-amber-50 to-white rounded-xl border border-amber-100">
                                <p className="text-3xl font-black text-amber-700">{financialStats.totalReceivables.toLocaleString()} <span className="text-sm font-normal">ج.م</span></p>
                                <p className="text-xs text-slate-400 mt-1">إجمالي المستحق على العملاء</p>
                            </div>

                            {/* Aging Analysis */}
                            <div className="space-y-3">
                                <p className="text-sm font-bold text-slate-600 mb-3">أعمار المديونية</p>
                                <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                                        <span className="text-sm text-slate-600">0-30 يوم</span>
                                    </div>
                                    <span className="font-bold text-emerald-700">{financialStats.aging0to30.toLocaleString()} ج.م</span>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                                        <span className="text-sm text-slate-600">30-60 يوم</span>
                                    </div>
                                    <span className="font-bold text-blue-700">{financialStats.aging30to60.toLocaleString()} ج.م</span>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                                        <span className="text-sm text-slate-600">60-90 يوم</span>
                                    </div>
                                    <span className="font-bold text-amber-700">{financialStats.aging60to90.toLocaleString()} ج.م</span>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-rose-50 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle size={14} className="text-rose-500" />
                                        <span className="text-sm text-slate-600">+90 يوم</span>
                                    </div>
                                    <span className="font-bold text-rose-700">{financialStats.aging90plus.toLocaleString()} ج.م</span>
                                </div>
                            </div>

                            {/* DSO */}
                            <div className="mt-4 p-3 bg-slate-50 rounded-lg flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Clock size={16} className="text-slate-400" />
                                    <span className="text-sm text-slate-600">متوسط أيام التحصيل (DSO)</span>
                                </div>
                                <span className="font-bold text-slate-800">{financialStats.dso} يوم</span>
                            </div>
                        </div>

                        {/* Accounts Payable */}
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-purple-100 rounded-lg">
                                    <PiggyBank size={20} className="text-purple-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-slate-800">الذمم الدائنة</h3>
                                    <p className="text-slate-400 text-xs">Accounts Payable</p>
                                </div>
                            </div>

                            <div className="text-center p-6 bg-gradient-to-br from-purple-50 to-white rounded-xl border border-purple-100">
                                <p className="text-3xl font-black text-purple-700">{financialStats.totalPayables.toLocaleString()} <span className="text-sm font-normal">ج.م</span></p>
                                <p className="text-xs text-slate-400 mt-1">المستحق للموردين والمصممين</p>
                            </div>

                            {/* Net Position */}
                            <div className="mt-6 p-4 bg-slate-900 rounded-xl text-white">
                                <p className="text-sm text-slate-400 mb-2">صافي المركز المالي</p>
                                <p className={clsx(
                                    "text-2xl font-black",
                                    (financialStats.totalReceivables - financialStats.totalPayables) >= 0 ? "text-emerald-400" : "text-rose-400"
                                )}>
                                    {(financialStats.totalReceivables - financialStats.totalPayables).toLocaleString()} ج.م
                                </p>
                                <p className="text-xs text-slate-500 mt-1">الذمم المدينة - الذمم الدائنة</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

