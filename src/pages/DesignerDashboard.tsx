import {getDesignQcQueue,type DesignQueueItem} from '../services/supabase/designQc';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { db, type Order } from '../services/db';
import { useAuth } from '../context/AuthContext';
import {
    FolderKanban, Upload, Search,
    AlertCircle, Clock, CheckCircle2, Link as LinkIcon, StickyNote, MessageCircle, Copy
} from 'lucide-react';
import { format } from 'date-fns';
import { isDesignerUser } from '../lib/userRoles';
import { formatDesignerDuration, getDesignSubmittedAt, getDesignerWorkDurationMs, isDesignSubmitted, isDesignerDashboardOrderVisible, getDesignSubmissionError } from '../lib/designerOrderUtils';
import { getLatestVisibleOrderComment } from '../utils/orderDisplay';
import { isDateInOpenRange } from '../utils/dateRange';
import { useToast } from '../context/ToastContext';
import { refreshNavBadges } from '../hooks/useNavBadges';
import { setProductionDoctorWait } from '../services/supabase/production';
import { ensureAbsoluteUrl } from '../lib/urlUtils';
import IssueCauseFields from '../components/orders/IssueCauseFields';
import DateRangeField from '../components/ui/DateRangeField';
import DesignDeliveryForm from '../components/orders/DesignDeliveryForm';
import DesignerDesignViewer from '../components/orders/DesignerDesignViewer';
import {designExecutionUrl,openDesignExecution} from '../services/supabase/designQc';
import { getEffectiveIssueState, getEffectiveProductionStatus } from '../constants/orderLifecycle';

interface DesignerDashboardProps {
    embedded?: boolean;
}

interface ExpandedTextPreview {
    title: string;
    content: string;
    accentClass: string;
}

const DESIGNER_DASHBOARD_CACHE_KEY = 'designer-dashboard-cache-v3';
const DESIGNER_DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

interface DesignerDashboardCache {
    userId: string;
    userRole: string;
    savedAt: number;
    orders: Order[];
    doctors: any[];
    users: any[];
}

export default function DesignerDashboard({ embedded = false }: DesignerDashboardProps) {
    const { user } = useAuth();
    const { success, error: toastError } = useToast();

    const handleOpenExternalUrl = (rawUrl: string | undefined | null, errorMsg: string) => {
        if (!rawUrl) return;
        const absoluteUrl = ensureAbsoluteUrl(rawUrl);
        if (!absoluteUrl) {
            toastError(errorMsg);
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

    const handleCopyDesignUrl = async (rawUrl: string | undefined | null) => {
        const absoluteUrl = ensureAbsoluteUrl(rawUrl || '');
        if (!absoluteUrl) {
            toastError('رابط التصميم غير صالح أو معطوب');
            return;
        }

        try {
            await navigator.clipboard.writeText(absoluteUrl);
            success('تم نسخ أحدث رابط تصميم');
        } catch {
            toastError('تعذر نسخ رابط التصميم');
        }
    };

    const [orders, setOrders] = useState<Order[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [doctors, setDoctors] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);

    // Filters
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [designerFilter, setDesignerFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

    // Modal State
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [returnedDesigns, setReturnedDesigns] = useState<Record<string, DesignQueueItem>>({});
    const [showDesignModal, setShowDesignModal] = useState(false);
    const [viewingDesign,setViewingDesign]=useState<Order|null>(null);
    const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
    const [expandedTextPreview, setExpandedTextPreview] = useState<ExpandedTextPreview | null>(null);
    const [designQueueView, setDesignQueueView] = useState<'pending' | 'submitted'>('pending');
    const [techActionPending, setTechActionPending] = useState<{
        orderId: string;
        action: 'Rejected' | 'NeedDetails';
        reason: string;
        causeCategory: string;
        responsibleStage: string;
    } | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());

    const isRestrictedDesigner = useMemo(
        () => !!user && isDesignerUser(user) && user.role !== 'admin' && user.role !== 'accountant',
        [user]
    );

    const doctorsById = useMemo(
        () => new Map(doctors.map((doctor: any) => [doctor.id, doctor])),
        [doctors]
    );

    const usersById = useMemo(
        () => new Map(users.map((appUser: any) => [appUser.id, appUser])),
        [users]
    );

    const loadData = useCallback(async () => {
        if (!user) return;
        let restoredFromCache = false;

        try {
            sessionStorage.removeItem('designer-dashboard-cache-v2');
            if(user.role==='designer')sessionStorage.removeItem('dashboard-cache-v1');
            const rawCache = isRestrictedDesigner ? null : sessionStorage.getItem(DESIGNER_DASHBOARD_CACHE_KEY);
            if (rawCache) {
                const cache = JSON.parse(rawCache) as DesignerDashboardCache;
                const isSameUser = cache.userId === user.id && cache.userRole === user.role;
                const isFresh = Date.now() - cache.savedAt < DESIGNER_DASHBOARD_CACHE_TTL_MS;

                if (isSameUser && isFresh) {
                    setOrders(cache.orders);
                    setDoctors(cache.doctors);
                    setUsers(cache.users);
                    setIsLoading(false);
                    restoredFromCache = true;
                }
            }
        } catch (error) {
            console.warn('Could not restore designer dashboard cache:', error);
        }

        if (!restoredFromCache) {
            setIsLoading(true);
        }

        try {
            const promises: Promise<any>[] = [
                db.getDesignerDashboardOrders(isRestrictedDesigner ? user.id : undefined),
                isRestrictedDesigner ? Promise.resolve([]) : db.getDoctors(),
            ];

            // Only non-designer-only users need users list for filtering
            if (user.role !== 'designer') {
                promises.push(db.getUsers());
            }

            const [results, qcQueue] = await Promise.all([Promise.all(promises), getDesignQcQueue().catch(() => [])]);
            setReturnedDesigns(Object.fromEntries(qcQueue.filter(item => item.state === 'returned').map(item => [item.id, item])));
            const dashboardOrders: Order[] = results[0].filter(isDesignerDashboardOrderVisible);
            const allDoctors = results[1];
            const allUsers = results[2] || []; // Undefined if not fetched

            setOrders(dashboardOrders);
            setSelectedOrder(current=>current?dashboardOrders.find(order=>order.id===current.id)??null:null);
            setViewingDesign(current=>current?dashboardOrders.find(order=>order.id===current.id)??null:null);
            setDoctors(allDoctors);
            const designerUsers = allUsers.filter((u: any) => isDesignerUser(u));
            setUsers(designerUsers);

            try {
                const cachePayload: DesignerDashboardCache = {
                    userId: user.id,
                    userRole: user.role,
                    savedAt: Date.now(),
                    orders: dashboardOrders,
                    doctors: allDoctors,
                    users: designerUsers,
                };
                if(!isRestrictedDesigner)sessionStorage.setItem(DESIGNER_DASHBOARD_CACHE_KEY, JSON.stringify(cachePayload));
            } catch (error) {
                console.warn('Could not save designer dashboard cache:', error);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    }, [isRestrictedDesigner, user]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(()=>{
        if(!isRestrictedDesigner)return;
        const refresh=()=>{void loadData();};
        window.addEventListener('focus',refresh);
        const timer=window.setInterval(refresh,30000);
        return()=>{window.removeEventListener('focus',refresh);window.clearInterval(timer);};
    },[isRestrictedDesigner,loadData]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNowMs(Date.now());
        }, 60 * 1000);

        return () => window.clearInterval(timer);
    }, []);

    const updateOrderInState = useCallback((updatedOrder: Order | null) => {
        if (!updatedOrder) return;
        setOrders(prev => prev.map(order => order.id === updatedOrder.id ? updatedOrder : order).filter(isDesignerDashboardOrderVisible));
    }, []);

    const handleTechAction = useCallback(async (
        orderId: string,
        action: 'Approved' | 'Rejected' | 'NeedDetails',
        reason?: string,
        causeCategory?: string,
        responsibleStage?: string,
    ) => {
        try {
            const order = orders.find(o => o.id === orderId);
            if (action === 'Rejected') {
                if (!reason?.trim()) throw new Error('سبب الرفض مطلوب');
                if (!causeCategory) throw new Error('سبب رفض المعمل مطلوب');
                await db.requestDesignerRejection(orderId, reason.trim(), undefined, causeCategory, responsibleStage);
                updateOrderInState(await db.getOrder(orderId));
                setTechActionPending(null);
                return;
            }
            if (action === 'NeedDetails') {
                const details = reason?.trim();
                if (!details) throw new Error('اكتب التفاصيل المطلوبة');
                await setProductionDoctorWait(orderId, true, details);
                const updatedOrder = await db.getOrder(orderId);
                if (updatedOrder) updateOrderInState({ ...updatedOrder, doctorWaitReason: details });
                setTechActionPending(null);
                refreshNavBadges();
                success('انتقلت الحالة إلى On Hold');
                return;
            }
            const updatedOrder = await db.updateOrder(orderId, { technicianStatus: action });
            updateOrderInState(updatedOrder);

            // Auto-advance: approving a brand-new case moves it into design,
            // same as the equivalent action on the shared Orders list/board.
            if (
                action === 'Approved' &&
                order &&
                getEffectiveProductionStatus(order) === 'not_started' &&
                getEffectiveIssueState(order) === 'none'
            ) {
                const advancedOrder = await db.updateOrderStatus(orderId, 'Under Design', {
                    userId: user?.id,
                    userName: user?.name || user?.role || 'User',
                    actorRole: user?.role,
                });
                updateOrderInState(advancedOrder);
            }
            setTechActionPending(null);
        } catch (err) {
            console.error('Tech action error:', err);
            toastError(err instanceof Error ? err.message : 'تعذّر تسجيل الإجراء');
        }
    }, [orders, updateOrderInState, user, success, toastError]);

    useEffect(() => {
        if (!user) return;

        try {
            const cachePayload: DesignerDashboardCache = {
                userId: user.id,
                userRole: user.role,
                savedAt: Date.now(),
                orders,
                doctors,
                users,
            };
            if(!isRestrictedDesigner)sessionStorage.setItem(DESIGNER_DASHBOARD_CACHE_KEY, JSON.stringify(cachePayload));
        } catch (error) {
            console.warn('Could not update designer dashboard cache:', error);
        }
    }, [doctors, orders, user, users,isRestrictedDesigner]);

    const handleAddComment = async (order: Order) => {
        if (!user) return;
        const text = (commentDrafts[order.id] || '').trim();
        if (!text) return;

        const nextComment = {
            id: Math.random().toString(36).substr(2, 9),
            text,
            userId: user.id,
            userName: user.name || user.role || 'مصمم',
            createdAt: new Date().toISOString(),
        };

        const updatedOrder = await db.updateOrder(order.id, {
            comments: [...(order.comments || []), nextComment],
        });

        setCommentDrafts(prev => ({ ...prev, [order.id]: '' }));
        updateOrderInState(updatedOrder);
    };

    const requestDesignRevision = async (order: Order) => {
        if (!user) return;
        if (!confirm('هل تريد إرجاع الحالة تحت التصميم؟ (سيتم حفظ الرابط الحالي في سجل الملاحظات وسيتعين عليك رفع رابط جديد)')) return;

        const updatedOrder = await db.updateOrderStatus(order.id, 'Under Design', {
            comment: `↩️ تم طلب تعديل على التصميم، ورجعت الحالة تحت التصميم. الرابط السابق للتصميم: ${order.designUrl || 'لا يوجد'}`,
            userId: user.id,
            userName: user.name || user.role || 'مستخدم',
            actorRole: user.role,
            designUrl: null,
        });

        updateOrderInState(updatedOrder);
        sessionStorage.removeItem(DESIGNER_DASHBOARD_CACHE_KEY);
        setDesignQueueView('pending');
    };

    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            if (!isDesignerDashboardOrderVisible(order)) return false;

            const s = (order.designStatus || 'pending');
            const matchesStatus = statusFilter === 'all' || s === statusFilter;
            const matchesDesigner = designerFilter === 'all' || order.designerId === designerFilter;
            const matchesSearch =
                order.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                order.caseId.toString().includes(searchQuery);

            const matchesDate = isDateInOpenRange(order.createdAt, dateRange);

            return matchesStatus && matchesDesigner && matchesSearch && matchesDate;
        });
    }, [orders, statusFilter, designerFilter, searchQuery, dateRange]);

    const stats = useMemo(() => ({
        total: orders.length,
        inProgress: orders.filter(o => o.designStatus === 'in_progress' || o.designStatus === 'accepted').length,
        waitingApproval: orders.filter(o => o.designStatus === 'waiting_approval').length,
        completed: orders.filter(o => o.designStatus === 'completed').length,
    }), [orders]);

    const pendingOrders = useMemo(
        () => filteredOrders.filter(order => !isDesignSubmitted(order) || returnedDesigns[order.id]?.revisionId === order.designRevisionId && !!returnedDesigns[order.id]),
        [filteredOrders, returnedDesigns]
    );

    const submittedOrders = useMemo(
        () => filteredOrders.filter(order => isDesignSubmitted(order) && !(returnedDesigns[order.id]?.revisionId === order.designRevisionId && returnedDesigns[order.id])),
        [filteredOrders, returnedDesigns]
    );

    const visibleOrders = designQueueView === 'submitted' ? submittedOrders : pendingOrders;

    const showDoctorName = Boolean(user && user.role !== 'designer');

    const openTextPreview = (title: string, content: string, accentClass: string) => {
        setExpandedTextPreview({ title, content, accentClass });
    };

    const getDoctorDisplayName = (doctorId?: string) => {
        if (!doctorId) return '-';

        const doctor = doctorsById.get(doctorId);
        if (!doctor) return '-';

        if (doctor.parentId) {
            const center = doctorsById.get(doctor.parentId);
            if (center?.name) {
                return `${doctor.name} (${center.name})`;
            }
        }

        return doctor.name;
    };

    const openDesignUploadModal = (order: Order) => {
        const unavailable = getDesignSubmissionError(order);
        if (unavailable) { toastError(unavailable); return; }
        setSelectedOrder(order);
        setShowDesignModal(true);
    };

    return (
        <div className={`space-y-6 animate-in fade-in ${embedded ? '' : 'pb-10'}`}>
            {/* Header Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-gray-50 text-gray-600 rounded-lg">
                        <FolderKanban size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">الكل</p>
                        <p className="text-xl font-bold text-gray-800">{stats.total}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-yellow-50 text-yellow-600 rounded-lg">
                        <Clock size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">جاري العمل</p>
                        <p className="text-xl font-bold text-gray-800">
                            {stats.inProgress}
                        </p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-teal-50 text-teal-600 rounded-lg">
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">انتظار الموافقة</p>
                        <p className="text-xl font-bold text-gray-800">
                            {stats.waitingApproval}
                        </p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-green-50 text-green-600 rounded-lg">
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">مكتمل</p>
                        <p className="text-xl font-bold text-gray-800">
                            {stats.completed}
                        </p>
                    </div>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-center justify-between">
                <div className="flex flex-wrap gap-4 items-center flex-1">
                    <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="بحث برقم الحالة أو اسم المريض..."
                            value={searchQuery}
                            aria-label="بحث عن حالة"
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pr-10 pl-4 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="فلترة بالحالة"
                        className="px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        <option value="all">كل الحالات</option>
                        <option value="pending">جديد</option>
                        <option value="accepted">تم القبول</option>
                        <option value="in_progress">جاري العمل</option>
                        <option value="waiting_approval">انتظار الموافقة</option>
                        <option value="completed">مكتمل</option>
                        <option value="returned">مرتجع</option>
                    </select>

                    {user && !isDesignerUser(user) && (
                        <select
                            value={designerFilter}
                            onChange={(e) => setDesignerFilter(e.target.value)}
                            aria-label="فلترة بالمصمم"
                            className="px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                            <option value="all">كل المصممين</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    )}

                    <DateRangeField
                        start={dateRange.start}
                        end={dateRange.end}
                        onChange={({ start, end }) => setDateRange({ ...dateRange, start, end })}
                    />
                </div>
            </div>

            {/* Orders List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                    <div>
                        <h3 className="text-sm font-bold text-gray-800">حالات التصميم</h3>
                        <p className="text-xs text-gray-400">افصل بين الحالات قبل رفع التصميم وبعد الرفع لتقليل اللخبطة</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setDesignQueueView('pending')}
                            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${designQueueView === 'pending' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                        >
                            قبل رفع التصميم ({pendingOrders.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setDesignQueueView('submitted')}
                            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${designQueueView === 'submitted' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                        >
                            بعد رفع التصميم ({submittedOrders.length})
                        </button>
                    </div>
                </div>
                {isLoading ? (
                    <div className="p-8 text-center text-gray-500">جاري التحميل...</div>
                ) : visibleOrders.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 flex flex-col items-center gap-4">
                        <FolderKanban size={48} className="opacity-20" />
                        <p>{designQueueView === 'pending' ? 'لا توجد حالات تصميم قبل الرفع' : 'لا توجد حالات تم رفع تصميمها'}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-right">
                            <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs font-bold uppercase">
                                <tr>
                                    <th className="px-4 py-4">رقم الحالة</th>
                                    <th className="px-6 py-4">المريض / الطبيب</th>
                                    <th className="px-5 py-4 w-[190px]">مراجعة المصمم</th>
                                    {user && !isDesignerUser(user) && <th className="px-6 py-4">المصمم</th>}
                                    <th className="px-6 py-4">تعليمات / تعليقات</th>
                                    <th className="px-6 py-4">الاستلام / التسليم / المدة</th>
                                    <th className="px-6 py-4">المرفقات / التسليم</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {visibleOrders.map(order => {
                                    const latestComment = getLatestVisibleOrderComment(order.comments);
                                    const submittedAt = getDesignSubmittedAt(order);
                                    const durationMs = getDesignerWorkDurationMs(order, nowMs);
                                    const durationLabel = durationMs !== null ? formatDesignerDuration(durationMs) : '-';
                                    return (
                                        <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-4 py-4 w-[150px]">
                                                <span
                                                    className="block max-w-[140px] truncate text-sm font-semibold text-gray-700"
                                                    title={`#${order.caseId}`}
                                                    dir="ltr"
                                                >
                                                    #{order.caseId}
                                                </span>
                                                {order.priority === 'Urgent' && (
                                                    <div className="mt-1">
                                                        <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">مستعجل</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">{order.patientName}</div>
                                                {showDoctorName && (
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        د. {getDoctorDisplayName(order.doctorId)}
                                                    </div>
                                                )}
                                            </td>
                                            {/* ── مراجعة المصمم column (position 3) ── */}
                                            <td className="px-4 py-4 align-top w-[190px]">
                                                <div className="flex flex-col gap-2 w-[170px]">
                                                    {order.doctorWaitReason && <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                                                        <strong>On Hold</strong>
                                                        <p className="mt-1 break-words">{order.doctorWaitReason}</p>
                                                    </div>}
                                                    {order.technicianStatus && order.technicianStatus !== 'Pending' && (
                                                        <span className={`inline-flex items-center justify-center text-[11px] font-bold px-3 py-1 rounded-full border ${
                                                            order.technicianStatus === 'Approved'
                                                                ? 'bg-green-50 text-green-700 border-green-200'
                                                                : order.technicianStatus === 'Rejected'
                                                                    ? 'bg-red-50 text-red-700 border-red-200'
                                                                    : 'bg-orange-50 text-orange-700 border-orange-200'
                                                        }`}>
                                                            {order.technicianStatus === 'Approved'
                                                                ? '✓ موافق'
                                                                : order.technicianStatus === 'Rejected'
                                                                    ? '× مرفوض'
                                                                    : '? محتاج تفاصيل'}
                                                        </span>
                                                    )}
                                                    <div className="flex flex-col gap-1">
                                                        <button type="button"
                                                            disabled={Boolean(order.doctorWaitReason)}
                                                            onClick={() => handleTechAction(order.id, 'Approved')}
                                                            className={`w-full py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                                                order.technicianStatus === 'Approved'
                                                                    ? 'bg-green-500 text-white border-green-500 shadow-sm'
                                                                    : 'bg-white text-green-700 border-green-200 hover:bg-green-50'
                                                            }`}>
                                                            ✓ قبول
                                                        </button>
                                                        <button type="button"
                                                            disabled={Boolean(order.doctorWaitReason)}
                                                            onClick={() => setTechActionPending({ orderId: order.id, action: 'NeedDetails', reason: '', causeCategory: '', responsibleStage: '' })}
                                                            className={`w-full py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                                                order.technicianStatus === 'NeedDetails'
                                                                    ? 'bg-orange-400 text-white border-orange-400 shadow-sm'
                                                                    : 'bg-white text-orange-700 border-orange-200 hover:bg-orange-50'
                                                            }`}>
                                                            ? تفاصيل
                                                        </button>
                                                        <button type="button"
                                                            disabled={Boolean(order.doctorWaitReason)}
                                                            onClick={() => setTechActionPending({ orderId: order.id, action: 'Rejected', reason: '', causeCategory: '', responsibleStage: '' })}
                                                            className={`w-full py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                                                order.technicianStatus === 'Rejected'
                                                                    ? 'bg-red-500 text-white border-red-500 shadow-sm'
                                                                    : 'bg-white text-red-700 border-red-200 hover:bg-red-50'
                                                            }`}>
                                                            × رفض
                                                        </button>
                                                    </div>
                                                    {techActionPending?.orderId === order.id && (
                                                        <div className="flex flex-col gap-1.5 pt-2 border-t border-gray-100 mt-1">
                                                            {techActionPending.action === 'Rejected' ? (
                                                                <IssueCauseFields
                                                                    issueContext="lab_rejection"
                                                                    causeCategory={techActionPending.causeCategory}
                                                                    onCauseCategoryChange={(code) => setTechActionPending(prev => prev ? { ...prev, causeCategory: code } : null)}
                                                                    responsibleStage={techActionPending.responsibleStage}
                                                                    onResponsibleStageChange={(stage) => setTechActionPending(prev => prev ? { ...prev, responsibleStage: stage } : null)}
                                                                    notes={techActionPending.reason}
                                                                    onNotesChange={(notes) => setTechActionPending(prev => prev ? { ...prev, reason: notes } : null)}
                                                                    notesPlaceholder="اكتب سبب الرفض…"
                                                                />
                                                            ) : (
                                                                <>
                                                                    <p className="text-[11px] font-semibold text-gray-500">
                                                                        التفاصيل المطلوبة *
                                                                    </p>
                                                                    <textarea autoFocus rows={3} maxLength={1000}
                                                                        placeholder="اكتب التفاصيل المطلوبة…"
                                                                        value={techActionPending.reason}
                                                                        onChange={(e) => setTechActionPending(prev => prev ? { ...prev, reason: e.target.value } : null)}
                                                                        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-300 text-right bg-gray-50"
                                                                    />
                                                                </>
                                                            )}
                                                            <div className="flex gap-1.5">
                                                                <button type="button"
                                                                    disabled={!techActionPending.reason.trim() || (techActionPending.action === 'Rejected' && !techActionPending.causeCategory)}
                                                                    onClick={() => handleTechAction(order.id, techActionPending.action, techActionPending.reason, techActionPending.causeCategory, techActionPending.responsibleStage)}
                                                                    className="flex-1 py-1.5 text-xs font-bold bg-primary-600 text-white rounded-lg disabled:opacity-40 hover:bg-primary-700 transition-colors"
                                                                >تأكيد</button>
                                                                <button type="button"
                                                                    onClick={() => setTechActionPending(null)}
                                                                    className="px-3 py-1.5 text-xs font-bold bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                                                                >إلغاء</button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            {user && !isDesignerUser(user) && (
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-gray-700">
                                                        {usersById.get(order.designerId)?.name || '-'}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1.5 min-w-[220px] max-w-[280px]">
                                                    {returnedDesigns[order.id]?.revisionId===order.designRevisionId&&returnedDesigns[order.id]?.feedback&&<p className="mb-2 whitespace-pre-wrap break-words rounded-lg bg-amber-50 p-2 text-xs text-amber-950"><strong>مطلوب تعديل التصميم</strong><br/>{returnedDesigns[order.id].feedback}</p>}
                                                    {order.supplierDesignInstruction?.paragraph&&<button type="button" onClick={()=>openTextPreview('التعليمات الفنية للمصمم',order.supplierDesignInstruction?.paragraph??'','bg-cyan-50 border-cyan-100 text-cyan-900')} className="w-full cursor-pointer rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2 text-right text-xs text-cyan-900 transition-colors hover:bg-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-600"><span className="mb-1 block font-bold">التعليمات الفنية للمصمم{order.supplierDesignInstruction.version?` · نسخة ${order.supplierDesignInstruction.version}`:''}</span><span className="line-clamp-3 leading-6">{order.supplierDesignInstruction.paragraph}</span></button>}
                                                    {order.instructions ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => openTextPreview('تعليمات الحالة', order.instructions || '', 'bg-amber-50 border-amber-100 text-amber-800')}
                                                            className="flex w-full items-start gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-2 py-1.5 text-right text-xs text-amber-800 transition hover:bg-amber-100/70"
                                                        >
                                                            <StickyNote size={13} className="mt-0.5 shrink-0 text-amber-600" />
                                                            <span className="line-clamp-2 font-semibold">{order.instructions}</span>
                                                        </button>
                                                    ) : null}
                                                    {latestComment ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => openTextPreview(`تعليق ${latestComment.userName}`, latestComment.text, 'bg-blue-50 border-blue-100 text-blue-800')}
                                                            className="flex w-full items-start gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 text-right text-xs text-blue-800 transition hover:bg-blue-100/70"
                                                        >
                                                            <MessageCircle size={13} className="mt-0.5 shrink-0 text-blue-600" />
                                                            <span className="line-clamp-2">
                                                                <span className="font-bold">{latestComment.userName}: </span>
                                                                {latestComment.text}
                                                            </span>
                                                        </button>
                                                    ) : null}
                                                    {!order.instructions && !latestComment && (
                                                        <span className="text-xs text-gray-300">-</span>
                                                    )}
                                                    <div className="mt-1 flex items-center gap-1.5">
                                                        <input
                                                            type="text"
                                                            value={commentDrafts[order.id] || ''}
                                                            onChange={(e) => setCommentDrafts(prev => ({ ...prev, [order.id]: e.target.value }))}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                    handleAddComment(order);
                                                                }
                                                            }}
                                                            placeholder="اكتب تعليق..."
                                                            aria-label="إضافة تعليق للحالة"
                                                            className="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAddComment(order)}
                                                            disabled={!commentDrafts[order.id]?.trim()}
                                                            className="h-8 rounded-lg bg-blue-600 px-2.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                        >
                                                            إضافة
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600" dir="ltr">
                                                <div className="min-w-[170px] space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-bold text-gray-400">استلام</span>
                                                        <span>{format(new Date(order.createdAt), 'dd/MM/yyyy')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-bold text-gray-400">تسليم</span>
                                                        <span>{format(new Date(order.deliveryDate), 'dd/MM/yyyy')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-bold text-gray-400">مدة التصميم</span>
                                                        <span className={submittedAt ? 'text-emerald-700' : 'text-amber-700'}>
                                                            {durationLabel}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-2 min-w-[220px]">
                                                    <div className="flex gap-2 flex-wrap">
                                                        <button
                                                            type="button"
                                                            disabled={Boolean(order.doctorWaitReason)}
                                                            onClick={() => openDesignUploadModal(order)}
                                                            className={`text-xs flex items-center gap-1 px-2 py-1 rounded-md border transition ${(order.designUrl || order.designRevisionId) ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100'}`}
                                                        >
                                                            <LinkIcon size={12} />
                                                            {(order.designUrl || order.designRevisionId) ? 'تحديث التصميم' : 'رفع التصميم'}
                                                        </button>
                                                    </div>
                                                    <div className="flex gap-2 flex-wrap">
                                                        {(order.designUrl||order.designRevisionId||order.designSubmittedAt)&&<button type="button" onClick={()=>setViewingDesign(order)} className="min-h-9 cursor-pointer rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800 transition-colors hover:bg-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-600">عرض التصميم</button>}
                                                        {order.stlUrl && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenExternalUrl(order.stlUrl, 'رابط ملف STL غير صالح أو معطوب')}
                                                                className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-md border border-blue-100"
                                                            >
                                                                <Upload size={12} /> STL
                                                            </button>
                                                        )}
                                                        {order.imagesUrl && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenExternalUrl(order.imagesUrl, 'رابط الصور غير صالح أو معطوب')}
                                                                className="text-teal-600 hover:text-teal-800 text-xs flex items-center gap-1 bg-teal-50 px-2 py-1 rounded-md border border-teal-100"
                                                            >
                                                                <FolderKanban size={12} /> صور
                                                            </button>
                                                        )}
                                                        {(order.designUrl || order.designRevisionId) && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void openDesignExecution(order.id,order.designUrl).catch(e=>toastError(e.message))}
                                                                    className="text-amber-700 hover:text-amber-800 text-xs flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-md border border-amber-100"
                                                                >
                                                                    <LinkIcon size={12} /> تحميل التصميم
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void designExecutionUrl(order.id,order.designUrl).then(handleCopyDesignUrl).catch(e=>toastError(e.message))}
                                                                    aria-label="نسخ أحدث رابط تصميم"
                                                                    title="نسخ أحدث رابط تصميم"
                                                                    className="text-amber-700 hover:text-amber-800 text-xs flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-md border border-amber-100"
                                                                >
                                                                    <Copy size={12} /> نسخ
                                                                </button>
                                                            </>
                                                        )}
                                                        {isDesignSubmitted(order) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => requestDesignRevision(order)}
                                                                className="text-red-700 hover:text-red-800 text-xs flex items-center gap-1 bg-red-50 px-2 py-1 rounded-md border border-red-100 transition hover:bg-red-100"
                                                            >
                                                                <AlertCircle size={12} /> طلب تعديل تصميم
                                                            </button>
                                                        )}
                                                    </div>
                                                    {submittedAt && (
                                                        <div className="text-[11px] text-emerald-700">
                                                            تم الرفع: {format(new Date(submittedAt), 'dd/MM/yyyy HH:mm')}
                                                        </div>
                                                    )}
                                                    <div className="text-xs text-gray-500 max-w-[200px] truncate">
                                                        {order.items.map(i => `${i.serviceType} x${i.teethNumbers.length}`).join(', ')}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {expandedTextPreview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">{expandedTextPreview.title}</h3>
                                <p className="mt-1 text-xs text-gray-400">عرض كامل للنص</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setExpandedTextPreview(null)}
                                className="rounded-lg px-3 py-1.5 text-sm font-bold text-gray-500 transition hover:bg-gray-100"
                            >
                                إغلاق
                            </button>
                        </div>
                        <div className={`max-h-[60vh] overflow-y-auto rounded-xl border p-4 text-sm leading-7 ${expandedTextPreview.accentClass}`}>
                            <p className="whitespace-pre-wrap break-words">{expandedTextPreview.content}</p>
                        </div>
                    </div>
                </div>
            )}

            {viewingDesign&&<DesignerDesignViewer orderId={viewingDesign.id} caseId={viewingDesign.caseId} legacyUrl={viewingDesign.designUrl} onClose={()=>setViewingDesign(null)}/>}
            {showDesignModal && selectedOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
                    <div role="dialog" aria-modal="true" aria-label="تسليم التصميم" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
                        <div className="mb-5 flex items-center justify-between"><span className="text-sm font-medium text-slate-500">{selectedOrder.caseId}</span><button type="button" className="min-h-11 cursor-pointer rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100" onClick={()=>{setShowDesignModal(false);setSelectedOrder(null);}}>إغلاق</button></div>
                        {returnedDesigns[selectedOrder.id]?.revisionId===selectedOrder.designRevisionId&&returnedDesigns[selectedOrder.id]?.feedback&&<p className="mb-4 whitespace-pre-wrap break-words rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><strong>ملاحظات المراجعة</strong><br/>{returnedDesigns[selectedOrder.id].feedback}</p>}
                        <DesignDeliveryForm orderId={selectedOrder.id} onSubmitted={async()=>{updateOrderInState(await db.getOrder(selectedOrder.id));setShowDesignModal(false);setSelectedOrder(null);setDesignQueueView('submitted');success('تم حفظ نسخة التصميم');}}/>
                    </div>
                </div>
            )}
        </div>
    );
}
