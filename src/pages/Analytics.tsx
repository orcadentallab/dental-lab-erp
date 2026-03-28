/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { subMonths, startOfMonth, endOfMonth, format } from 'date-fns';
import { analyticsService } from '../services/supabase/analyticsService';
import { FileText, TrendingUp, Zap, ArrowDownRight, Wallet, Activity, CreditCard, PiggyBank, Package, BarChart3, Users, DollarSign, RefreshCcw, ArrowUpRight, Receipt, TrendingDown, Banknote, Calendar, Award } from 'lucide-react';
import clsx from 'clsx';
import React from 'react';
import StatementTab from '../components/finance/StatementTab';
import { db, type Order, type Transaction, type Doctor, type Supplier, type User, type Service } from '../services/db';

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
        totalUnitsRevenue: 0,
        returnCount: 0,
        topExpenseCategory: '',
        topExpenseAmount: 0
    });
    const [topDoctors, setTopDoctors] = useState<{ name: string; revenue: number; count: number }[]>([]);
    const [topServices, setTopServices] = useState<{ name: string; count: number; revenue: number }[]>([]);

    // Tab state
    const [activeTab, setActiveTab] = useState<'overview' | 'financial' | 'service_analysis' | 'expense_analysis'>('overview');

    // Analysis Reports State (Lazy Loaded)
    const [orders, setOrders] = useState<Order[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [isAnalysisDataLoaded, setIsAnalysisDataLoaded] = useState(false);

    useEffect(() => {
        if (['service_analysis', 'expense_analysis'].includes(activeTab) && !isAnalysisDataLoaded) {
            Promise.all([
                db.getAllOrdersUnpaginated(),
                db.getTransactions(),
                db.getDoctors(),
                db.getSuppliers(),
                db.getUsers(),
                db.getServices()
            ]).then(([ordersData, txData, docs, sups, users, servs]) => {
                setOrders(ordersData);
                setTransactions(txData);
                setDoctors(docs);
                setSuppliers(sups);
                setDesigners(users.filter(u => u.role === 'designer'));
                setServices(servs);
                setIsAnalysisDataLoaded(true);
            }).catch(console.error);
        }
    }, [activeTab, isAnalysisDataLoaded]);

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

    const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'current_month' | 'prev_month' | 'prev_prev_month' | 'year' | 'all' | 'custom'>('current_month');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    const { startDate, endDate } = useMemo(() => {
        if (dateRange === 'custom') {
            return { startDate: customStartDate, endDate: customEndDate };
        }

        const today = new Date();
        const formatDate = (d: Date) => format(d, 'yyyy-MM-dd');

        switch (dateRange) {
            case 'today':
                return { startDate: formatDate(today), endDate: formatDate(today) };
            case 'week': {
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - 7);
                return { startDate: formatDate(weekStart), endDate: formatDate(today) };
            }
            case 'month': { // Last 30 days
                const monthAgo = new Date(today);
                monthAgo.setDate(today.getDate() - 30);
                return { startDate: formatDate(monthAgo), endDate: formatDate(today) };
            }
            case 'current_month':
                return {
                    startDate: formatDate(startOfMonth(today)),
                    endDate: formatDate(endOfMonth(today))
                };
            case 'prev_month': {
                const prevDate = subMonths(today, 1);
                return {
                    startDate: formatDate(startOfMonth(prevDate)),
                    endDate: formatDate(endOfMonth(prevDate))
                };
            }
            case 'prev_prev_month': {
                const prevPrevDate = subMonths(today, 2);
                return {
                    startDate: formatDate(startOfMonth(prevPrevDate)),
                    endDate: formatDate(endOfMonth(prevPrevDate))
                };
            }
            case 'year':
                return {
                    startDate: formatDate(new Date(today.getFullYear(), 0, 1)),
                    endDate: formatDate(new Date(today.getFullYear(), 11, 31))
                };
            case 'all':
                return { startDate: '', endDate: '' };
        }
    }, [dateRange, customStartDate, customEndDate]);


    /**
     * ARCHITECTURE: SERVER-SIDE AGGREGATION
     * 
     * Previously, this page fetched ALL orders (5000+) and ALL transactions
     * into the browser, then computed every metric via JavaScript loops.
     * 
     * Now, a single RPC call (get_analytics_summary) returns pre-aggregated
     * numbers computed server-side using SQL FILTER/SUM/COUNT aggregates.
     * 
     * WHAT IS NOT AFFECTED:
     * - Invoice generation continues to use fetchFullEntityStatement()
     * - Doctor statements continue to use fetchFullEntityStatement()
     * - Full exports continue to use fetchAllOrdersForExport()
     * - Paginated order browsing uses getOrders(page, limit, filters)
     */
    const calculateStats = useCallback(async () => {
        try {
            // Date params — null means "all time" for the RPC
            const rpcStart = dateRange === 'all' ? undefined : startDate || undefined;
            const rpcEnd = dateRange === 'all' ? undefined : endDate || undefined;

            // 4 lightweight RPC calls instead of 3 massive SELECTs
            const [summary, doctors, services, allServices, expenseCategories] = await Promise.all([
                analyticsService.getSummary(rpcStart, rpcEnd),
                analyticsService.getTopDoctors(rpcStart, rpcEnd),
                analyticsService.getTopServices(rpcStart, rpcEnd, 5),
                analyticsService.getTopServices(rpcStart, rpcEnd, 5000), // Fetch all active services to compute true totals
                analyticsService.getTopExpenseCategories(rpcStart, rpcEnd, 1) // Only need the top 1
            ]);

            // Derive values from the compact JSON response
            const grossProfit = summary.total_sales_value - summary.total_cost_of_goods;
            const netProfit = grossProfit - summary.operating_expenses;
            const topExpenseCategory = expenseCategories[0]?.category || 'None';
            const topExpenseAmount = expenseCategories[0]?.total || 0;
            
            // Calculate accurate unit metrics from all services
            const totalUnits = allServices.reduce((sum, s) => sum + Number(s.count || 0), 0);
            const totalUnitsRevenue = allServices.reduce((sum, s) => sum + Number(s.revenue || 0), 0);

            setStats({
                totalRevenue: summary.total_income,
                deliveredRevenue: summary.total_sales_value,
                grossProfit,
                netProfit,
                operatingExpenses: summary.operating_expenses,
                productionCosts: summary.production_costs,
                pendingRevenue: summary.total_sales_value - summary.total_income,
                orderCount: summary.total_order_count, // Use total instead of just completed
                activeOrders: summary.active_order_count,
                totalUnits,
                totalUnitsRevenue,
                returnCount: summary.return_count,
                topExpenseCategory,
                topExpenseAmount
            });

            setTopDoctors(doctors);
            setTopServices(services);

            // ========== FINANCIAL ANALYSIS (all from same RPC response) ==========
            const totalCollections = summary.total_income;
            const totalPayments = summary.total_expenses;
            const salesRevenue = summary.total_sales_value;
            const cogs = summary.total_cost_of_goods;
            const grossMargin = salesRevenue > 0 ? (grossProfit / salesRevenue) * 100 : 0;
            const operatingIncome = grossProfit - summary.operating_expenses;
            const operatingMargin = salesRevenue > 0 ? (operatingIncome / salesRevenue) * 100 : 0;

            // DSO calculation
            const daysInPeriod = dateRange === 'month' ? 30 : dateRange === 'year' ? 365 : 30;
            const avgDailyRevenue = salesRevenue / daysInPeriod;
            const dso = avgDailyRevenue > 0 ? Math.round(summary.total_receivables / avgDailyRevenue) : 0;

            setFinancialStats({
                totalCollections,
                totalPayments,
                netCashFlow: totalCollections - totalPayments,
                salesRevenue,
                cogs,
                grossProfit,
                grossMargin,
                operatingExpenses: summary.operating_expenses,
                operatingIncome,
                operatingMargin,
                totalReceivables: summary.total_receivables,
                aging0to30: summary.aging_0_30,
                aging30to60: summary.aging_31_60,
                aging60to90: summary.aging_61_90,
                aging90plus: summary.aging_90_plus,
                dso,
                totalPayables: summary.total_payables
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
        week: 'آخر 7 أيام',
        month: 'آخر 30 يوم',
        current_month: format(new Date(), 'MMMM'), // e.g. مارس
        prev_month: format(subMonths(new Date(), 1), 'MMMM'), // e.g. فبراير
        prev_prev_month: format(subMonths(new Date(), 2), 'MMMM'), // e.g. يناير
        year: 'هذا العام',
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
                            {(['today', 'week', 'month', 'current_month', 'prev_month', 'prev_prev_month', 'year', 'all'] as const).map((range) => (
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
                <div className="flex flex-col md:flex-row gap-2">
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
                    <button
                        onClick={() => setActiveTab('service_analysis')}
                        className={clsx(
                            "flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2",
                            activeTab === 'service_analysis'
                                ? "bg-teal-600 text-white shadow-lg"
                                : "bg-gray-50 text-slate-600 hover:bg-slate-100"
                        )}
                    >
                        <Package size={18} />
                        تحليل الخدمات
                    </button>
                    <button
                        onClick={() => setActiveTab('expense_analysis')}
                        className={clsx(
                            "flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2",
                            activeTab === 'expense_analysis'
                                ? "bg-rose-600 text-white shadow-lg"
                                : "bg-gray-50 text-slate-600 hover:bg-slate-100"
                        )}
                    >
                        <ArrowDownRight size={18} />
                        تحليل المصروفات
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
                                            {/* eslint-disable-next-line -- Dynamic width required for progress bar */}
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
                                                {/* eslint-disable-next-line -- Dynamic width required for progress bar */}
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
                                                        idx === 2 ? "bg-teal-100 text-teal-600" :
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
                                            {/* eslint-disable-next-line -- Dynamic width required for progress bar */}
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
                        <div className="bg-gradient-to-br from-teal-50 to-white p-5 rounded-xl border border-teal-100 text-center hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex justify-center mb-2">
                                <div className="p-2 bg-teal-100 rounded-lg">
                                    <Package size={16} className="text-teal-600" />
                                </div>
                            </div>
                            <p className="text-teal-600 text-xs font-bold uppercase mb-1">إجمالي الوحدات</p>
                            <p className="text-2xl font-black text-teal-900">{stats.totalUnits}</p>
                        </div>
                        <div className="bg-gradient-to-br from-blue-50 to-white p-5 rounded-xl border border-blue-100 text-center hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex justify-center mb-2">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                    <DollarSign size={16} className="text-blue-600" />
                                </div>
                            </div>
                            <p className="text-blue-600 text-xs font-bold uppercase mb-1">متوسط سعر الوحدة</p>
                            <p className="text-2xl font-black text-blue-900">{stats.totalUnits > 0 ? Math.round(stats.totalUnitsRevenue / stats.totalUnits) : 0}</p>
                        </div>
                        <div className="bg-gradient-to-br from-teal-50 to-white p-5 rounded-xl border border-teal-100 text-center hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex justify-center mb-2">
                                <div className="p-2 bg-teal-100 rounded-lg">
                                    <RefreshCcw size={16} className="text-teal-600" />
                                </div>
                            </div>
                            <p className="text-teal-600 text-xs font-bold uppercase mb-1">نسبة الإرجاع</p>
                            <div className="flex flex-col items-center">
                                <p className="text-2xl font-black text-teal-900">
                                    {stats.orderCount > 0
                                        ? ((stats.returnCount / stats.orderCount) * 100).toFixed(1)
                                        : 0}%
                                </p>
                                <span className="text-xs text-teal-600 font-medium bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full mt-1">
                                    {stats.returnCount} حالة
                                </span>
                            </div>
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
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-amber-100 rounded-xl">
                                        <CreditCard size={22} className="text-amber-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg text-slate-800">الذمم المدينة</h3>
                                        <p className="text-slate-400 text-xs font-medium">Accounts Receivable</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-3xl font-black text-slate-800">{financialStats.totalReceivables.toLocaleString()}</p>
                                    <p className="text-xs text-slate-400 font-medium mt-1">إجمالي المستحق على العملاء</p>
                                </div>
                            </div>

                            {/* Aging Visual Analysis */}
                            <div className="flex-1 flex flex-col justify-center">
                                <div className="space-y-4">
                                    <div className="flex justify-between items-end mb-1">
                                        <p className="text-sm font-bold text-slate-700">تحليل أعمار الديون</p>
                                        <span className="text-xs text-slate-400 font-mono">DSO: {financialStats.dso} days</span>
                                    </div>

                                    {/* Segmented Progress Bar */}
                                    <div className="h-4 bg-slate-100 rounded-full flex overflow-hidden">
                                        {[
                                            { val: financialStats.aging0to30, color: 'bg-emerald-500', label: '0-30' },
                                            { val: financialStats.aging30to60, color: 'bg-blue-500', label: '30-60' },
                                            { val: financialStats.aging60to90, color: 'bg-amber-500', label: '60-90' },
                                            { val: financialStats.aging90plus, color: 'bg-rose-500', label: '+90' }
                                        ].map((segment, idx) => {
                                            const width = financialStats.totalReceivables > 0
                                                ? (segment.val / financialStats.totalReceivables) * 100
                                                : 0;
                                            if (width === 0) return null;
                                            return (
                                                // eslint-disable-next-line -- Dynamic width required for aging bar
                                                <div
                                                    key={idx}
                                                    className={segment.color}
                                                    style={{ width: `${width}%` }}
                                                    title={`${segment.label} يوم: ${segment.val.toLocaleString()}`}
                                                />
                                            );
                                        })}
                                    </div>

                                    {/* Legend / Breakdown */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                                        <div className="bg-emerald-50 p-2 rounded-lg border border-emerald-100/50">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                                <span className="text-[10px] text-slate-500 font-bold">0-30 يوم</span>
                                            </div>
                                            <p className="text-sm font-bold text-emerald-700">{financialStats.aging0to30.toLocaleString()}</p>
                                        </div>
                                        <div className="bg-blue-50 p-2 rounded-lg border border-blue-100/50">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                                <span className="text-[10px] text-slate-500 font-bold">30-60 يوم</span>
                                            </div>
                                            <p className="text-sm font-bold text-blue-700">{financialStats.aging30to60.toLocaleString()}</p>
                                        </div>
                                        <div className="bg-amber-50 p-2 rounded-lg border border-amber-100/50">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                                                <span className="text-[10px] text-slate-500 font-bold">60-90 يوم</span>
                                            </div>
                                            <p className="text-sm font-bold text-amber-700">{financialStats.aging60to90.toLocaleString()}</p>
                                        </div>
                                        <div className="bg-rose-50 p-2 rounded-lg border border-rose-100/50">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                                                <span className="text-[10px] text-slate-500 font-bold">+90 يوم</span>
                                            </div>
                                            <p className="text-sm font-bold text-rose-700">{financialStats.aging90plus.toLocaleString()}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Accounts Payable */}
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-teal-100 rounded-xl">
                                        <PiggyBank size={22} className="text-teal-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg text-slate-800">الذمم الدائنة</h3>
                                        <p className="text-slate-400 text-xs font-medium">Accounts Payable</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-3xl font-black text-teal-700">{financialStats.totalPayables.toLocaleString()}</p>
                                    <p className="text-xs text-slate-400 font-medium mt-1">المستحق للموردين</p>
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col justify-end">
                                {/* Net Position Card */}
                                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                                        <Wallet size={16} className="text-slate-400" />
                                        صافي المركز المالي (Net Position)
                                    </h4>

                                    <div className="flex items-center gap-4 text-sm mb-4">
                                        <div className="flex-1">
                                            <p className="text-xs text-slate-400 mb-1">الذمم المدينة (+)</p>
                                            <p className="font-bold text-slate-700">{financialStats.totalReceivables.toLocaleString()}</p>
                                        </div>
                                        <div className="text-slate-300">-</div>
                                        <div className="flex-1 text-left">
                                            <p className="text-xs text-slate-400 mb-1">الذمم الدائنة (-)</p>
                                            <p className="font-bold text-rose-600">{financialStats.totalPayables.toLocaleString()}</p>
                                        </div>
                                    </div>

                                    <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
                                        <span className="text-xs font-bold text-slate-500">الصافي:</span>
                                        <span className={clsx(
                                            "text-xl font-black",
                                            (financialStats.totalReceivables - financialStats.totalPayables) >= 0 ? "text-emerald-600" : "text-rose-600"
                                        )}>
                                            {(financialStats.totalReceivables - financialStats.totalPayables).toLocaleString()} ج.م
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Service Analysis Tab Content */}
            {activeTab === 'service_analysis' && (
                <StatementTab
                    type="service"
                    orders={orders}
                    transactions={transactions}
                    doctors={doctors}
                    suppliers={suppliers}
                    designers={designers}
                    services={services}
                />
            )}

            {/* Expense Analysis Tab Content */}
            {activeTab === 'expense_analysis' && (
                <StatementTab
                    type="expense"
                    orders={orders}
                    transactions={transactions}
                    doctors={doctors}
                    suppliers={suppliers}
                    designers={designers}
                    services={services}
                />
            )}
        </div>
    );
}

