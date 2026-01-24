/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useCallback } from 'react';
import { db } from '../services/db';
import { TrendingUp, DollarSign, Activity, Wallet, Calendar, ArrowDownRight, Award, Zap } from 'lucide-react';
import clsx from 'clsx';

export default function Analytics() {
    const [stats, setStats] = useState({
        totalRevenue: 0,
        deliveredRevenue: 0,
        grossProfit: 0,
        netProfit: 0,
        totalExpenses: 0,
        pendingRevenue: 0,
        orderCount: 0,
        activeOrders: 0,
        totalUnits: 0,
        topExpenseCategory: '',
        topExpenseAmount: 0
    });
    const [topDoctors, setTopDoctors] = useState<{ name: string; revenue: number; count: number }[]>([]);


    // Date Range Logic
    const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('month');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');



    // Date Presets
    useEffect(() => {
        const today = new Date();
        let start = '';
        let end = '';

        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        switch (dateRange) {
            case 'today':
                start = end = formatDate(today);
                break;
            case 'week':
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - 7);
                start = formatDate(weekStart);
                end = formatDate(today);
                break;
            case 'month':
                start = formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
                end = formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
                break;
            case 'year':
                start = formatDate(new Date(today.getFullYear(), 0, 1));
                end = formatDate(new Date(today.getFullYear(), 11, 31));
                break;
        }

        if (dateRange !== 'custom') {
            setStartDate(start);
            setEndDate(end);
        }
    }, [dateRange]);

    const calculateStats = useCallback(async () => {

        try {
            const [orders, transactions, doctors] = await Promise.all([
                db.getOrders(),
                db.getTransactions(),
                db.getDoctors()
            ]);

            const isInRange = (dateStr: string) => {
                if (!dateStr) return false;
                const d = dateStr.split('T')[0];
                return d >= startDate && d <= endDate;
            };

            const filteredOrders = orders.filter(o => {
                const status = (o.status || '').toLowerCase();
                const isCompleted = status === 'delivered' || status === 'completed';
                const date = isCompleted ? (o.deliveryDate || o.createdAt) : o.createdAt;
                return isInRange(date);
            });

            const filteredTransactions = transactions.filter(t => isInRange(t.date));

            const completedOrders = filteredOrders.filter(o =>
                ['delivered', 'completed'].includes((o.status || '').toLowerCase())
            );

            // 1. Total Sales Value
            const totalSalesValue = completedOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

            // 2. Units
            const totalUnits = completedOrders.reduce((sum, o) => {
                return sum + (o.items || []).reduce((itemSum, item: any) => {
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


            const expenseCategories = new Map<string, number>();
            const totalExpenses = filteredTransactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => {
                    const cat = t.category || 'Other';
                    expenseCategories.set(cat, (expenseCategories.get(cat) || 0) + (t.amount || 0));
                    return sum + (t.amount || 0);
                }, 0);

            let topExpenseCategory = 'None';
            let topExpenseAmount = 0;

            for (const [cat, amount] of expenseCategories.entries()) {
                if (amount > topExpenseAmount) {
                    topExpenseAmount = amount;
                    topExpenseCategory = cat;
                }
            }

            const netProfit = grossProfit - totalExpenses;

            setStats({
                totalRevenue: collectedRevenue,
                deliveredRevenue: totalSalesValue,
                grossProfit,
                netProfit,
                totalExpenses,
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
                    const doc = doctors.find(d => d.id === id);
                    return { name: doc ? doc.name : 'Unknown', ...stat };
                })
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5);
            setTopDoctors(sortedDoctors);



        } catch (error) {
            console.error('Error loading analytics:', error);
        } finally {

        }
    }, [startDate, endDate]);

    useEffect(() => {
        if (startDate && endDate) calculateStats();
    }, [startDate, endDate, calculateStats]);

    const KPICard = ({ title, value, subtext, icon: Icon, type }: any) => {
        const styles = {
            profit: { bg: 'bg-emerald-50', text: 'text-emerald-700', iconBg: 'bg-emerald-500', trend: 'text-emerald-600' },
            revenue: { bg: 'bg-blue-50', text: 'text-blue-700', iconBg: 'bg-blue-500', trend: 'text-blue-600' },
            expense: { bg: 'bg-rose-50', text: 'text-rose-700', iconBg: 'bg-rose-500', trend: 'text-rose-600' },
            neutral: { bg: 'bg-indigo-50', text: 'text-indigo-700', iconBg: 'bg-indigo-500', trend: 'text-indigo-600' },
        }[type as string] || { bg: 'bg-gray-50', text: 'text-gray-700', iconBg: 'bg-gray-500', trend: 'text-gray-600' };

        return (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all duration-300 group">
                <div className="flex justify-between items-start mb-4">
                    <div className={clsx("p-3 rounded-xl text-white transition-transform group-hover:scale-110 duration-300", styles.iconBg)}>
                        <Icon size={24} />
                    </div>
                    <span className={clsx("text-xs font-bold px-2 py-1 rounded-lg", styles.bg, styles.text)}>
                        {type === 'profit' ? '+12.5%' : (type === 'expense' ? '-2.3%' : '+5.0%')}
                        <span className="opacity-50 font-normal mr-1">vs Last Period</span>
                    </span>
                </div>
                <h3 className="text-3xl font-black text-gray-800 tracking-tight mb-1">
                    {value.toLocaleString()} <span className="text-sm font-medium text-gray-400">ج.م</span>
                </h3>
                <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
                <p className="text-xs text-gray-400">{subtext}</p>
            </div>
        );
    };

    return (
        <div className="space-y-8">
            {/* Header & Controls */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-8 rounded-3xl shadow-xl text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

                <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
                    <div>
                        <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
                            <Activity className="text-blue-400" />
                            مركز التحكم والتحليلات
                        </h1>
                        <p className="text-slate-400 max-w-xl">
                            نظرة شاملة على أداء المعمل المالي والتشغيلي. تابع الأرباح، راقب المصروفات، وحلل نمو العملاء لحظة بلحظة.
                        </p>
                    </div>

                    {/* Smart Date Picker */}
                    <div className="bg-white/10 backdrop-blur-md p-1.5 rounded-2xl flex items-center gap-1 border border-white/10">
                        {['today', 'week', 'month', 'year'].map((range) => (
                            <button
                                key={range}
                                onClick={() => setDateRange(range as any)}
                                className={clsx(
                                    "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                                    dateRange === range
                                        ? "bg-white text-slate-900 shadow-lg"
                                        : "text-slate-300 hover:bg-white/10"
                                )}
                            >
                                {range === 'today' ? 'اليوم' : (range === 'week' ? 'أسبوع' : (range === 'month' ? 'شهر' : 'سنة'))}
                            </button>
                        ))}
                        <div className="w-px h-6 bg-white/20 mx-1"></div>
                        <button
                            onClick={() => setDateRange('custom')}
                            className={clsx("p-2 rounded-xl transition-colors", dateRange === 'custom' ? "bg-blue-500 text-white" : "text-white/50 hover:text-white")}
                            aria-label="Custom Date Range"
                            title="تاريخ مخصص"
                        >
                            <Calendar size={18} />
                        </button>
                    </div>
                </div>

                {/* Custom Date Inputs (Conditional) */}
                {dateRange === 'custom' && (
                    <div className="mt-6 flex gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <input
                            type="date"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                            className="bg-white/10 border-white/20 text-white rounded-xl focus:ring-blue-500"
                            aria-label="Start Date"
                        />
                        <span className="text-white/50 self-center">to</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={e => setEndDate(e.target.value)}
                            className="bg-white/10 border-white/20 text-white rounded-xl focus:ring-blue-500"
                            aria-label="End Date"
                        />
                    </div>
                )}
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    title="المبيعات (Sales)"
                    value={stats.deliveredRevenue}
                    subtext="قيمة الأعمال المسلمة (Work Done)"
                    icon={TrendingUp}
                    type="revenue" // Blue (Growth)
                />
                <KPICard
                    title="التحصيل الفعلي (Collected)"
                    value={stats.totalRevenue}
                    subtext="النقدية المستلمة (Cash In)"
                    icon={DollarSign}
                    type="profit" // Green (Cash)
                />
                <KPICard
                    title="المصروفات (Expenses)"
                    value={stats.totalExpenses}
                    subtext="المصروفات التشغيلية"
                    icon={ArrowDownRight}
                    type="expense" // Red
                />
                <KPICard
                    title="صافي الربح"
                    value={stats.netProfit}
                    subtext="المبيعات - (التكلفة + المصروفات)"
                    icon={Wallet}
                    type={stats.netProfit >= 0 ? 'profit' : 'expense'}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Insights Panel */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="bg-gradient-to-b from-indigo-50 to-white p-6 rounded-3xl border border-indigo-100 shadow-sm h-full">
                        <div className="flex items-center gap-2 mb-6 text-indigo-900">
                            <Zap size={20} className="text-amber-500 fill-amber-500" />
                            <h3 className="font-bold text-lg">تحليل ذكي (AI Insights)</h3>
                        </div>

                        <div className="space-y-4">
                            {/* Insight 1 */}
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-indigo-50">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs font-bold text-slate-400 uppercase">هامش الربح</span>
                                    <span className={clsx("text-xs font-bold px-2 py-0.5 rounded-full", stats.deliveredRevenue > 0 && (stats.netProfit / stats.deliveredRevenue) > 0.3 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                                        {stats.deliveredRevenue > 0 && (stats.netProfit / stats.deliveredRevenue) > 0.3 ? 'Excellent' : 'Average'}
                                    </span>
                                </div>
                                <div className="text-2xl font-black text-slate-800 mb-1">
                                    {stats.deliveredRevenue > 0 ? ((stats.netProfit / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    هامش الربح التشغيلي جيد. حافظ على نسبة المصروفات أقل من 30% لزيادة العائد.
                                </p>
                            </div>

                            {/* Insight 2 */}
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-indigo-50">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs font-bold text-slate-400 uppercase">أداء التحصيل</span>
                                </div>
                                <div className="text-2xl font-black text-slate-800 mb-1">
                                    {stats.deliveredRevenue > 0 ? ((stats.totalRevenue / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                </div>
                                <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
                                    <div className="bg-blue-500 h-full rounded-full" ref={(el) => { if (el) el.style.width = `${Math.min(100, (stats.totalRevenue / (stats.deliveredRevenue || 1)) * 100)}%` }}></div>
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    نسبة التحصيل من الأعمال المسلمة.
                                </p>
                            </div>

                            {/* Insight 3: Expense Analysis */}
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-indigo-50">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs font-bold text-slate-400 uppercase">كفاءة المصروفات</span>
                                    <span className={clsx("text-xs font-bold px-2 py-0.5 rounded-full", stats.deliveredRevenue > 0 && (stats.totalExpenses / stats.deliveredRevenue) < 0.3 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                                        {stats.deliveredRevenue > 0 && (stats.totalExpenses / stats.deliveredRevenue) < 0.3 ? 'Efficient' : 'High'}
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="text-2xl font-black text-slate-800">
                                        {stats.deliveredRevenue > 0 ? ((stats.totalExpenses / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                    </span>
                                    <span className="text-xs text-slate-400">من الدخل</span>
                                </div>

                                {stats.topExpenseCategory && stats.topExpenseAmount > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-50">
                                        <p className="text-[10px] text-slate-400 mb-1">الأكثر استهلاكاً للميزانية:</p>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-slate-700 capitalize">{stats.topExpenseCategory}</span>
                                            <span className="font-medium text-slate-500">{stats.topExpenseAmount.toLocaleString()} ج.م</span>
                                        </div>
                                    </div>
                                )}

                                <p className="text-xs text-slate-500 mt-2">
                                    {stats.totalExpenses === 0 ? 'لا توجد مصروفات مسجلة.' : 'راقب بنود الصرف الأعلى للتحكم في التكلفة.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Top Doctors (Enhanced) */}
                <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                    <div className="flex justify-between items-center mb-8">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">أكثر 5 عملاء نشاطاً</h3>
                            <p className="text-slate-400 text-sm">بناءً على إجمالي الإيرادات في الفترة المحددة</p>
                        </div>
                        <div className="p-2 bg-slate-50 rounded-xl text-slate-400">
                            <Award size={20} />
                        </div>
                    </div>

                    <div className="space-y-6">
                        {topDoctors.map((doc, idx) => {
                            const maxVal = topDoctors[0]?.revenue || 1;
                            const percent = (doc.revenue / maxVal) * 100;
                            return (
                                <div key={idx} className="group">
                                    <div className="flex justify-between items-end mb-2">
                                        <div className="flex items-center gap-3">
                                            <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm", idx === 0 ? "bg-amber-100 text-amber-600" : (idx === 1 ? "bg-slate-100 text-slate-600" : (idx === 2 ? "bg-orange-50 text-orange-700" : "bg-gray-50 text-gray-400")))}>
                                                {idx + 1}
                                            </div>
                                            <span className="font-bold text-slate-700">{doc.name}</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="block font-bold text-slate-800">{doc.revenue.toLocaleString()} ج.م</span>
                                            <span className="text-[10px] text-slate-400">{doc.count} cases</span>
                                        </div>
                                    </div>
                                    <div className="w-full bg-gray-50 h-3 rounded-full overflow-hidden">
                                        <div
                                            className={clsx("h-full rounded-full transition-all duration-1000 ease-out group-hover:bg-opacity-80", idx === 0 ? "bg-amber-400" : "bg-blue-500")}
                                            ref={(el) => { if (el) el.style.width = `${percent}%` }}
                                        ></div>
                                    </div>
                                </div>
                            );
                        })}
                        {topDoctors.length === 0 && <div className="text-center py-10 text-slate-400">لا توجد بيانات كافية للتحليل</div>}
                    </div>
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 text-center">
                    <p className="text-indigo-400 text-xs font-bold uppercase mb-1">إجمالي الحالات</p>
                    <p className="text-2xl font-black text-indigo-900">{stats.orderCount}</p>
                </div>
                <div className="bg-purple-50/50 p-4 rounded-2xl border border-purple-100 text-center">
                    <p className="text-purple-400 text-xs font-bold uppercase mb-1">إجمالي الوحدات</p>
                    <p className="text-2xl font-black text-purple-900">{stats.totalUnits}</p>
                </div>
                <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 text-center">
                    <p className="text-blue-400 text-xs font-bold uppercase mb-1">متوسط سعر الوحدة</p>
                    <p className="text-2xl font-black text-blue-900">{stats.totalUnits > 0 ? Math.round(stats.deliveredRevenue / stats.totalUnits) : 0}</p>
                </div>
                <div className="bg-teal-50/50 p-4 rounded-2xl border border-teal-100 text-center">
                    <p className="text-teal-400 text-xs font-bold uppercase mb-1">نسبة الإرجاع</p>
                    <p className="text-2xl font-black text-teal-900">0%</p>
                </div>
            </div>
        </div>
    );
}
