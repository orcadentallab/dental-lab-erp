import { useEffect, useState } from 'react';
import { db } from '../services/db';
import { TrendingUp, DollarSign, Activity, Wallet, FileText, Layers } from 'lucide-react';

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
        totalUnits: 0
    });
    const [topDoctors, setTopDoctors] = useState<{ name: string; revenue: number; count: number }[]>([]);
    const [topServices, setTopServices] = useState<{ name: string; count: number }[]>([]);

    // Default to current month
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    const [startDate, setStartDate] = useState(firstDay);
    const [endDate, setEndDate] = useState(lastDay);

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        calculateStats();
    }, [startDate, endDate]);

    const calculateStats = async () => {
        setIsLoading(true);
        try {
            const [orders, transactions, doctors] = await Promise.all([
                db.getOrders(),
                db.getTransactions(),
                db.getDoctors()
            ]);

            // Filter by Date
            const isInRange = (dateStr: string) => {
                if (!dateStr) return false;
                const d = dateStr.split('T')[0];
                return d >= startDate && d <= endDate;
            };

            const filteredOrders = orders.filter(o => {
                const status = (o.status || '').toLowerCase();
                const isCompleted = status === 'delivered' || status === 'completed';
                // For Sales/Performance: Use Delivery Date if delivered, else CreatedAt?
                const date = isCompleted ? (o.deliveryDate || o.createdAt) : o.createdAt;
                return isInRange(date);
            });

            // For Cash Flow: Filter transactions by date
            const filteredTransactions = transactions.filter(t => isInRange(t.date));

            const completedOrders = filteredOrders.filter(o => {
                const status = (o.status || '').toLowerCase();
                return status === 'delivered' || status === 'completed';
            });

            // --- KPIs ---

            // 1. Total Sales Value (Delivered Work Value in period)
            const totalSalesValue = completedOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

            // 2. Total Units/Services Count
            const totalUnits = completedOrders.reduce((sum, o) => {
                return sum + (o.items || []).reduce((itemSum, item: any) => {
                    const count = item.teethNumbers?.length || 1;
                    return itemSum + count;
                }, 0);
            }, 0);

            // 3. Collected Revenue (Cash Basis)
            const collectedRevenue = filteredTransactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            // 4. Profit Calculation
            const totalCostOfGoods = completedOrders.reduce((sum, o) => sum + (o.cost || 0), 0);
            const grossProfit = totalSalesValue - totalCostOfGoods;

            const totalExpenses = filteredTransactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            const netProfit = grossProfit - totalExpenses;

            setStats({
                totalRevenue: collectedRevenue,
                deliveredRevenue: totalSalesValue,
                grossProfit,
                netProfit,
                totalExpenses,
                pendingRevenue: totalSalesValue - collectedRevenue, // Approx
                orderCount: completedOrders.length,
                activeOrders: 0,
                totalUnits
            });

            // --- Top Doctors (Based on filteredOrders) ---
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

            // --- Top Services ---
            const serviceStats = new Map<string, number>();
            completedOrders.forEach(o => {
                o.items.forEach(item => {
                    const current = serviceStats.get(item.serviceType) || 0;
                    serviceStats.set(item.serviceType, current + 1);
                });
            });

            const sortedServices = Array.from(serviceStats.entries())
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            setTopServices(sortedServices);

        } catch (error) {
            console.error('Error loading analytics:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const KPICard = ({ title, value, subtext, icon: Icon, color, subColor }: any) => (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-gray-500 text-sm font-medium mb-1">{title}</p>
                    <h3 className="text-2xl font-bold text-gray-800">{value.toLocaleString()} <span className="text-sm text-gray-400 font-normal">{typeof value === 'number' ? 'ج.م' : ''}</span></h3>
                    {subtext && <p className={`text-xs mt-2 ${subColor} font-medium`}>{subtext}</p>}
                </div>
                <div className={`p-3 rounded-xl ${color}`}>
                    <Icon className="text-white" size={24} />
                </div>
            </div>
        </div>
    );



    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">تحليلات الأداء</h1>
                    <p className="text-gray-500">تحليل المبيعات، الأرباح، وأداء المعمل</p>
                    {isLoading && (
                        <div className="mt-2 text-sm text-blue-600 animate-pulse">جاري تحديث البيانات...</div>
                    )}
                </div>
                <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
                    <span className="text-xs font-bold text-gray-500 px-2">الفترة:</span>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-gray-50 border-none text-sm font-bold text-gray-700 focus:ring-0 rounded-lg py-1.5"
                    />
                    <span className="text-gray-300">|</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-gray-50 border-none text-sm font-bold text-gray-700 focus:ring-0 rounded-lg py-1.5"
                    />
                </div>
            </div>

            {/* NEW: Operational Stats Grid (Counts) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 flex items-center justify-between">
                    <div>
                        <p className="text-indigo-600 text-sm font-bold mb-1">تسليمات (Orders)</p>
                        <h3 className="text-3xl font-black text-indigo-800">{stats.orderCount}</h3>
                    </div>
                    <div className="p-3 bg-white rounded-xl shadow-sm"><FileText className="text-indigo-500" size={24} /></div>
                </div>

                <div className="bg-purple-50 p-6 rounded-2xl border border-purple-100 flex items-center justify-between">
                    <div>
                        <p className="text-purple-600 text-sm font-bold mb-1">وحدات (Units)</p>
                        <h3 className="text-3xl font-black text-purple-800">{stats.totalUnits}</h3>
                    </div>
                    <div className="p-3 bg-white rounded-xl shadow-sm"><Layers className="text-purple-500" size={24} /></div>
                </div>

                <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 flex items-center justify-between">
                    <div>
                        <p className="text-emerald-600 text-sm font-bold mb-1">إجمالي المبيعات (Sales)</p>
                        <h3 className="text-3xl font-black text-emerald-800">{stats.deliveredRevenue.toLocaleString()} <span className="text-sm">ج.م</span></h3>
                    </div>
                    <div className="p-3 bg-white rounded-xl shadow-sm"><TrendingUp className="text-emerald-500" size={24} /></div>
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    title="صافي الربح (Net Profit)"
                    value={stats.netProfit}
                    subtext={`${stats.deliveredRevenue > 0 ? ((stats.netProfit / stats.deliveredRevenue) * 100).toFixed(1) : 0}% هامش ربح`}
                    icon={Wallet}
                    color={stats.netProfit >= 0 ? "bg-green-500" : "bg-red-500"}
                    subColor={stats.netProfit >= 0 ? "text-green-600" : "text-red-600"}
                />
                <KPICard
                    title="التحصيلات النقدية (Collected)"
                    value={stats.totalRevenue}
                    subtext="إجمالي المقبوضات الفعلي"
                    icon={DollarSign}
                    color="bg-blue-600"
                    subColor="text-blue-600"
                />
                <KPICard
                    title="الربح التشغيلي (Gross Profit)"
                    value={stats.grossProfit}
                    subtext="ربح الأوامر المسلمة فقط"
                    icon={TrendingUp}
                    color="bg-indigo-500"
                    subColor="text-indigo-600"
                />
                <KPICard
                    title="مديونيات العملاء (Receivables)"
                    value={stats.pendingRevenue}
                    subtext="مستحقات عند الأطباء"
                    icon={Activity}
                    color="bg-orange-400"
                    subColor="text-orange-600"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Insights Panel */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="bg-gradient-to-br from-indigo-900 to-blue-900 text-white p-6 rounded-2xl shadow-lg">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <Activity size={20} />
                            رؤى مالية وتشغيلية
                        </h3>
                        <div className="space-y-3">
                            {/* Top Performers */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-white/10 p-3 rounded-xl backdrop-blur-sm">
                                    <p className="text-white/80 text-[10px] mb-1">أكثر الخدمات ربحية</p>
                                    <p className="font-bold text-sm truncate">
                                        {topServices.length > 0 ? topServices[0].name : '--'}
                                    </p>
                                </div>
                                <div className="bg-white/10 p-3 rounded-xl backdrop-blur-sm">
                                    <p className="text-white/80 text-[10px] mb-1">أعلى طبيب</p>
                                    <p className="font-bold text-sm truncate">
                                        {topDoctors.length > 0 ? topDoctors[0].name : '--'}
                                    </p>
                                </div>
                            </div>

                            <div className="border-t border-white/20 my-2"></div>

                            {/* Ratios */}
                            <h4 className="text-xs font-bold text-blue-200 mb-2">مؤشرات الربحية والمصروفات</h4>

                            <div className="space-y-2">
                                {/* Gross Margin */}
                                <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                                    <span className="text-xs text-white/90">هامش الربح التشغيلي (Gross Margin)</span>
                                    <span className="font-bold text-green-300">
                                        {stats.deliveredRevenue > 0 ? ((stats.grossProfit / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                    </span>
                                </div>

                                {/* Net Margin */}
                                <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                                    <span className="text-xs text-white/90">هامش صافي الربح (Net Margin)</span>
                                    <span className="font-bold text-emerald-400">
                                        {stats.deliveredRevenue > 0 ? ((stats.netProfit / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                    </span>
                                </div>

                                {/* Expense Ratios */}
                                <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                                    <span className="text-xs text-white/90">المصروفات من الإيرادات (المسلمة)</span>
                                    <span className="font-bold text-orange-300">
                                        {stats.deliveredRevenue > 0 ? ((stats.totalExpenses / stats.deliveredRevenue) * 100).toFixed(1) : 0}%
                                    </span>
                                </div>

                                <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg border border-white/10">
                                    <span className="text-xs text-white/90">المصروفات من صافي الربح</span>
                                    <span className="font-bold text-red-300">
                                        {stats.netProfit > 0 ? ((stats.totalExpenses / stats.netProfit) * 100).toFixed(1) :
                                            (stats.totalExpenses > 0 && stats.netProfit === 0) ? '∞' : '0'}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Top Doctors Chart (CSS Bar Chart) */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-800 mb-6">أفضل 5 أطباء (حسب الإيرادات)</h3>
                    <div className="space-y-4">
                        {topDoctors.map((doc, idx) => {
                            const maxRev = topDoctors[0]?.revenue || 1;
                            const percent = (doc.revenue / maxRev) * 100;
                            return (
                                <div key={idx} className="relative">
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="font-bold text-gray-700">{doc.name}</span>
                                        <span className="text-gray-500">{doc.revenue.toLocaleString()} ج.م</span>
                                    </div>
                                    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                                        <div
                                            className="h-full bg-blue-600 rounded-full transition-all duration-500"
                                            style={{ width: `${percent}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">{doc.count} طلب</p>
                                </div>
                            );
                        })}
                        {topDoctors.length === 0 && <p className="text-center text-gray-400 py-4">لا توجد بيانات كافية</p>}
                    </div>
                </div>
            </div>

            {/* Services Grid */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-lg font-bold text-gray-800 mb-4">الخدمات الأكثر طلباً</h3>
                <div className="flex flex-wrap gap-3">
                    {topServices.map((svc, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 min-w-[150px]">
                            <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-sm">
                                {svc.count}
                            </div>
                            <div>
                                <p className="font-bold text-gray-800">{svc.name}</p>
                                <p className="text-xs text-gray-500">طلب</p>
                            </div>
                        </div>
                    ))}
                    {topServices.length === 0 && <p className="text-gray-400">لا توجد بيانات</p>}
                </div>
            </div>
        </div>
    );
}
