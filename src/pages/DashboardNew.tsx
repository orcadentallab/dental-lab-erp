/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, type Order, type Supplier, type User, type Doctor } from '../services/db';
import { AlertTriangle, Clock, CheckCircle, UserCheck, Package, Building2, TrendingUp, PlusCircle, UserPlus, HelpCircle, Printer, MessageSquare, PhoneCall } from 'lucide-react';
import { contactService, type ContactInquiry } from '../services/contactService';
import AlertCard from '../components/dashboard/AlertCard';
import OrderForm from '../components/orders/OrderForm';
import DoctorForm from '../components/doctors/DoctorForm';
import OrderListModal from '../components/dashboard/OrderListModal';
import OrderListItem from '../components/dashboard/OrderListItem';
import DailySummaryPrint from '../components/dashboard/DailySummaryPrint';
import AcceptOrderModal from '../components/orders/AcceptOrderModal';
import { useTranslation } from '../translations';


export default function DashboardNew() {
    const { user } = useAuth();
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
    const [contactInquiries, setContactInquiries] = useState<ContactInquiry[]>([]);
    const { t } = useTranslation();

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const [ordersData, suppliersData, usersData, doctorsData, inquiriesData] = await Promise.all([
                    db.getDashboardActiveOrders(),
                    db.getSuppliers(),
                    db.getUsers(),
                    db.getDoctors(),
                    contactService.getInquiries('new').catch(() => [] as ContactInquiry[]),
                ]);

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

    const designPhaseOrders = orders.filter(o =>
        ['Under Design', 'Waiting Dr Approval'].includes(o.status)
    );

    const tryInOrders = orders.filter(o => o.status === 'Try In');

    const unregisteredOrders = orders.filter(o => !o.isRegistered && o.status === 'Delivered');

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

    // Quality Stats
    const labRejections = orders.filter(o => o.technicianStatus === 'Rejected');





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

    const handleRegister = async (orderId: string) => {
        try {
            await db.updateOrder(orderId, { isRegistered: true });
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, isRegistered: true } : o));
        } catch (error) {
            console.error('Error registering order:', error);
        }
    };

    const handleArchiveOrder = async (orderId: string) => {
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

    const showFinancial = user?.role === 'admin' || user?.role === 'accountant';


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

            {/* Statistics Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    {readyOrdersCount > 0 && user?.role !== 'lab' && user?.role !== 'designer' && (
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

            {/* ALERT SECTIONS */}
            <div className="space-y-6">

                {/* 1. URGENT / ATTENTION (Red/Orange) */}
                {(rejectedOrders.length > 0 || returnedOrders.length > 0 || overdueOrders.length > 0 || needsAttentionOrders.length > 0 || doctorRequests.length > 0) && (
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
                            {overdueOrders.length > 0 && (
                                <AlertCard
                                    title={t.dashboard.overdueOrders}
                                    count={overdueOrders.length}
                                    icon={AlertTriangle}
                                    colorClass="red"
                                    useModal
                                    onExpand={() => setActiveModal('overdue')}
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

                {/* 3. FINANCE / ADMIN (Green) */}
                {/* 3. FINANCE / ADMIN (Green) */}
                {showFinancial && unregisteredOrders.length > 0 && (
                    <div>
                        <h3 className="text-sm font-bold text-gray-500 mb-3 flex items-center gap-2">
                            <TrendingUp size={16} />
                            {t.dashboard.financialActions}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <AlertCard
                                title={t.dashboard.unregisteredOrders}
                                count={unregisteredOrders.length}
                                icon={TrendingUp}
                                colorClass="green"
                                useModal
                                onExpand={() => setActiveModal('unregistered')}
                            />
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
                                                    <div key={order.id} className="flex items-center justify-between text-sm gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors cursor-default">
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
                                                    </div>
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
                isOpen={activeModal === 'overdue'}
                onClose={() => setActiveModal(null)}
            >
                {overdueOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
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
                        onArchive={handleArchiveOrder}
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
                        onArchive={handleArchiveOrder}
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

            <OrderListModal
                title="أوردرات غير مسجلة"
                isOpen={activeModal === 'unregistered'}
                onClose={() => setActiveModal(null)}
            >
                {unregisteredOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
                        showRegister
                        onRegister={handleRegister}
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
                                        await db.addOrder(order);
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
                    designers={users.filter(u => u.role === 'designer')}
                    existingOrders={orders}
                    onClose={() => setAcceptingOrder(null)}
                    onConfirm={handleAcceptOrder}
                />
            )}
        </div >
    );
}

/* aria-label placeholder */
