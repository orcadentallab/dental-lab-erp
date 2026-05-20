/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { useEffect, useState, useMemo } from 'react';
import { differenceInCalendarDays, format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { db, type Order, type Supplier, type User, type Doctor, type OrderHistoryEntry } from '../services/db';
import { AlertTriangle, Clock, CheckCircle, UserCheck, Package, Building2, TrendingUp, PlusCircle, UserPlus, HelpCircle, Printer, MessageSquare, PhoneCall, CheckSquare } from 'lucide-react';
import { contactService, type ContactInquiry } from '../services/contactService';
import AlertCard from '../components/dashboard/AlertCard';
import OrderForm from '../components/orders/OrderForm';
import DoctorForm from '../components/doctors/DoctorForm';
import OrderListModal from '../components/dashboard/OrderListModal';
import OrderListItem from '../components/dashboard/OrderListItem';
import DailySummaryPrint from '../components/dashboard/DailySummaryPrint';
import AcceptOrderModal from '../components/orders/AcceptOrderModal';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import DesignerDashboard from './DesignerDashboard';
import { useTranslation } from '../translations';
import { isDesignerUser } from '../lib/userRoles';
import { formatDesignerDuration, getDesignSubmittedAt, getDesignerWorkDurationMs, isDesignSubmitted } from '../lib/designerOrderUtils';
import { useToast } from '../context/ToastContext';
import { ErrorHandler } from '../lib/errorHandler';
import { useNavigate } from 'react-router-dom';
import { DELIVERY_DATE_AUDIT_PREFIX, isInternalDeliveryDateAuditComment } from '../utils/orderDisplay';

const DASHBOARD_CACHE_KEY = 'dashboard-cache-v1';
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const REVIEWED_DELIVERY_CHANGE_IDS_KEY = 'reviewedDeliveryChangeIds';

interface DashboardCache {
    userId: string;
    userRole: string;
    userEntityId?: string;
    savedAt: number;
    orders: Order[];
    suppliers: Supplier[];
    users: User[];
    doctors: Doctor[];
    contactInquiries: ContactInquiry[];
    ordersWithComments: Order[];
    designerOrders?: Order[];
    recentOrderHistory?: OrderHistoryEntry[];
}

export default function DashboardNew() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [orders, setOrders] = useState<Order[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);

    // Modal states
    const [showOrderForm, setShowOrderForm] = useState(false);
    const [showDoctorForm, setShowDoctorForm] = useState(false);
    const [showDailySummary, setShowDailySummary] = useState(false);
    const [activeModal, setActiveModal] = useState<string | null>(null);
    const [acceptingOrder, setAcceptingOrder] = useState<Order | null>(null);
    const [editingDeliveryOrder, setEditingDeliveryOrder] = useState<Order | null>(null);
    const [editingDeliveryDate, setEditingDeliveryDate] = useState('');
    const [isSavingDeliveryDate, setIsSavingDeliveryDate] = useState(false);
    const [contactInquiries, setContactInquiries] = useState<ContactInquiry[]>([]);
    const [ordersWithComments, setOrdersWithComments] = useState<Order[]>([]);
    const [designerOrders, setDesignerOrders] = useState<Order[]>([]);
    const [recentOrderHistory, setRecentOrderHistory] = useState<OrderHistoryEntry[]>([]);
    const [designerTimelineView, setDesignerTimelineView] = useState<'pending' | 'submitted'>('pending');
    // Track which comment IDs have been resolved (dismissed) — stored in localStorage
    const [resolvedCommentIds, setResolvedCommentIds] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem('resolvedCommentIds');
            return stored ? new Set(JSON.parse(stored) as string[]) : new Set<string>();
        } catch {
            return new Set<string>();
        }
    });
    const [reviewedDeliveryChangeIds, setReviewedDeliveryChangeIds] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem(REVIEWED_DELIVERY_CHANGE_IDS_KEY);
            return stored ? new Set(JSON.parse(stored) as string[]) : new Set<string>();
        } catch {
            return new Set<string>();
        }
    });
    const { t } = useTranslation();
    const isDualRepDesigner = user?.role === 'representative' && isDesignerUser(user);
    const canViewDesignerWorkspace = Boolean(user && isDesignerUser(user) && user.role !== 'admin');
    const canViewCommentAlerts = user?.role === 'admin';
    const canViewDeliveryFollowUp = user?.role === 'admin' || user?.role === 'representative';
    const canEditDeliveryDates = user?.role === 'admin' || user?.role === 'representative';
    const goToOrder = (order: Order) => {
        const params = new URLSearchParams({
            q: order.caseId,
            highlight: order.id
        });
        navigate(`/orders?${params.toString()}`);
    };

    useEffect(() => {
        if (!user) return;

        let restoredFromCache = false;

        try {
            const rawCache = sessionStorage.getItem(DASHBOARD_CACHE_KEY);
            if (rawCache) {
                const cache = JSON.parse(rawCache) as DashboardCache;
                const isSameUser = cache.userId === user.id && cache.userRole === user.role && cache.userEntityId === user.entityId;
                const isFresh = Date.now() - cache.savedAt < DASHBOARD_CACHE_TTL_MS;

                if (isSameUser && isFresh) {
                    setOrders(cache.orders);
                    setSuppliers(cache.suppliers);
                    setUsers(cache.users);
                    setDoctors(cache.doctors);
                    setContactInquiries(cache.contactInquiries);
                    setOrdersWithComments(cache.ordersWithComments);
                    setDesignerOrders(cache.designerOrders || []);
                    setRecentOrderHistory(cache.recentOrderHistory || []);
                    setIsLoading(false);
                    restoredFromCache = true;
                }
            }
        } catch (error) {
            console.warn('Could not restore dashboard cache:', error);
        }

        const loadData = async () => {
            if (!restoredFromCache) {
                setIsLoading(true);
            }
            try {
                const baseRequests = [
                    db.getDashboardActiveOrders(),
                    db.getSuppliers(),
                    db.getUsers(),
                    db.getDoctors(),
                    contactService.getInquiries('new').catch(() => [] as ContactInquiry[]),
                    db.getOrdersWithComments().catch(() => [] as Order[]),
                ] as const;

                const [ordersData, suppliersData, usersData, doctorsData, inquiriesData, commentOrdersData, designerOrdersData, recentOrderHistoryData] =
                    user?.role === 'admin'
                        ? await Promise.all([
                            ...baseRequests,
                            db.getDesignerDashboardOrders().catch(() => [] as Order[]),
                            db.getRecentOrderHistory(250).catch(() => [] as OrderHistoryEntry[]),
                        ] as const)
                        : [...await Promise.all(baseRequests), undefined, undefined] as const;

                // Apply role-based filtering
                let filteredOrders = ordersData;
                if (user?.role === 'lab') {
                    filteredOrders = ordersData.filter(o => {
                        if (!user.entityId || o.supplierId !== user.entityId) return false;
                        const isSplitWithDesigner = o.workflowType === 'split' && o.designerId;
                        if (isSplitWithDesigner) {
                            const visibleStatuses = ['Under Production', 'Try In', 'Try In Approved', 'Ready', 'Delivered', 'Returned for Adjustments'];
                            return visibleStatuses.includes(o.status);
                        }
                        return true;
                    });
                } else if (user?.role === 'designer') {
                    filteredOrders = ordersData.filter(o => o.designerId === user.id);
                }

                setOrders(filteredOrders);
                setSuppliers(suppliersData);
                setUsers(usersData);
                setDoctors(doctorsData);
                setContactInquiries(inquiriesData);
                setOrdersWithComments(commentOrdersData);
                setDesignerOrders((designerOrdersData as Order[] | undefined) || []);
                setRecentOrderHistory((recentOrderHistoryData as OrderHistoryEntry[] | undefined) || []);

                try {
                    const cachePayload: DashboardCache = {
                        userId: user.id,
                        userRole: user.role,
                        userEntityId: user.entityId,
                        savedAt: Date.now(),
                        orders: filteredOrders,
                        suppliers: suppliersData,
                        users: usersData,
                        doctors: doctorsData,
                        contactInquiries: inquiriesData,
                        ordersWithComments: commentOrdersData,
                        designerOrders: (designerOrdersData as Order[] | undefined) || [],
                        recentOrderHistory: (recentOrderHistoryData as OrderHistoryEntry[] | undefined) || [],
                    };
                    sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(cachePayload));
                } catch (error) {
                    console.warn('Could not save dashboard cache:', error);
                }
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [user]);

    // Computed alert data
    const today = new Date().toISOString().split('T')[0];
    const nowMs = Date.now();

    const pendingApprovalOrders = orders.filter(o => {
        if (o.technicianStatus === 'Rejected') return false; // Exclude rejected by lab
        if (o.status !== 'New Case') return false;
        if (o.workflowType === 'split' && o.designerId) return true;
        if (o.supplierId) return true;
        return false;
    });

    // Truly rejected (terminal) — gets archive action
    const rejectedOrders = orders.filter(o => o.status === 'Rejected');

    // Returned for rework — still active, will go back to Delivered when done
    const returnedOrders = orders.filter(o => o.status === 'Returned for Adjustments');

    const overdueOrders = orders.filter(o =>
        o.deliveryDate < today &&
        !['Delivered', 'Rejected', 'Cancelled'].includes(o.status)
    );

    const activeDeliveryOrders = orders.filter(o =>
        Boolean(o.deliveryDate) &&
        !['Delivered', 'Rejected', 'Cancelled'].includes(o.status)
    );

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().split('T')[0];

    const normalizeDeliveryDate = (date: string) => {
        const directDateMatch = date.match(/^\d{4}-\d{2}-\d{2}/);
        if (directDateMatch) return directDateMatch[0];

        const parsedDate = new Date(date);
        if (Number.isNaN(parsedDate.getTime())) return '';

        return parsedDate.toISOString().split('T')[0];
    };

    const dueTodayOrders = activeDeliveryOrders.filter(o => normalizeDeliveryDate(o.deliveryDate) === today);
    const dueTomorrowOrders = activeDeliveryOrders.filter(o => normalizeDeliveryDate(o.deliveryDate) === tomorrowKey);
    const dueLaterOrders = activeDeliveryOrders.filter(o => normalizeDeliveryDate(o.deliveryDate) > tomorrowKey);
    const designPhaseOrders = orders.filter(o =>
        ['Under Design', 'Waiting Dr Approval'].includes(o.status)
    );

    const tryInOrders = orders.filter(o => o.status === 'Try In');



    // Orders without assigned lab
    const unassignedLabOrders = orders.filter(o =>
        !o.supplierId && o.status !== 'Delivered' && o.status !== 'Rejected'
    );

    // Orders needing attention (PMMA or NeedDetails requested by lab/designer)
    const needsAttentionOrders = orders.filter(o =>
        o.technicianStatus === 'PMMA_First' || o.technicianStatus === 'NeedDetails'
    );

    // Orders from Doctors needing review
    const doctorRequests = orders.filter(o => o.status === 'Pending Review');

    // --- Statistics Data ---
    const activeOrdersCount = orders.filter(o => !['Delivered', 'Cancelled', 'Rejected'].includes(o.status)).length;
    const ordersTodayCount = orders.filter(o => o.createdAt.startsWith(today)).length;
    const readyOrdersCount = orders.filter(o => o.status === 'Ready').length;

    const designerSubmittedOrders = useMemo(
        () => designerOrders.filter(order => isDesignSubmitted(order)),
        [designerOrders]
    );

    const getOrderUnitsCount = (order: Order) => {
        return order.items.reduce((total, item) => total + Math.max(item.teethNumbers.length, 1), 0);
    };

    const getRowsUnitsCount = (rows: { order: Order }[]) => {
        return rows.reduce((total, row) => total + getOrderUnitsCount(row.order), 0);
    };

    const designerPerformanceRows = useMemo(() => {
        return designerSubmittedOrders
            .map(order => {
                const submittedAt = getDesignSubmittedAt(order);
                const durationMs = getDesignerWorkDurationMs(order, nowMs);

                return {
                    order,
                    submittedAt,
                    durationMs,
                };
            })
            .sort((a, b) => new Date(b.submittedAt || b.order.createdAt).getTime() - new Date(a.submittedAt || a.order.createdAt).getTime());
    }, [designerSubmittedOrders, nowMs]);

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

    const visibleDesignerTimelineRows = designerTimelineView === 'submitted'
        ? submittedDesignerTimelineRows
        : pendingDesignerTimelineRows;

    const pendingDesignerUnitsCount = getRowsUnitsCount(pendingDesignerTimelineRows);
    const submittedDesignerUnitsCount = getRowsUnitsCount(submittedDesignerTimelineRows);

    const designerTimelineGroups = useMemo(() => {
        const groups = new Map<string, {
            designerId: string;
            designerName: string;
            rows: typeof designerTimelineRows;
        }>();

        visibleDesignerTimelineRows.forEach(row => {
            const designerId = row.order.designerId || 'unassigned';
            const designerName = users.find(appUser => appUser.id === row.order.designerId)?.name || 'غير محدد';

            if (!groups.has(designerId)) {
                groups.set(designerId, {
                    designerId,
                    designerName,
                    rows: [],
                });
            }

            groups.get(designerId)?.rows.push(row);
        });

        return Array.from(groups.values());
    }, [users, visibleDesignerTimelineRows]);

    const dailyDesignerCount = useMemo(() => {
        return designerPerformanceRows.filter(({ submittedAt }) =>
            submittedAt && submittedAt.startsWith(today)
        ).length;
    }, [designerPerformanceRows, today]);

    const weeklyDesignerCount = useMemo(() => {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekAgoMs = weekAgo.getTime();
        return designerPerformanceRows.filter(({ submittedAt }) => {
            if (!submittedAt) return false;
            return new Date(submittedAt).getTime() >= weekAgoMs;
        }).length;
    }, [designerPerformanceRows]);

    const monthlyDesignerCount = useMemo(() => {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        const monthAgoMs = monthAgo.getTime();
        return designerPerformanceRows.filter(({ submittedAt }) => {
            if (!submittedAt) return false;
            return new Date(submittedAt).getTime() >= monthAgoMs;
        }).length;
    }, [designerPerformanceRows]);

    const averageDesignerDuration = useMemo(() => {
        const finishedRows = designerPerformanceRows.filter(row => row.durationMs !== null);
        if (finishedRows.length === 0) return null;

        const totalDuration = finishedRows.reduce((sum, row) => sum + (row.durationMs || 0), 0);
        return Math.round(totalDuration / finishedRows.length);
    }, [designerPerformanceRows]);

    // Quality Stats
    const labRejections = orders.filter(o => o.technicianStatus === 'Rejected');

    // Helper to resolve (dismiss) a comment
    const resolveComment = (commentId: string) => {
        setResolvedCommentIds(prev => {
            const next = new Set(prev);
            next.add(commentId);
            try {
                localStorage.setItem('resolvedCommentIds', JSON.stringify([...next]));
            } catch { /* ignore */ }
            return next;
        });
    };

    const markDeliveryChangeReviewed = (reviewKey: string) => {
        setReviewedDeliveryChangeIds(prev => {
            const next = new Set(prev);
            next.add(reviewKey);
            try {
                localStorage.setItem(REVIEWED_DELIVERY_CHANGE_IDS_KEY, JSON.stringify([...next]));
            } catch { /* ignore */ }
            return next;
        });
    };

    // Build flat list of unresolved comments across all orders with comments
    const unresolvedCommentItems = canViewCommentAlerts
        ? ordersWithComments.flatMap(order =>
            (order.comments || [])
                .filter(c => c.userId !== 'system' && c.userId !== 'System' && !isInternalDeliveryDateAuditComment(c) && !resolvedCommentIds.has(c.id))
                .map(c => ({ comment: c, order }))
        )
        : [];

    function parseDeliveryDateAuditComment(text: string) {
        if (!text.startsWith(`${DELIVERY_DATE_AUDIT_PREFIX}|`)) return null;

        const [, oldDate, newDate, userId, userName, role] = text.split('|');
        return {
            oldDate: normalizeDeliveryDate(oldDate || ''),
            newDate: normalizeDeliveryDate(newDate || ''),
            userId: userId || '',
            userName: userName || 'Unknown',
            role: role || '',
        };
    }

    const representativeUserIds = useMemo(() => {
        return new Set(
            users
                .filter(appUser => appUser.role === 'representative')
                .map(appUser => appUser.id)
        );
    }, [users]);

    const representativeDeliveryDateChanges = useMemo(() => {
        const latestChangesByOrder = new Map<string, {
            reviewKey: string;
            order: Order;
            actorName: string;
            changedAt: string;
            oldDate: string;
            newDate: string;
        }>();

        recentOrderHistory.forEach(historyEntry => {
            const deliveryDateChange = historyEntry.changes?.delivery_date;
            if (!deliveryDateChange || !historyEntry.order_id || !historyEntry.user_id) return;
            if (!representativeUserIds.has(historyEntry.user_id)) return;

            const oldDate = typeof deliveryDateChange.old === 'string' ? normalizeDeliveryDate(deliveryDateChange.old) : '';
            const newDate = typeof deliveryDateChange.new === 'string' ? normalizeDeliveryDate(deliveryDateChange.new) : '';
            if (!oldDate || !newDate || oldDate === newDate) return;

            const relatedOrder = orders.find(order => order.id === historyEntry.order_id);
            if (!relatedOrder) return;
            if (['Delivered', 'Cancelled', 'Rejected'].includes(relatedOrder.status)) return;

            if (!latestChangesByOrder.has(relatedOrder.id)) {
                latestChangesByOrder.set(relatedOrder.id, {
                    reviewKey: `history-${historyEntry.id}`,
                    order: relatedOrder,
                    actorName: historyEntry.user_name,
                    changedAt: historyEntry.created_at,
                    oldDate,
                    newDate,
                });
            }
        });

        orders.forEach(order => {
            if (latestChangesByOrder.has(order.id)) return;
            if (['Delivered', 'Cancelled', 'Rejected'].includes(order.status)) return;

            const auditComment = [...(order.comments || [])]
                .reverse()
                .find(comment => comment.userId === 'system' && comment.text.startsWith(`${DELIVERY_DATE_AUDIT_PREFIX}|`));

            if (!auditComment) return;

            const parsedAudit = parseDeliveryDateAuditComment(auditComment.text);
            if (!parsedAudit || parsedAudit.role !== 'representative') return;
            if (!parsedAudit.oldDate || !parsedAudit.newDate || parsedAudit.oldDate === parsedAudit.newDate) return;

            latestChangesByOrder.set(order.id, {
                reviewKey: `audit-${order.id}-${auditComment.id}`,
                order,
                actorName: parsedAudit.userName,
                changedAt: auditComment.createdAt,
                oldDate: parsedAudit.oldDate,
                newDate: parsedAudit.newDate,
            });
        });

        return Array.from(latestChangesByOrder.values())
            .filter(change => !reviewedDeliveryChangeIds.has(change.reviewKey))
            .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
    }, [orders, recentOrderHistory, representativeUserIds, reviewedDeliveryChangeIds]);

    // Helper functions
    const doctorsMap = useMemo(() => {
        return doctors.reduce((acc, doc) => {
            acc[doc.id] = doc.name;
            return acc;
        }, {} as Record<string, string>);
    }, [doctors]);

    const suppliersMap = useMemo(() => {
        return suppliers.reduce((acc, sup) => {
            acc[sup.id] = sup.name;
            return acc;
        }, {} as Record<string, string>);
    }, [suppliers]);

    const getLabName = (supplierId?: string) => {
        return suppliers.find(s => s.id === supplierId)?.name;
    };

    const getDesignerName = (designerId?: string) => {
        return users.find(u => u.id === designerId)?.name;
    };

    const getDoctorDisplayName = (doctorId?: string) => {
        if (!doctorId) return '-';

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

    const getDeliveryDateStatusLabel = (deliveryDate?: string) => {
        if (!deliveryDate) return '-';

        const normalizedDate = normalizeDeliveryDate(deliveryDate);
        if (!normalizedDate) return '-';

        const deliveryDateObj = new Date(normalizedDate);
        if (Number.isNaN(deliveryDateObj.getTime())) return '-';

        const daysDifference = differenceInCalendarDays(deliveryDateObj, new Date(today));

        if (daysDifference < 0) {
            const overdueBy = Math.abs(daysDifference);
            return overdueBy === 1 ? 'متأخرة من يوم' : `متأخرة من ${overdueBy} أيام`;
        }

        if (daysDifference === 0) return 'مطلوبة اليوم';
        if (daysDifference === 1) return 'مطلوبة غدا';
        if (daysDifference === 2) return 'مطلوبة بعد غد';

        return `مطلوبة بعد ${daysDifference} أيام`;
    };

    const getDeliveryDateChangeReviewLabel = (change: {
        actorName: string;
        changedAt: string;
        oldDate: string;
        newDate: string;
    }) => {
        const changedAt = format(new Date(change.changedAt), 'dd/MM HH:mm');
        return (
            <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1 text-[11px] font-semibold">
                    <span className="rounded-md bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-900/20 dark:text-red-300">
                        قبل: {change.oldDate}
                    </span>
                    <span className="text-surface-400">←</span>
                    <span className="rounded-md bg-green-50 px-2 py-0.5 text-green-700 dark:bg-green-900/20 dark:text-green-300">
                        بعد: {change.newDate}
                    </span>
                </div>
                <div className="text-[10px] text-surface-500 dark:text-surface-400">
                    {change.actorName} · {changedAt}
                </div>
            </div>
        );
    };

    const getDesignerStatusLabel = (order: Order) => {
        if (order.designStatus) {
            const map: Record<string, string> = {
                pending: 'منتظر',
                accepted: 'مقبول',
                in_progress: 'تصميم',
                waiting_approval: 'موافقة',
                completed: 'مكتمل',
                returned: 'مرتجع',
            };
            return map[order.designStatus] || order.designStatus;
        }

        return order.status === 'Rejected' ? 'رفض دكتور' : order.status;
    };

    const getDesignerStatusClass = (order: Order) => {
        if (order.designStatus === 'completed' || order.status === 'Ready') {
            return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
        }
        if (order.designStatus === 'returned' || order.status === 'Rejected' || order.status === 'Returned for Adjustments') {
            return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
        }
        if (order.designStatus === 'waiting_approval' || order.status === 'Waiting Dr Approval') {
            return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
        }
        if (order.designStatus === 'in_progress' || order.status === 'Under Design') {
            return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
        }

        return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
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
                setDesignerTimelineView('pending');
            }
        } catch (error) {
            toast.error(ErrorHandler.getUserMessage(error) || 'فشل إرجاع الحالة تحت التصميم');
        }
    };



    const handleArchiveOrder = async (orderId: string) => {
        if (user?.role !== 'admin') return;
        try {
            await db.updateOrder(orderId, { isArchived: true });
            // Remove from local state immediately to hide from alerts
            setOrders(prev => prev.filter(o => o.id !== orderId));
        } catch (error) {
            console.error('Error archiving order:', error);
            alert('Failed to archive order');
        }
    };



    const handleAcceptOrder = async (data: {
        caseId: string;
        workflowType: 'full' | 'split';
        supplierId: string;
        designerId?: string;
        receivedDate: string;
        deliveryDate: string;
    }) => {
        if (!acceptingOrder) return;

        try {
            await db.updateOrder(acceptingOrder.id, {
                status: 'New Case', // Or 'Under Design' if split? Usually 'New Case' starts the flow.
                ...data,
                // If Full Lab -> TechnicianStatus might need set? Default 'Pending' is fine.
                // If Split -> DesignStatus='pending' is handled by Modal 'data' spread? No, Modal returns type/ids.
                designStatus: data.workflowType === 'split' ? 'pending' : undefined,
                technicianStatus: 'Pending',
                isRegistered: true, // Auto register? Maybe.
            });

            // Optimistic update or reload
            window.location.reload();
        } catch (error) {
            console.error('Error accepting order:', error);
        } finally {
            setAcceptingOrder(null);
        }
    };

    const openDeliveryDateEditor = (order: Order) => {
        setEditingDeliveryOrder(order);
        setEditingDeliveryDate(normalizeDeliveryDate(order.deliveryDate));
    };

    const handleUpdateDeliveryDate = async () => {
        if (!editingDeliveryOrder || !editingDeliveryDate) {
            toast.warning('يرجى اختيار تاريخ التسليم الجديد');
            return;
        }

        const currentDeliveryDate = normalizeDeliveryDate(editingDeliveryOrder.deliveryDate);
        if (currentDeliveryDate === editingDeliveryDate) {
            toast.info('لم يتم تغيير تاريخ التسليم');
            return;
        }

        setIsSavingDeliveryDate(true);
        try {
            const currentOrder = await db.getOrder(editingDeliveryOrder.id);
            if (!currentOrder) {
                throw new Error('Order not found');
            }

            const nextComments = [...(currentOrder.comments || [])];
            nextComments.push({
                id: crypto.randomUUID(),
                text: `${DELIVERY_DATE_AUDIT_PREFIX}|${currentDeliveryDate}|${editingDeliveryDate}|${user?.id || ''}|${user?.name || 'Unknown'}|${user?.role || ''}`,
                userId: 'system',
                userName: 'System',
                createdAt: new Date().toISOString(),
            });

            const updatedOrder = await db.updateOrder(editingDeliveryOrder.id, {
                deliveryDate: editingDeliveryDate,
                comments: nextComments,
            }, {
                userId: user?.id,
                actorRole: user?.role,
                deliveryDateResponsibilityParty: 'unknown',
                deliveryDateChangeSource: 'dashboard',
            });

            if (!updatedOrder) {
                throw new Error('Failed to update delivery date');
            }

            const savedDeliveryDate = normalizeDeliveryDate(updatedOrder.deliveryDate);
            if (savedDeliveryDate !== editingDeliveryDate) {
                throw new Error(`Delivery date was not persisted. Expected ${editingDeliveryDate}, got ${savedDeliveryDate || 'empty'}`);
            }

            setOrders(prev => prev.map(order => (
                order.id === editingDeliveryOrder.id
                    ? updatedOrder
                    : order
            )));
            setDesignerOrders(prev => prev.map(order => (
                order.id === editingDeliveryOrder.id
                    ? updatedOrder
                    : order
            )));

            if (user?.role === 'admin') {
                const refreshedHistory = await db.getRecentOrderHistory(250).catch(() => [] as OrderHistoryEntry[]);
                setRecentOrderHistory(refreshedHistory);
            }

            sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
            toast.success('تم تحديث تاريخ التسليم');
            setEditingDeliveryOrder(null);
            setEditingDeliveryDate('');
        } catch (error) {
            console.error('Error updating delivery date:', error);
            toast.error(ErrorHandler.getUserMessage(error));
        } finally {
            setIsSavingDeliveryDate(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">{t.common.loading}</p>
                </div>
            </div>
        );
    }




    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-white">{t.dashboard.title}</h1>
                    <p className="text-gray-500 dark:text-gray-400">{t.dashboard.welcome}, {user?.name} 👋</p>
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2">
                    {(user?.role === 'admin' || user?.role === 'representative') && (
                        <>
                            <button
                                onClick={() => setShowOrderForm(true)}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                <PlusCircle size={18} />
                                <span>{t.dashboard.newOrder}</span>
                            </button>
                            <button
                                onClick={() => setShowDoctorForm(true)}
                                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                <UserPlus size={18} />
                                <span>{t.dashboard.newDoctor}</span>
                            </button>
                        </>
                    )}
                    {(user?.role === 'admin' || user?.role === 'accountant') && (
                        <>
                            <button
                                onClick={() => window.location.href = '/accounts'}
                                className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                <TrendingUp size={18} />
                                <span>{t.dashboard.accountStatement}</span>
                            </button>
                            <button
                                onClick={() => window.location.href = '/finance'}
                                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                <Package size={18} />
                                <span>{t.dashboard.recordExpense}</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {canViewDesignerWorkspace && (
                <>
                    {isDualRepDesigner && (
                        <div className="flex flex-wrap gap-2 bg-white dark:bg-gray-800 rounded-xl p-2 border border-gray-100 dark:border-gray-700 shadow-sm">
                            <a href="#rep-dashboard" className="px-4 py-2 rounded-lg text-sm font-bold transition-colors bg-blue-600 text-white">
                                شغل المندوب
                            </a>
                            <a href="#designer-dashboard" className="px-4 py-2 rounded-lg text-sm font-bold transition-colors bg-amber-600 text-white">
                                شغل التصميم
                            </a>
                        </div>
                    )}

                    <section id="designer-dashboard" className="scroll-mt-24">
                        <DesignerDashboard embedded />
                    </section>
                </>
            )}

            {/* Statistics Summary */}
            <div id="rep-dashboard" className="grid grid-cols-1 md:grid-cols-3 gap-4 scroll-mt-24">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-1">{t.dashboard.activeOrders}</p>
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{activeOrdersCount}</h3>
                    </div>
                    <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                        <Package size={24} />
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-1">{t.dashboard.todayOrders}</p>
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{ordersTodayCount}</h3>
                    </div>
                    <div className="p-3 rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                        <PlusCircle size={24} />
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-1">{t.dashboard.readyForDelivery}</p>
                            <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{readyOrdersCount}</h3>
                        </div>
                        <div className="p-3 rounded-full bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400">
                            <CheckCircle size={24} />
                        </div>
                    </div>
                    {readyOrdersCount > 0 && user?.role !== 'lab' && !isDesignerUser(user) && (
                        <button
                            onClick={() => setShowDailySummary(true)}
                            className="w-full mt-2 flex items-center justify-center gap-2 text-sm text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300 py-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                        >
                            <Printer size={14} />
                            طباعة كشف
                        </button>
                    )}
                </div>
            </div>

            {canViewDeliveryFollowUp && (overdueOrders.length > 0 || dueTodayOrders.length > 0 || dueTomorrowOrders.length > 0 || dueLaterOrders.length > 0) && (
                <div>
                    <h3 className="text-sm font-bold text-gray-500 mb-3 flex items-center gap-2">
                        <Clock size={16} />
                        {t.dashboard.deliveryFollowUp}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        {overdueOrders.length > 0 && (
                            <AlertCard
                                title={t.dashboard.overdueOrders}
                                count={overdueOrders.length}
                                icon={AlertTriangle}
                                colorClass="red"
                                useModal
                                onExpand={() => setActiveModal('delivery-overdue')}
                            />
                        )}
                        {dueTodayOrders.length > 0 && (
                            <AlertCard
                                title={t.dashboard.dueToday}
                                count={dueTodayOrders.length}
                                icon={Clock}
                                colorClass="yellow"
                                useModal
                                onExpand={() => setActiveModal('delivery-today')}
                            />
                        )}
                        {dueTomorrowOrders.length > 0 && (
                            <AlertCard
                                title={t.dashboard.dueTomorrow}
                                count={dueTomorrowOrders.length}
                                icon={CheckCircle}
                                colorClass="blue"
                                useModal
                                onExpand={() => setActiveModal('delivery-tomorrow')}
                            />
                        )}
                        {dueLaterOrders.length > 0 && (
                            <AlertCard
                                title={t.dashboard.dueLater}
                                count={dueLaterOrders.length}
                                icon={Package}
                                colorClass="green"
                                useModal
                                onExpand={() => setActiveModal('delivery-later')}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* ALERT SECTIONS */}
            <div className="space-y-6">

                {/* 1. URGENT / ATTENTION (Red/Orange) */}
                {(rejectedOrders.length > 0 || returnedOrders.length > 0 || needsAttentionOrders.length > 0 || doctorRequests.length > 0) && (
                    <div>
                        <h3 className="text-sm font-bold text-gray-500 mb-3 flex items-center gap-2">
                            <AlertTriangle size={16} />
                            {t.dashboard.importantAlerts}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {doctorRequests.length > 0 && (
                                <AlertCard
                                    title="طلبات دكاترة جديدة"
                                    count={doctorRequests.length}
                                    icon={UserPlus}
                                    colorClass="emerald"
                                    useModal
                                    onExpand={() => setActiveModal('doctor-requests')}
                                />
                            )}
                            {rejectedOrders.length > 0 && (
                                <AlertCard
                                    title="مرفوض (طبيب)"
                                    count={rejectedOrders.filter(o => o.status === 'Rejected').length}
                                    icon={AlertTriangle}
                                    colorClass="red"
                                    useModal
                                    onExpand={() => setActiveModal('rejected-doctor')}
                                />
                            )}
                            {/* Returned orders — active, need rework */}
                            {returnedOrders.length > 0 && (
                                <AlertCard
                                    title="مرتجع للتعديل"
                                    count={returnedOrders.length}
                                    icon={Clock}
                                    colorClass="yellow"
                                    useModal
                                    onExpand={() => setActiveModal('returned')}
                                />
                            )}
                            {labRejections.length > 0 && (
                                <AlertCard
                                    title="مرفوض (معمل)"
                                    count={labRejections.length}
                                    icon={AlertTriangle}
                                    colorClass="red"
                                    useModal
                                    onExpand={() => setActiveModal('rejected-lab')}
                                />
                            )}
                            {needsAttentionOrders.length > 0 && (
                                <AlertCard
                                    title={t.dashboard.needsAttention}
                                    count={needsAttentionOrders.length}
                                    icon={AlertTriangle}
                                    colorClass="yellow"
                                    useModal
                                    onExpand={() => setActiveModal('needs-attention')}
                                />
                            )}
                        </div>
                    </div>
                )}

                {/* 2. WORKFLOW / TRACKING (Blue/teal) */}
                {(unassignedLabOrders.length > 0 || pendingApprovalOrders.length > 0 || designPhaseOrders.length > 0 || tryInOrders.length > 0) && (
                    <div>
                        <h3 className="text-sm font-bold text-gray-500 mb-3 flex items-center gap-2">
                            <Clock size={16} />
                            {t.dashboard.workflowTracking}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {unassignedLabOrders.length > 0 && (
                                <AlertCard
                                    title={t.dashboard.unassignedLab}
                                    count={unassignedLabOrders.length}
                                    icon={HelpCircle}
                                    colorClass="yellow"
                                    useModal
                                    onExpand={() => setActiveModal('unassigned-lab')}
                                />
                            )}
                            {pendingApprovalOrders.length > 0 && (
                                <AlertCard
                                    title={t.dashboard.pendingApproval}
                                    count={pendingApprovalOrders.length}
                                    icon={UserCheck}
                                    colorClass="emerald"
                                    useModal
                                    onExpand={() => setActiveModal('pending')}
                                />
                            )}
                            {designPhaseOrders.length > 0 && (
                                <AlertCard
                                    title={t.dashboard.designPhase}
                                    count={designPhaseOrders.length}
                                    icon={Package}
                                    colorClass="blue"
                                    useModal
                                    onExpand={() => setActiveModal('design')}
                                />
                            )}
                            {tryInOrders.length > 0 && (
                                <AlertCard
                                    title={t.dashboard.tryInWaiting}
                                    count={tryInOrders.length}
                                    icon={Clock}
                                    colorClass="yellow"
                                    useModal
                                    onExpand={() => setActiveModal('tryin')}
                                />
                            )}
                        </div>
                    </div>
                )}

                {/* 3. COMMENTS ALERT (Blue) */}
                {canViewCommentAlerts && (unresolvedCommentItems.length > 0 || representativeDeliveryDateChanges.length > 0) && (
                    <div>
                        <h3 className="text-sm font-bold text-gray-500 mb-3 flex items-center gap-2">
                            <MessageSquare size={16} />
                            تعليقات تحتاج ردود
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <AlertCard
                                title="تعليقات على الحالات"
                                count={unresolvedCommentItems.length}
                                icon={MessageSquare}
                                colorClass="blue"
                                expandable
                            >
                                <div className="divide-y divide-blue-100 dark:divide-blue-800 -mx-4 max-h-72 overflow-y-auto">
                                    {unresolvedCommentItems.map(({ comment, order }) => (
                                        <div
                                            key={comment.id}
                                            className="flex items-start gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                                    <span className="font-mono text-[10px] text-blue-500 font-bold">#{order.caseId}</span>
                                                    <span className="text-xs font-bold text-gray-800 dark:text-white truncate">{order.patientName}</span>
                                                    <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">— {comment.userName}</span>
                                                </div>
                                                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{comment.text}</p>
                                                <span className="text-[10px] text-gray-400 mt-0.5 block">
                                                    {new Date(comment.createdAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); resolveComment(comment.id); }}
                                                title="تم الرد ✓"
                                                className="shrink-0 mt-1 p-1 rounded-md text-blue-300 hover:text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors"
                                            >
                                                <CheckSquare className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </AlertCard>
                            {user?.role === 'admin' && representativeDeliveryDateChanges.length > 0 && (
                                <AlertCard
                                    title="تعديلات تواريخ التسليم"
                                    count={representativeDeliveryDateChanges.length}
                                    icon={Clock}
                                    colorClass="yellow"
                                    useModal
                                    onExpand={() => setActiveModal('delivery-change-review')}
                                />
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* Contact Inquiries from Marketing Page */}
            {contactInquiries.length > 0 && (user?.role === 'admin' || user?.role === 'representative') && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-teal-200 dark:border-teal-800 overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-teal-100 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 flex justify-between items-center">
                        <h3 className="font-bold text-teal-900 dark:text-teal-100 flex items-center gap-2 text-sm">
                            <MessageSquare size={18} className="text-teal-600" />
                            رسائل جديدة من صفحة التسويق
                        </h3>
                        <span className="bg-teal-600 text-white px-2.5 py-1 rounded-full text-xs font-bold">{contactInquiries.length}</span>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {contactInquiries.slice(0, 5).map((inq) => (
                            <div key={inq.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-bold text-sm text-gray-800 dark:text-white">{inq.doctor_name}</span>
                                            {inq.clinic_name && <span className="text-xs text-gray-400">— {inq.clinic_name}</span>}
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{inq.message || 'No message'}</p>
                                        <div className="flex items-center gap-3">
                                            <a href={`https://wa.me/${inq.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 font-medium hover:underline">
                                                <PhoneCall size={12} />
                                                {inq.phone}
                                            </a>
                                            <span className="text-[10px] text-gray-400">{new Date(inq.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            if (!user?.name) return;
                                            await contactService.markAsContacted(inq.id, user.name);
                                            setContactInquiries(prev => prev.filter(i => i.id !== inq.id));
                                        }}
                                        className="shrink-0 px-3 py-1.5 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 rounded-lg text-xs font-bold hover:bg-teal-200 dark:hover:bg-teal-800 cursor-pointer transition-colors"
                                    >
                                        تم التواصل ✓
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Lab Specific */}
            {user?.role === 'lab' && (
                <AlertCard
                    title="أوردرات قيد الإنتاج"
                    count={orders.filter(o => o.status === 'Under Production').length}
                    icon={Package}
                    colorClass="blue"
                    useModal
                    onExpand={() => setActiveModal('lab-production')}
                />
            )}


            {/* Designer Workload Cards - mirrors lab workload for active design assignments */}
            {
                users.filter(u => isDesignerUser(u)).length > 0 && (() => {
                    const designers = users.filter(u => isDesignerUser(u));
                    const hasActiveDesigner = designers.some(designer => {
                        const designerOrders = orders.filter(o => o.designerId === designer.id && o.status !== 'Delivered');

                        if (user?.role === 'designer' && user.id !== designer.id) {
                            return false;
                        }

                        return designerOrders.length > 0;
                    });

                    if (!hasActiveDesigner) return null;

                    return (
                        <div className="space-y-4">
                            <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                <UserCheck className="text-amber-600" size={20} />
                                حمل المصممين
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {designers.map(designer => {
                                    const designerOrders = orders.filter(o => o.designerId === designer.id && o.status !== 'Delivered');

                                    if (user?.role === 'designer' && user.id !== designer.id) {
                                        return null;
                                    }

                                    if (designerOrders.length === 0) return null;

                                    return (
                                        <div key={designer.id} className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-200">
                                            <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100 dark:border-gray-700">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400 font-bold text-sm">
                                                        {designer.name.charAt(0)}
                                                    </div>
                                                    <h3 className="font-bold text-gray-800 dark:text-white">{designer.name}</h3>
                                                </div>
                                                <span className="bg-amber-600 text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm shadow-amber-200 dark:shadow-none">
                                                    {designerOrders.length}
                                                </span>
                                            </div>
                                            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                                                {designerOrders.map(order => (
                                                    <button
                                                        key={order.id}
                                                        type="button"
                                                        onClick={() => goToOrder(order)}
                                                        className="flex w-full items-center justify-between text-sm gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors cursor-pointer text-right"
                                                        title="فتح الأوردر"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="font-mono text-xs text-gray-400">#{order.caseId}</span>
                                                            <span className="text-gray-700 dark:text-gray-300 truncate font-medium">{order.patientName}</span>
                                                        </div>
                                                        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${getDesignerStatusClass(order)}`}>
                                                            {getDesignerStatusLabel(order)}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()
            }

            {/* Lab Workload Cards - Visible to All (with role-based filtering) */}
            {
                suppliers.length > 0 && (() => {
                    const hasActive = suppliers.some(supplier => {
                        let labOrders = orders.filter(o => o.supplierId === supplier.id && o.status !== 'Delivered');
                        if (user?.role === 'lab' && user.entityId !== supplier.id) return false;
                        if (user?.role === 'designer') labOrders = labOrders.filter(o => o.designerId === user.id);
                        return labOrders.length > 0;
                    });

                    if (!hasActive) return null;

                    return (
                        <div className="space-y-4">
                            <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                <Building2 className="text-blue-600" size={20} />
                                {t.dashboard.labWorkload}
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {suppliers.map(supplier => {
                                    // Filter orders based on user role
                                    let labOrders = orders.filter(o => o.supplierId === supplier.id && o.status !== 'Delivered');

                                    // For lab users, only show their own lab's orders
                                    if (user?.role === 'lab' && user.entityId !== supplier.id) {
                                        return null;
                                    }

                                    // For designers, only show orders they're assigned to
                                    if (user?.role === 'designer') {
                                        labOrders = labOrders.filter(o => o.designerId === user.id);
                                    }

                                    if (labOrders.length === 0) return null;

                                    return (
                                        <div key={supplier.id} className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-200">
                                            <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100 dark:border-gray-700">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm">
                                                        {supplier.name.charAt(0)}
                                                    </div>
                                                    <h3 className="font-bold text-gray-800 dark:text-white">{supplier.name}</h3>
                                                </div>
                                                <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm shadow-blue-200 dark:shadow-none">
                                                    {labOrders.length}
                                                </span>
                                            </div>
                                            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                                                {labOrders.map(order => (
                                                    <button
                                                        key={order.id}
                                                        type="button"
                                                        onClick={() => goToOrder(order)}
                                                        className="flex w-full items-center justify-between text-sm gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors cursor-pointer text-right"
                                                        title="فتح الأوردر"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="font-mono text-xs text-gray-400">#{order.caseId}</span>
                                                            <span className="text-gray-700 dark:text-gray-300 truncate font-medium">{order.patientName}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            {order.workflowType === 'split' && order.designerId && (
                                                                <span className="w-2 h-2 rounded-full bg-teal-500" title="Milling"></span>
                                                            )}
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${order.status === 'Ready'
                                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                                : order.status === 'Rejected'
                                                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                                                                }`}>
                                                                {order.status === 'Rejected' ? 'رفض دكتور' : order.status}
                                                            </span>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()
            }

            {user?.role === 'admin' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-white">إحصائيات المصممين</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">متابعة زمن تنفيذ التصميم وروابط المراجعة الأخيرة</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl shadow-sm border border-amber-200 dark:border-amber-800">
                            <p className="text-sm font-bold text-amber-700 dark:text-amber-300 mb-1">لسه تحت التصميم</p>
                            <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{pendingDesignerTimelineRows.length}</p>
                            <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">{pendingDesignerUnitsCount} يونت تحت التصميم</p>
                        </div>
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl shadow-sm border border-emerald-200 dark:border-emerald-800">
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 mb-1">اترفع لها تصميم</p>
                            <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{submittedDesignerTimelineRows.length}</p>
                            <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">{submittedDesignerUnitsCount} يونت تم رفعها</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">مرفوع آخر 7 أيام</p>
                            <p className="text-2xl font-bold text-gray-800 dark:text-white">{weeklyDesignerCount}</p>
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">اليوم: {dailyDesignerCount}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">متوسط زمن التصميم</p>
                            <p className="text-2xl font-bold text-gray-800 dark:text-white">{averageDesignerDuration !== null ? formatDesignerDuration(averageDesignerDuration) : '-'}</p>
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">آخر 30 يوم: {monthlyDesignerCount}</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-bold text-gray-800 dark:text-white">
                                        {designerTimelineView === 'pending' ? 'حالات لسه تحت التصميم' : 'حالات اترفعلها تصميم'}
                                    </p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500">
                                        {designerTimelineView === 'pending'
                                            ? 'الجدول يعرض الحالات التي لم يتم رفع رابط التصميم لها بعد'
                                            : 'الجدول يعرض الحالات التي لديها رابط تصميم جاهز للمراجعة'}
                                    </p>
                                </div>
                                <div className="flex gap-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
                                    <button
                                        type="button"
                                        onClick={() => setDesignerTimelineView('pending')}
                                        className={`rounded-md px-3 py-2 text-xs font-bold transition ${designerTimelineView === 'pending'
                                            ? 'bg-amber-600 text-white shadow-sm'
                                            : 'text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/30'
                                            }`}
                                    >
                                        تحت التصميم ({pendingDesignerTimelineRows.length} حالة / {pendingDesignerUnitsCount} يونت)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDesignerTimelineView('submitted')}
                                        className={`rounded-md px-3 py-2 text-xs font-bold transition ${designerTimelineView === 'submitted'
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
                                            }`}
                                    >
                                        تم رفع التصميم ({submittedDesignerTimelineRows.length} حالة / {submittedDesignerUnitsCount} يونت)
                                    </button>
                                </div>
                            </div>
                        </div>

                        {designerTimelineGroups.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-400 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
                                {designerTimelineView === 'pending'
                                    ? 'لا توجد حالات تحت التصميم حالياً'
                                    : 'لا توجد حالات تم رفع تصميمها حالياً'}
                            </div>
                        ) : designerTimelineGroups.map(group => (
                            <div key={group.designerId} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-gray-800 dark:text-white">{group.designerName}</h3>
                                        <p className="text-xs text-gray-400 dark:text-gray-500">
                                            {group.rows.length} حالة / {getRowsUnitsCount(group.rows)} يونت {designerTimelineView === 'pending' ? 'تحت التصميم' : 'تم رفع تصميمها'}
                                        </p>
                                    </div>
                                </div>
                                <div className="max-h-[420px] overflow-auto">
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
                                            {group.rows.map(({ order, submittedAt, durationMs, isFinished }) => (
                                                <tr key={order.id} className={`border-t align-top ${isFinished ? 'border-emerald-100 bg-emerald-50/35 dark:border-emerald-900/40 dark:bg-emerald-900/10' : 'border-amber-100 bg-amber-50/35 dark:border-amber-900/40 dark:bg-amber-900/10'}`}>
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
                                                        <span className={`inline-flex min-w-[96px] justify-center rounded-full px-2 py-1 text-[11px] font-bold ${isFinished ? 'bg-emerald-600 text-white dark:bg-emerald-500' : 'bg-amber-500 text-white dark:bg-amber-500'}`}>
                                                            {isFinished ? 'تم رفع التصميم' : 'تحت التصميم'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{submittedAt ? format(new Date(submittedAt), 'dd/MM/yyyy HH:mm') : '-'}</td>
                                                    <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{durationMs !== null ? formatDesignerDuration(durationMs) : '-'}</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex min-w-[130px] flex-col gap-1.5">
                                                            {order.designUrl ? (
                                                                <a href={order.designUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-xs font-bold">
                                                                    مراجعة التصميم
                                                                </a>
                                                            ) : (
                                                                <span className="text-xs text-gray-300">-</span>
                                                            )}
                                                            {isFinished && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => requestDesignRevision(order)}
                                                                    className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 transition hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
                                                                >
                                                                    طلب تعديل تصميم
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty State - Pro UI */}
            {
                orders.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 px-4 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                        <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
                            <Package className="w-10 h-10 text-blue-500 dark:text-blue-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                            لا توجد طلبات نشطة حالياً
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm mb-8 leading-relaxed">
                            يبدو أن كل شيء هادئ الآن. يمكنك البدء بإضافة طلب جديد أو تسجيل دكتور.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowOrderForm(true)}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-blue-200 dark:shadow-none transition-all hover:-translate-y-0.5"
                            >
                                <PlusCircle size={20} />
                                <span>إضافة طلب جديد</span>
                            </button>
                        </div>
                    </div>
                )
            }

            {/* Order List Modals */}
            <OrderListModal
                title="حالات منتظرة موافقة المعمل/المصمم"
                isOpen={activeModal === 'pending'}
                onClose={() => setActiveModal(null)}
            >
                {pendingApprovalOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="حالات بدون معمل"
                isOpen={activeModal === 'unassigned-lab'}
                onClose={() => setActiveModal(null)}
            >
                {unassignedLabOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="حالات متأخرة"
                isOpen={canViewDeliveryFollowUp && (activeModal === 'overdue' || activeModal === 'delivery-overdue')}
                onClose={() => setActiveModal(null)}
                showDoctor
                showDeliveryDate
            >
                {overdueOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        doctorName={getDoctorDisplayName(order.doctorId)}
                        showDoctor
                        deliveryDateLabel={getDeliveryDateStatusLabel(order.deliveryDate)}
                        showDeliveryDate
                        onEditDeliveryDate={canEditDeliveryDates ? openDeliveryDateEditor : undefined}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="حالات مطلوبة اليوم"
                isOpen={canViewDeliveryFollowUp && activeModal === 'delivery-today'}
                onClose={() => setActiveModal(null)}
                showDoctor
                showDeliveryDate
            >
                {dueTodayOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        doctorName={getDoctorDisplayName(order.doctorId)}
                        showDoctor
                        deliveryDateLabel={getDeliveryDateStatusLabel(order.deliveryDate)}
                        showDeliveryDate
                        onEditDeliveryDate={canEditDeliveryDates ? openDeliveryDateEditor : undefined}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="حالات مطلوبة غدا"
                isOpen={canViewDeliveryFollowUp && activeModal === 'delivery-tomorrow'}
                onClose={() => setActiveModal(null)}
                showDoctor
                showDeliveryDate
            >
                {dueTomorrowOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        doctorName={getDoctorDisplayName(order.doctorId)}
                        showDoctor
                        deliveryDateLabel={getDeliveryDateStatusLabel(order.deliveryDate)}
                        showDeliveryDate
                        onEditDeliveryDate={canEditDeliveryDates ? openDeliveryDateEditor : undefined}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="حالات مطلوبة لاحقاً"
                isOpen={canViewDeliveryFollowUp && activeModal === 'delivery-later'}
                onClose={() => setActiveModal(null)}
                showDoctor
                showDeliveryDate
            >
                {dueLaterOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        doctorName={getDoctorDisplayName(order.doctorId)}
                        showDoctor
                        deliveryDateLabel={getDeliveryDateStatusLabel(order.deliveryDate)}
                        showDeliveryDate
                        onEditDeliveryDate={canEditDeliveryDates ? openDeliveryDateEditor : undefined}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="تعديلات تواريخ التسليم من المندوبين"
                isOpen={user?.role === 'admin' && activeModal === 'delivery-change-review'}
                onClose={() => setActiveModal(null)}
                showDoctor
                showDeliveryDate
                hideCaseId
            >
                {representativeDeliveryDateChanges.map(change => (
                    <OrderListItem
                        key={change.reviewKey}
                        order={change.order}
                        doctorName={getDoctorDisplayName(change.order.doctorId)}
                        showDoctor
                        deliveryDateValue={
                            <div className="space-y-1">
                                <div className="text-sm font-bold text-surface-900 dark:text-surface-100">
                                    {change.newDate}
                                </div>
                                <div className="text-[11px] text-surface-500 dark:text-surface-400">
                                    بدلاً من {change.oldDate}
                                </div>
                            </div>
                        }
                        deliveryDateLabel={getDeliveryDateChangeReviewLabel(change)}
                        showDeliveryDate
                        hideCaseId
                        onEditDeliveryDate={openDeliveryDateEditor}
                        onMarkReviewed={() => markDeliveryChangeReviewed(change.reviewKey)}
                        labName={getLabName(change.order.supplierId)}
                        designerName={getDesignerName(change.order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="حالات مرفوضة من الطبيب"
                isOpen={activeModal === 'rejected-doctor'}
                onClose={() => setActiveModal(null)}
            >
                {rejectedOrders.filter(o => o.status === 'Rejected').map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                        onArchive={user?.role === 'admin' ? handleArchiveOrder : undefined}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="حالات مرفوضة من المعمل"
                isOpen={activeModal === 'rejected-lab'}
                onClose={() => setActiveModal(null)}
            >
                {labRejections.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                        onArchive={user?.role === 'admin' ? handleArchiveOrder : undefined}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="حالات مرتجعة للتعديل"
                isOpen={activeModal === 'returned'}
                onClose={() => setActiveModal(null)}
            >
                {returnedOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    // No onArchive — returned cases must be reworked and delivered, not archived
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="مطلوب انتباه (PMMA/تفاصيل)"
                isOpen={activeModal === 'needs-attention'}
                onClose={() => setActiveModal(null)}
            >
                {needsAttentionOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="في مرحلة التصميم/الموافقة"
                isOpen={activeModal === 'design'}
                onClose={() => setActiveModal(null)}
            >
                {designPhaseOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="Try-In منتظر رد الطبيب"
                isOpen={activeModal === 'tryin'}
                onClose={() => setActiveModal(null)}
            >
                {tryInOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            {/* Designer Modals */}
            <OrderListModal
                title="تصميمات منتظرة"
                isOpen={activeModal === 'designer-pending'}
                onClose={() => setActiveModal(null)}
            >
                {orders.filter(o => o.status === 'Under Design').map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            <OrderListModal
                title="منتظر موافقة الطبيب"
                isOpen={activeModal === 'designer-approval'}
                onClose={() => setActiveModal(null)}
            >
                {orders.filter(o => o.status === 'Waiting Dr Approval').map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            {/* Lab Modal */}
            <OrderListModal
                title="أوردرات قيد الإنتاج"
                isOpen={activeModal === 'lab-production'}
                onClose={() => setActiveModal(null)}
            >
                {orders.filter(o => o.status === 'Under Production').map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                    />
                ))}
            </OrderListModal>

            {/* Order Form Modal */}
            {
                showOrderForm && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b dark:border-gray-700 p-4 flex justify-between items-center">
                                <h2 className="text-xl font-bold">أوردر جديد</h2>
                                <button
                                    onClick={() => setShowOrderForm(false)}
                                    className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="p-6">
                                <OrderForm
                                    onCancel={() => setShowOrderForm(false)}
                                    onSubmit={async (order) => {
                                        await db.addOrder(order, {
                                            userId: user?.id,
                                            actorRole: user?.role,
                                        });
                                        setShowOrderForm(false);
                                        window.location.reload();
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Doctor Form Modal */}
            {
                showDoctorForm && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b dark:border-gray-700 p-4 flex justify-between items-center">
                                <h2 className="text-xl font-bold">طبيب جديد</h2>
                                <button
                                    onClick={() => setShowDoctorForm(false)}
                                    className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="p-6">
                                <DoctorForm onSuccess={() => {
                                    setShowDoctorForm(false);
                                    window.location.reload();
                                }} />
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Daily Summary Print Modal */}
            {showDailySummary && (
                <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto print:p-0 print:bg-white p-4">
                    <DailySummaryPrint
                        orders={orders.filter(o => o.status === 'Ready')}
                        doctors={doctorsMap}
                        suppliers={suppliersMap}
                        onClose={() => setShowDailySummary(false)}
                    />
                </div>
            )}

            {/* Doctor Requests Modal */}
            <OrderListModal
                title="طلبات دكاترة جديدة"
                isOpen={activeModal === 'doctor-requests'}
                onClose={() => setActiveModal(null)}
            >
                {doctorRequests.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                        onAccept={(o) => {
                            setActiveModal(null); // Close list modal
                            setAcceptingOrder(o); // Open accept modal
                        }}
                    />
                ))}
            </OrderListModal>

            {/* Accept Order Workflow Modal */}
            {acceptingOrder && (
                <AcceptOrderModal
                    isOpen={!!acceptingOrder}
                    order={acceptingOrder}
                    doctors={doctors}
                    suppliers={suppliers}
                    designers={users.filter(u => isDesignerUser(u))}
                    existingOrders={orders}
                    onClose={() => setAcceptingOrder(null)}
                    onConfirm={handleAcceptOrder}
                />
            )}

            {editingDeliveryOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md shadow-xl border border-gray-100 dark:border-gray-700">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-lg font-bold text-gray-800 dark:text-white">تعديل تاريخ التسليم</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                #{editingDeliveryOrder.caseId} - {editingDeliveryOrder.patientName}
                            </p>
                        </div>
                        <div className="p-4 space-y-4">
                            <Input
                                type="date"
                                label="تاريخ التسليم الجديد"
                                value={editingDeliveryDate}
                                onChange={(e) => setEditingDeliveryDate(e.target.value)}
                            />
                            <div className="flex gap-2 justify-end">
                                <Button
                                    variant="ghost"
                                    type="button"
                                    onClick={() => {
                                        setEditingDeliveryOrder(null);
                                        setEditingDeliveryDate('');
                                    }}
                                >
                                    إلغاء
                                </Button>
                                <Button
                                    type="button"
                                    isLoading={isSavingDeliveryDate}
                                    onClick={handleUpdateDeliveryDate}
                                >
                                    حفظ التاريخ
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}

/* aria-label placeholder */
