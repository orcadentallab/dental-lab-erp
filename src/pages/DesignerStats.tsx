import { useEffect, useState, useMemo, useCallback } from 'react';
import { db, type Order, type User, type Doctor } from '../services/db';
import {
  Search,
  BarChart3,
  ArrowRight,
  Clock,
  AlertTriangle,
  Zap,
  Truck,
  Activity,
  Calculator,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDesignerDuration, getDesignSubmittedAt, getDesignerWorkDurationMs, isDesignSubmitted } from '../lib/designerOrderUtils';
import { useToast } from '../context/ToastContext';
import { ensureAbsoluteUrl } from '../lib/urlUtils';
import { ErrorHandler } from '../lib/errorHandler';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  capacityService,
  type ProductionCapacityReport,
  type SupplierLeadTimeReport,
  type TeamProductivityReport,
  type DeliveryEstimate
} from '../services/supabase/capacityService';
import { supabase } from '../lib/supabase';

export default function DesignerStats() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();

    const [isLoading, setIsLoading] = useState(true);
    const [orders, setOrders] = useState<Order[]>([]);
    const [designerOrders, setDesignerOrders] = useState<Order[]>([]);
    const [activeTeamTab, setActiveTeamTab] = useState<'design' | 'production' | 'suppliers' | 'estimator'>('design');
    const [users, setUsers] = useState<User[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);

    // Filter states for designer tab
    const [designerStatsSearch, setDesignerStatsSearch] = useState('');
    const [designerStatsTimeFilter, setDesignerStatsTimeFilter] = useState<'all' | 'week' | 'month'>('all');
    const [designerStatsStatusFilter, setDesignerStatsStatusFilter] = useState<'all' | 'pending' | 'submitted' | 'tryin' | 'delivered'>('all');

    // Phase 6 Production Capacity States
    const [capacityReport, setCapacityReport] = useState<ProductionCapacityReport | null>(null);
    const [supplierReport, setSupplierReport] = useState<SupplierLeadTimeReport | null>(null);
    const [teamReport, setTeamReport] = useState<TeamProductivityReport | null>(null);

    // Delivery Estimator States ("كام هتاخد؟")
    const [servicesList, setServicesList] = useState<Array<{ id: string; name: string; selling_price: number }>>([]);
    const [selectedServiceId, setSelectedServiceId] = useState('');
    const [estimatorUnits, setEstimatorUnits] = useState(1);
    const [deliveryEstimate, setDeliveryEstimate] = useState<DeliveryEstimate | null>(null);
    const [isEstimating, setIsEstimating] = useState(false);

    const handleOpenExternalUrl = (rawUrl: string | undefined | null, errorMsg: string) => {
        if (!rawUrl) return;
        const absoluteUrl = ensureAbsoluteUrl(rawUrl);
        if (!absoluteUrl) {
            toast.error(errorMsg);
            return;
        }
        const link = document.createElement('a');
        link.href = absoluteUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [ordersData, designerOrdersData, usersData, doctorsData, servicesRes] = await Promise.all([
                db.getDashboardActiveOrders(),
                db.getDesignerDashboardOrders(),
                db.getUsers(),
                db.getDoctors(),
                supabase.from('services').select('id, name, selling_price').order('name')
            ]);

            setOrders(ordersData);
            setDesignerOrders(designerOrdersData);
            setUsers(usersData);
            setDoctors(doctorsData);
            setServicesList(servicesRes.data || []);

            if (servicesRes.data && servicesRes.data.length > 0 && !selectedServiceId) {
                setSelectedServiceId(servicesRes.data[0].id);
            }

            // Load Phase 6 metrics in parallel
            try {
                const [cap, sup, team] = await Promise.all([
                    capacityService.getCapacityAndBottlenecks(),
                    capacityService.getSupplierLeadTimes(),
                    capacityService.getTeamProductivity()
                ]);
                setCapacityReport(cap);
                setSupplierReport(sup);
                setTeamReport(team);
            } catch (err: unknown) {
                console.error('Phase 6 capacity metrics load error:', err);
            }
        } catch (error) {
            console.error('Error loading statistics data:', error);
            toast.error('حدث خطأ أثناء تحميل البيانات');
        } finally {
            setIsLoading(false);
        }
    }, [selectedServiceId, toast]);

    useEffect(() => {
        if (!user) return;
        loadData();
    }, [user, refreshKey, loadData]);

    // Handle Delivery Estimator Run
    const handleCalculateEstimate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedServiceId) return;

        try {
            setIsEstimating(true);
            const estimate = await capacityService.estimateDeliveryTime(selectedServiceId, estimatorUnits);
            setDeliveryEstimate(estimate);
        } catch (err: unknown) {
            console.error('Failed to calculate delivery estimate:', err);
            toast.error('فشل حساب موعد التسليم المتوقع');
        } finally {
            setIsEstimating(false);
        }
    };

    const nowMs = Date.now();

    const getOrderUnitsCount = (order: Order) => {
        return order.items.reduce((total, item) => total + Math.max(item.teethNumbers.length, 1), 0);
    };

    const getRowsUnitsCount = (rows: { order: Order }[]) => {
        return rows.reduce((total, row) => total + getOrderUnitsCount(row.order), 0);
    };

    const designerTimelineRows = useMemo(() => {
        return designerOrders
            .map(order => {
                const submittedAt = getDesignSubmittedAt(order);
                const durationMs = getDesignerWorkDurationMs(order, nowMs);

                return {
                    order,
                    submittedAt,
                    durationMs,
                    isFinished: isDesignSubmitted(order),
                };
            })
            .sort((a, b) => new Date((b.submittedAt || b.order.createdAt)).getTime() - new Date((a.submittedAt || a.order.createdAt)).getTime());
    }, [designerOrders, nowMs]);

    const pendingDesignerTimelineRows = useMemo(
        () => designerTimelineRows.filter(row => !row.isFinished),
        [designerTimelineRows]
    );

    const submittedDesignerTimelineRows = useMemo(
        () => designerTimelineRows.filter(row => row.isFinished),
        [designerTimelineRows]
    );

    const pendingDesignerUnitsCount = getRowsUnitsCount(pendingDesignerTimelineRows);
    const submittedDesignerUnitsCount = getRowsUnitsCount(submittedDesignerTimelineRows);

    const filteredDesignerStatsRows = useMemo(() => {
        let rows: typeof designerTimelineRows;
        if (designerStatsStatusFilter === 'pending') {
            rows = pendingDesignerTimelineRows;
        } else if (designerStatsStatusFilter === 'submitted') {
            rows = submittedDesignerTimelineRows;
        } else if (designerStatsStatusFilter === 'tryin' || designerStatsStatusFilter === 'delivered') {
            const targetStatus = designerStatsStatusFilter === 'tryin' ? 'Try In' : 'Delivered';
            rows = orders
                .filter(o => o.designerId && o.status === targetStatus)
                .map(order => ({
                    order,
                    submittedAt: getDesignSubmittedAt(order),
                    durationMs: getDesignerWorkDurationMs(order, nowMs),
                    isFinished: isDesignSubmitted(order),
                }))
                .sort((a, b) => new Date(b.submittedAt || b.order.createdAt).getTime() - new Date(a.submittedAt || a.order.createdAt).getTime());
        } else {
            const designerRowIds = new Set(designerTimelineRows.map(r => r.order.id));
            const extraRows = orders
                .filter(o => o.designerId && !designerRowIds.has(o.id))
                .map(order => ({
                    order,
                    submittedAt: getDesignSubmittedAt(order),
                    durationMs: getDesignerWorkDurationMs(order, nowMs),
                    isFinished: isDesignSubmitted(order),
                }));
            rows = [...designerTimelineRows, ...extraRows]
                .sort((a, b) => new Date(b.submittedAt || b.order.createdAt).getTime() - new Date(a.submittedAt || a.order.createdAt).getTime());
        }
        if (designerStatsTimeFilter !== 'all') {
            const cutoff = new Date();
            if (designerStatsTimeFilter === 'week') cutoff.setDate(cutoff.getDate() - 7);
            else cutoff.setDate(cutoff.getDate() - 30);
            const cutoffMs = cutoff.getTime();
            rows = rows.filter(row => new Date(row.order.createdAt).getTime() >= cutoffMs);
        }
        if (designerStatsSearch.trim()) {
            const q = designerStatsSearch.trim().toLowerCase();
            rows = rows.filter(row => {
                const o = row.order;
                const doctorName = o.doctorId ? (doctors.find(d => d.id === o.doctorId)?.name || '').toLowerCase() : '';
                return (
                    (o.patientName || '').toLowerCase().includes(q) ||
                    (o.caseId || '').toLowerCase().includes(q) ||
                    doctorName.includes(q)
                );
            });
        }
        return rows;
    }, [
        designerStatsStatusFilter,
        pendingDesignerTimelineRows,
        submittedDesignerTimelineRows,
        orders,
        designerTimelineRows,
        designerStatsTimeFilter,
        designerStatsSearch,
        nowMs,
        doctors,
    ]);

    const filteredDesignerStatsGroups = useMemo(() => {
        const groups: Record<string, { designerId: string; designerName: string; rows: typeof filteredDesignerStatsRows }> = {};
        for (const row of filteredDesignerStatsRows) {
            const designerId = row.order.designerId || 'unassigned';
            const designerName = designerId === 'unassigned'
                ? 'غير مسند لمصمم'
                : (users.find(u => u.id === designerId)?.name || 'مصمم غير محدد');
            if (!groups[designerId]) {
                groups[designerId] = { designerId, designerName, rows: [] };
            }
            groups[designerId].rows.push(row);
        }
        return Object.values(groups).sort((a, b) => b.rows.length - a.rows.length);
    }, [filteredDesignerStatsRows, users]);

    const getDoctorDisplayName = (doctorId: string) => {
        const doctor = doctors.find(doc => doc.id === doctorId);
        if (!doctor) return '-';

        if (doctor.parentId) {
            const center = doctors.find(doc => doc.id === doctor.parentId);
            if (center?.name) {
                return `${doctor.name} (${center.name})`;
            }
        }

        return doctor.name;
    };

    const requestDesignRevision = async (order: Order) => {
        if (!user) return;
        if (!confirm('هل تريد إرجاع الحالة تحت التصميم مع الاحتفاظ برابط التصميم الحالي؟')) return;

        try {
            const updatedOrder = await db.updateOrderStatus(order.id, 'Under Design', {
                comment: '↩️ تم طلب تعديل على التصميم، ورجعت الحالة تحت التصميم مع الاحتفاظ بالرابط السابق لحين رفع نسخة جديدة.',
                userId: user.id,
                userName: user.name || user.role || 'مستخدم',
                actorRole: user.role,
            });

            if (updatedOrder) {
                setDesignerOrders(prev => prev.map(existingOrder => existingOrder.id === updatedOrder.id ? updatedOrder : existingOrder));
                setOrders(prev => prev.map(existingOrder => existingOrder.id === updatedOrder.id ? updatedOrder : existingOrder));
                toast.success('تم إرجاع الحالة تحت التصميم بنجاح');
                setRefreshKey(prev => prev + 1);
            }
        } catch (error) {
            toast.error(ErrorHandler.getUserMessage(error) || 'فشل إرجاع الحالة تحت التصميم');
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6" dir="rtl">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => navigate('/dashboard')}
                        className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                        title="العودة للرئيسية"
                    >
                        <ArrowRight size={18} className="rtl:rotate-0 ltr:rotate-180" />
                    </button>
                    <div>
                        <div className="flex items-center gap-2">
                            <BarChart3 size={22} className="text-teal-600 dark:text-teal-400" />
                            <h1 className="text-xl font-bold text-slate-900 dark:text-white">إنتاجية الفريق والطاقة التشغيلية</h1>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            متابعة زمن التصميم، تحليل الاختناقات، أداء الفنيين، أزمنة الموردين، وحاسبة مواعيد التسليم
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={loadData}
                        className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition"
                        title="تحديث"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm w-fit">
                {[
                    { tab: 'design' as const, label: 'فريق التصميم' },
                    { tab: 'production' as const, label: 'الطاقة والاختناقات (المعمل الداخلي)' },
                    { tab: 'suppliers' as const, label: 'أزمنة الموردين الخارجيين (p80)' },
                    { tab: 'estimator' as const, label: 'حاسبة ميعاد التسليم («كام هتاخد؟»)' },
                ].map(option => (
                    <button
                        key={option.tab}
                        onClick={() => setActiveTeamTab(option.tab)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                            activeTeamTab === option.tab
                                ? 'bg-teal-600 text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            {/* Tab 2: Production Capacity & Bottlenecks */}
            {activeTeamTab === 'production' && capacityReport && (
                <div className="space-y-6">
                    {/* Top Bottleneck Banner */}
                    <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-200 dark:border-amber-900/50 p-5 rounded-2xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-xl">
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div>
                                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">أكبر مرحلة تسبب اختناقاً في المعمل:</span>
                                <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                                    {capacityReport.top_bottleneck_stage}
                                </h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    إجمالي الحالات الجارية في مراحل الإنتاج (WIP): <span className="font-bold font-mono text-slate-900 dark:text-white">{capacityReport.total_active_wip} وحدة</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Stages Capacity Table */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-6 space-y-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Activity className="w-5 h-5 text-teal-600" />
                            <span>مؤشرات أداء المراحل وزمن الدورة (بوقت العمل الفعلي المحسوب)</span>
                        </h3>

                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-right">
                                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                                    <tr>
                                        <th className="p-3">المرحلة</th>
                                        <th className="p-3">الحالات بالانتظار (WIP)</th>
                                        <th className="p-3">متوسط وقت الانتظار</th>
                                        <th className="p-3">متوسط وقت الشغل الفعلي</th>
                                        <th className="p-3">إجمالي وقت المرحلة</th>
                                        <th className="p-3">نسبة النجاح من أول مرة</th>
                                        <th className="p-3">أعطال الأجهزة</th>
                                        <th className="p-3">مؤشر الاختناق</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {capacityReport.stages.map(st => (
                                        <tr key={st.stage_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                            <td className="p-3 font-semibold text-slate-900 dark:text-white">{st.stage_name}</td>
                                            <td className="p-3 font-mono">
                                                <span className={`px-2 py-0.5 rounded-md font-bold ${st.active_wip_units > 10 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'}`}>
                                                    {st.active_wip_units} وحدة
                                                </span>
                                            </td>
                                            <td className="p-3 font-mono">{st.avg_wait_minutes} دقيقة</td>
                                            <td className="p-3 font-mono text-teal-600 font-semibold">{st.avg_touch_minutes} دقيقة</td>
                                            <td className="p-3 font-mono font-bold">{st.avg_stage_minutes} دقيقة</td>
                                            <td className="p-3 font-mono text-emerald-600 font-bold">{st.first_pass_rate_pct}%</td>
                                            <td className="p-3 font-mono text-rose-500">{st.machine_downtime_hours} ساعة</td>
                                            <td className="p-3 font-mono font-bold text-slate-700 dark:text-slate-300">{st.bottleneck_score}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Team Throughput Table */}
                    {teamReport && teamReport.team_productivity.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-6 space-y-4">
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <Zap className="w-5 h-5 text-teal-600" />
                                <span>إنتاجية الفنيين في المراحل الداخلية</span>
                            </h3>

                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-right">
                                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                                        <tr>
                                            <th className="p-3">الفني</th>
                                            <th className="p-3">المراحل التي يعمل بها</th>
                                            <th className="p-3">الوحدات المنجزة</th>
                                            <th className="p-3">الوحدات الراسبة</th>
                                            <th className="p-3">ساعات الشغل الفعلي</th>
                                            <th className="p-3">الإنتاجية بالساعة</th>
                                            <th className="p-3">نسبة الأخطاء</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {teamReport.team_productivity.map(tech => (
                                            <tr key={tech.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                                <td className="p-3 font-semibold text-slate-900 dark:text-white">{tech.user_name}</td>
                                                <td className="p-3 text-slate-500">{(tech.stages_operated || []).join('، ') || '—'}</td>
                                                <td className="p-3 font-mono font-bold text-emerald-600">{tech.total_units_passed}</td>
                                                <td className="p-3 font-mono text-rose-500">{tech.total_units_failed}</td>
                                                <td className="p-3 font-mono">{tech.total_touch_hours} ساعة</td>
                                                <td className="p-3 font-mono font-bold text-teal-600">{tech.units_per_hour} وحدة/ساعة</td>
                                                <td className="p-3 font-mono">{tech.error_rate_pct}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Tab 3: Supplier Lead Times */}
            {activeTeamTab === 'suppliers' && supplierReport && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-6 space-y-4">
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Truck className="w-5 h-5 text-teal-600" />
                            <span>تحليل أزمنة استلام المعامل والموردين الخارجيين</span>
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                            يُقاس بالوقت المنقضي الفعلي (أيام تقويم شاملة الإجازات) مع تحديد العينات الموثوقة ومعدل الالتزام
                        </p>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-right">
                            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                                <tr>
                                    <th className="p-3">المعمل / المورد</th>
                                    <th className="p-3">عدد الحالات المقيسة</th>
                                    <th className="p-3">الوسيط (p50)</th>
                                    <th className="p-3">المعيار الإحصائي (p80)</th>
                                    <th className="p-3">المتوسط العام</th>
                                    <th className="p-3">نسبة الالتزام بالميعاد</th>
                                    <th className="p-3">حالة العينة</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {supplierReport.suppliers.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="p-6 text-center text-slate-400">لا توجد بيانات شغل خارجي مكتملة</td>
                                    </tr>
                                ) : (
                                    supplierReport.suppliers.map(sup => (
                                        <tr key={sup.supplier_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                            <td className="p-3 font-semibold text-slate-900 dark:text-white">{sup.supplier_name}</td>
                                            <td className="p-3 font-mono">{sup.total_sample_count} حالة</td>
                                            <td className="p-3 font-mono font-semibold">{sup.p50_lead_days} يوم</td>
                                            <td className="p-3 font-mono font-bold text-teal-600">{sup.p80_lead_days} يوم</td>
                                            <td className="p-3 font-mono">{sup.avg_lead_days} يوم</td>
                                            <td className="p-3 font-mono font-bold text-emerald-600">{sup.on_time_rate_pct}%</td>
                                            <td className="p-3">
                                                {sup.is_low_sample ? (
                                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded text-[11px]">
                                                        ⚠️ عينة قليلة (&lt;20)
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 rounded text-[11px]">
                                                        ✅ عينة موثوقة
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Tab 4: Delivery Estimator ("كام هتاخد؟") */}
            {activeTeamTab === 'estimator' && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-xl">
                                <Calculator className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-white">حاسبة زمن التسليم المسبق («كام هتاخد؟»)</h3>
                                <p className="text-xs text-slate-500">
                                    توقع دقيق لتاريخ ووقت التسليم المحسوب بناءً على معيار p80 لخطوات الخريطة ومواعيد تقويم العمل
                                </p>
                            </div>
                        </div>

                        <form onSubmit={handleCalculateEstimate} className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">الخدمة المطلوبة</label>
                                <select
                                    value={selectedServiceId}
                                    onChange={e => setSelectedServiceId(e.target.value)}
                                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                    required
                                >
                                    {servicesList.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">عدد الوحدات (Units)</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={estimatorUnits}
                                    onChange={e => setEstimatorUnits(parseInt(e.target.value, 10) || 1)}
                                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
                                    required
                                />
                            </div>

                            <div className="flex items-end">
                                <button
                                    type="submit"
                                    disabled={isEstimating}
                                    className="w-full py-2.5 px-4 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-xs transition shadow-sm flex items-center justify-center gap-2"
                                >
                                    <Clock className="w-4 h-4" />
                                    <span>{isEstimating ? 'جاري الحساب...' : 'احسب موعد التسليم'}</span>
                                </button>
                            </div>
                        </form>
                    </div>

                    {deliveryEstimate && (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
                            {/* Prediction Headline Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="p-4 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 rounded-xl">
                                    <div className="text-xs text-teal-700 dark:text-teal-400 font-semibold">تاريخ التسليم المتوقع</div>
                                    <div className="text-2xl font-bold text-teal-900 dark:text-teal-100 font-mono mt-1">
                                        {deliveryEstimate.estimated_delivery_date ?? '—'}
                                    </div>
                                    {/* A null date means no work calendar is configured, so the
                                        projection is not measurable. Showing today's date instead
                                        would be a promise nobody computed. */}
                                    <div className="text-xs text-teal-600 mt-1">
                                        {deliveryEstimate.estimated_delivery_date === null
                                            ? 'مفيش تقويم عمل متظبط — الموعد مش محسوب'
                                            : `بعد حوالي ${deliveryEstimate.estimated_calendar_days} يوم`}
                                    </div>
                                </div>

                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                                    <div className="text-xs text-slate-500">ساعات العمل المطلوبة</div>
                                    <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono mt-1">
                                        {deliveryEstimate.total_working_hours} <span className="text-sm font-normal">ساعة</span>
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1">
                                        ({deliveryEstimate.total_working_minutes} دقيقة عمل)
                                    </div>
                                </div>

                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                                    <div className="text-xs text-slate-500">مستوى الثقة الإحصائية</div>
                                    <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                                        {deliveryEstimate.confidence_level === 'high' ? (
                                            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 rounded-lg text-xs">
                                                ✅ دقة عالية (عيّنة {deliveryEstimate.sample_size} حالة)
                                            </span>
                                        ) : deliveryEstimate.confidence_level === 'moderate' ? (
                                            <span className="px-2.5 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 rounded-lg text-xs">
                                                ⚡ دقة متوسطة ({deliveryEstimate.sample_size} حالة)
                                            </span>
                                        ) : (
                                            <span className="px-2.5 py-1 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded-lg text-xs">
                                                ⚠️ تقدير افتراضي
                                                {deliveryEstimate.stages_without_history > 0
                                                    ? ` — ${deliveryEstimate.stages_without_history} مرحلة من غير تاريخ`
                                                    : ` — أقل مرحلة عندها ${deliveryEstimate.sample_size} حالة`}
                                            </span>
                                        )}
                                    </div>
                                    {/* The sample size is the weakest stage on the route, not the
                                        total across stages -- said out loud so nobody reads it as
                                        "we measured this many whole cases". */}
                                    <div className="text-[11px] text-slate-400 mt-1">
                                        العيّنة محسوبة على أقل مرحلة في المسار
                                    </div>
                                </div>
                            </div>

                            {/* Stages Timeline Breakdown */}
                            <div className="space-y-3">
                                <h4 className="font-bold text-xs text-slate-700 dark:text-slate-300">تفكيك أزمنة المراحل (معيار p80):</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                    {deliveryEstimate.stages_breakdown.map((st, idx) => (
                                        <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl text-xs space-y-1">
                                            <div className="font-bold text-slate-900 dark:text-white">{st.stage_name}</div>
                                            <div className="text-teal-600 font-mono font-semibold">{st.p80_minutes} دقيقة عمل</div>
                                            <div className="text-[11px] text-slate-500 font-mono">
                                                {st.p80_minutes_per_unit} دقيقة/وحدة
                                            </div>
                                            <div className="text-[11px] text-slate-400">
                                                {st.execution === 'internal' ? 'داخلي' : 'خارجي'}
                                                {st.is_estimated
                                                    ? ' · معياري (مفيش تاريخ)'
                                                    : ` (${st.samples_count} عينة)`}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Tab 1: Design Team (Original View Preserved 100%) */}
            {activeTeamTab === 'design' && (
            <>
            {/* Metrics cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl shadow-sm border border-amber-200 dark:border-amber-800">
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-300 mb-1">لسه تحت التصميم</p>
                    <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{pendingDesignerTimelineRows.length}</p>
                    <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">{pendingDesignerUnitsCount} يونت تحت التصميم</p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl shadow-sm border border-emerald-200 dark:border-emerald-800">
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 mb-1">تم رفع التصميم</p>
                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{submittedDesignerTimelineRows.length}</p>
                    <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">{submittedDesignerUnitsCount} يونت جاهز للتصنيع</p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-1">إجمالي الحالات المعروضة</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{filteredDesignerStatsRows.length}</p>
                    <p className="mt-1 text-xs text-gray-400">{getRowsUnitsCount(filteredDesignerStatsRows)} يونت في القائمة الحالية</p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-1">المصممين النشطين</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{filteredDesignerStatsGroups.length}</p>
                    <p className="mt-1 text-xs text-gray-400">بناءً على الحالات المعروضة</p>
                </div>
            </div>

            {/* Designer Stats Filters */}
            <div className="space-y-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row gap-4 justify-between items-center">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute right-3 top-2.5 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="بحث باسم الطبيب، المريض، أو رقم الكيس..."
                            value={designerStatsSearch}
                            onChange={e => setDesignerStatsSearch(e.target.value)}
                            className="w-full pl-4 pr-10 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                        <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg">
                            {(['all', 'pending', 'submitted', 'tryin', 'delivered'] as const).map(status => (
                                <button
                                    key={status}
                                    onClick={() => setDesignerStatsStatusFilter(status)}
                                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                                        designerStatsStatusFilter === status
                                            ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-sm'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                    }`}
                                >
                                    {status === 'all' ? 'الكل' : status === 'pending' ? 'تحت التصميم' : status === 'submitted' ? 'تم الرفع' : status === 'tryin' ? 'تراى ان' : 'اتسلمت'}
                                </button>
                            ))}
                        </div>
                        <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg">
                            {(['all', 'week', 'month'] as const).map(time => (
                                <button
                                    key={time}
                                    onClick={() => setDesignerStatsTimeFilter(time)}
                                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                                        designerStatsTimeFilter === time
                                            ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-sm'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                    }`}
                                >
                                    {time === 'all' ? 'كل الوقت' : time === 'week' ? 'آخر أسبوع' : 'آخر شهر'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Groups and Tables */}
                {filteredDesignerStatsGroups.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-400 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
                        لا توجد حالات تطابق البحث أو الفلاتر المحددة
                    </div>
                ) : filteredDesignerStatsGroups.map(group => (
                    <div key={group.designerId} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-gray-800 dark:text-white">{group.designerName}</h3>
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                    {group.rows.length} حالة / {getRowsUnitsCount(group.rows)} يونت
                                </p>
                            </div>
                            {(() => {
                                const salary = users.find(u => u.id === group.designerId)?.baseSalary;
                                if (!salary || salary <= 0) return null;
                                const units = getRowsUnitsCount(group.rows);
                                return (
                                    <div className="text-left">
                                        <p className="text-sm font-bold text-gray-700 dark:text-gray-200 font-mono">
                                            {(units / (salary / 1000)).toFixed(1)}
                                        </p>
                                        <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                            يونت لكل 1000 ج.م راتب
                                        </p>
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="overflow-auto max-h-[420px]">
                            <table className="w-full text-right text-sm">
                                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/95 text-gray-500 dark:text-gray-400">
                                    <tr>
                                        <th className="px-4 py-3">الحالة</th>
                                        <th className="px-4 py-3">المريض</th>
                                        <th className="px-4 py-3">الطبيب</th>
                                        <th className="px-4 py-3">الخدمات</th>
                                        <th className="px-4 py-3">الوضع</th>
                                        <th className="px-4 py-3">تم الرفع</th>
                                        <th className="px-4 py-3">المدة</th>
                                        <th className="px-4 py-3">الرابط</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {group.rows.map(({ order, submittedAt, durationMs, isFinished }) => {
                                        const rowStatus = order.status === 'Delivered' ? 'delivered' : order.status === 'Try In' ? 'tryin' : isFinished ? 'submitted' : 'pending';
                                        const rowBg = rowStatus === 'delivered'
                                            ? 'border-gray-100 bg-gray-50/30 dark:border-gray-700/40 dark:bg-gray-700/10'
                                            : rowStatus === 'tryin'
                                                ? 'border-blue-100 bg-blue-50/35 dark:border-blue-900/40 dark:bg-blue-900/10'
                                                : rowStatus === 'submitted'
                                                    ? 'border-emerald-100 bg-emerald-50/35 dark:border-emerald-900/40 dark:bg-emerald-900/10'
                                                    : 'border-amber-100 bg-amber-50/35 dark:border-amber-900/40 dark:bg-amber-900/10';
                                        const badgeCls = rowStatus === 'delivered' ? 'bg-gray-500 text-white'
                                            : rowStatus === 'tryin' ? 'bg-blue-500 text-white'
                                                : rowStatus === 'submitted' ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                                                    : 'bg-amber-500 text-white';
                                        const badgeLabel = rowStatus === 'delivered' ? 'اتسلمت'
                                            : rowStatus === 'tryin' ? 'تراى ان'
                                                : rowStatus === 'submitted' ? 'تم رفع التصميم'
                                                    : 'تحت التصميم';
                                        return (
                                            <tr key={order.id} className={`border-t align-top ${rowBg}`}>
                                                <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">#{order.caseId}</td>
                                                <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{order.patientName}</td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{order.doctorId ? `د. ${getDoctorDisplayName(order.doctorId)}` : '-'}</td>
                                                <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                                                    <div className="max-w-[280px] space-y-1">
                                                        <div className="mb-1 inline-flex rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-gray-700 ring-1 ring-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700">
                                                            إجمالي {getOrderUnitsCount(order)} يونت
                                                        </div>
                                                        {order.items.map((item, index) => (
                                                            <div key={`${order.id}-item-${index}`} className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-2 py-1">
                                                                {item.serviceType} x{Math.max(item.teethNumbers.length, 1)}
                                                                {item.teethNumbers.length > 0 && (
                                                                    <span className="text-gray-400 dark:text-gray-500"> ({item.teethNumbers.join(', ')})</span>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex min-w-[96px] justify-center rounded-full px-2 py-1 text-[11px] font-bold ${badgeCls}`}>
                                                        {badgeLabel}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{submittedAt ? format(new Date(submittedAt), 'dd/MM/yyyy HH:mm') : '-'}</td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{durationMs !== null ? formatDesignerDuration(durationMs) : '-'}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex min-w-[130px] flex-col gap-1.5">
                                                        {order.designUrl ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenExternalUrl(order.designUrl, 'رابط التحميل غير صالح أو معطوب')}
                                                                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-xs font-bold text-right cursor-pointer"
                                                            >
                                                                مراجعة التصميم
                                                            </button>
                                                        ) : (
                                                            <span className="text-xs text-gray-300">-</span>
                                                        )}
                                                        {isFinished && rowStatus !== 'delivered' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => requestDesignRevision(order)}
                                                                className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 transition hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300 cursor-pointer"
                                                            >
                                                                طلب تعديل تصميم
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
            </>
            )}
        </div>
    );
}
