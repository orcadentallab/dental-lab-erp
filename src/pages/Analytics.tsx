import { useEffect, useState } from 'react';
import { db } from '../services/db';
import { TrendingUp, DollarSign, Activity, Wallet } from 'lucide-react';


export default function Analytics() {
    const [stats, setStats] = useState({
        totalRevenue: 0,
        deliveredRevenue: 0,
        grossProfit: 0,
        netProfit: 0,
        totalExpenses: 0,
        pendingRevenue: 0,
        orderCount: 0,
        activeOrders: 0
    });
    const [topDoctors, setTopDoctors] = useState<{ name: string; revenue: number; count: number }[]>([]);
    const [topServices, setTopServices] = useState<{ name: string; count: number }[]>([]);
    const [dateRange] = useState('all'); // 'all', 'month', 'week'

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        calculateStats();
    }, [dateRange]);

    const calculateStats = async () => {
        setIsLoading(true);
        try {
            const [orders, transactions, doctors] = await Promise.all([
                db.getOrders(),
                db.getTransactions(),
                db.getDoctors()
            ]);



            // 1. Filter by Date (Simplification: Current Month vs All Time for now)
            // For MVP, we'll just do "All Time" but structured to allow expansion

            const completedOrders = orders.filter(o =>
                o.status === 'Delivered' || o.status === 'Completed'
            );

            const activeOrdersList = orders.filter(o =>
                o.status !== 'Delivered' && o.status !== 'Completed'
            );

            // --- KPIs ---

            // 1. Total Sales Value (Accrual Basis) - Value of ALL orders that are valid (not rejected)
            // We assume all orders except maybe 'Rejected' are billable or will be billable.
            // If stricter, maybe only use Delivered + In Progress. Let's use all for now as "Booked Sales".
            const validOrders = orders.filter(o => o.status !== 'Rejected' && o.technicianStatus !== 'Rejected');
            const totalSalesValue = validOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

            // 2. Collected Revenue (Cash Basis) - Actual money received
            const collectedRevenue = transactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            // 3. Pending / Accounts Receivable (Money with Doctors)
            // Total Value of Orders - Total Money Collected
            const pendingRevenue = totalSalesValue - collectedRevenue;


            // 4. Profit (Accrual Basis) - Based on DELIVERED/COMPLETED jobs
            // Profit = (Price of Delivered - Cost of Delivered) - Gen. Expenses
            const totalCostOfGoods = completedOrders.reduce((sum, o) => sum + (o.cost || 0), 0); // Internal Cost for completed
            const deliveredRevenue = completedOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

            const grossProfit = deliveredRevenue - totalCostOfGoods;

            const totalExpenses = transactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            const netProfit = grossProfit - totalExpenses;

            setStats({
                totalRevenue: collectedRevenue, // Cash Collected
                deliveredRevenue, // Value of Delivered Work (for Margins)
                grossProfit,
                netProfit,
                totalExpenses,
                pendingRevenue, // Receivables
                orderCount: completedOrders.length,
                activeOrders: activeOrdersList.length
            });

            // --- Top Doctors (Based on ALL Valid Orders, not just completed) ---
            const doctorStats = new Map<string, { revenue: number; count: number }>();

            validOrders.forEach(o => {
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

            // --- Top Services (Based on ALL Valid Orders) ---
            const serviceStats = new Map<string, number>();
            validOrders.forEach(o => {
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
                    <h3 className="text-2xl font-bold text-gray-800">{value.toLocaleString()} <span className="text-sm text-gray-400 font-normal">ج.م</span></h3>
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
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">تحليلات الأداء</h1>
                    <p className="text-gray-500">نظرة شاملة على أداء المعمل المالي والتشغيلي</p>
                    {isLoading && (
                        <div className="mt-2 text-sm text-blue-600 animate-pulse">جاري تحديث البيانات...</div>
                    )}
                </div>
                <div className="flex gap-2 bg-white p-1 rounded-lg border border-gray-200">
                    {/* Placeholder for Date Filter */}
                    <button className="px-4 py-2 bg-blue-50 text-blue-600 rounded-md text-sm font-bold">الكل</button>
                    {/* <button className="px-4 py-2 text-gray-500 hover:bg-gray-50 rounded-md text-sm">هذا الشهر</button> */}
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
                            <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold">
                                {idx + 1}
                            </div>
                            <div>
                                <p className="font-bold text-gray-800">{svc.name}</p>
                                <p className="text-xs text-gray-500">{svc.count} مرة</p>
                            </div>
                        </div>
                    ))}
                    {topServices.length === 0 && <p className="text-gray-400">لا توجد بيانات</p>}
                </div>
            </div>
        </div>
    );
}
