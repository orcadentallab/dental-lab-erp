/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, type Order, type Supplier, type User } from '../services/db';
import { AlertTriangle, Clock, CheckCircle, UserCheck, Package, Building2, TrendingUp, PlusCircle, UserPlus } from 'lucide-react';
import AlertCard from '../components/dashboard/AlertCard';
import OrderForm from '../components/orders/OrderForm';
import DoctorForm from '../components/doctors/DoctorForm';
import OrderListModal from '../components/dashboard/OrderListModal';
import OrderListItem from '../components/dashboard/OrderListItem';

export default function DashboardNew() {
    const { user } = useAuth();
    const [isLoading, setIsLoading] = useState(true);
    const [orders, setOrders] = useState<Order[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [users, setUsers] = useState<User[]>([]);

    // Modal states
    const [showOrderForm, setShowOrderForm] = useState(false);
    const [showDoctorForm, setShowDoctorForm] = useState(false);
    const [activeModal, setActiveModal] = useState<string | null>(null);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const [ordersData, suppliersData, usersData] = await Promise.all([
                    db.getOrders(),
                    db.getSuppliers(),
                    db.getUsers()
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
        if (o.status !== 'New Case') return false;
        if (o.workflowType === 'split' && o.designerId) return true;
        if (o.supplierId) return true;
        return false;
    });

    const rejectedOrders = orders.filter(o =>
        o.status === 'Rejected' || o.status === 'Returned for Adjustments'
    );

    const overdueOrders = orders.filter(o =>
        o.deliveryDate < today && o.status !== 'Delivered'
    );

    const designPhaseOrders = orders.filter(o =>
        ['Under Design', 'Waiting Dr Approval'].includes(o.status)
    );

    const tryInOrders = orders.filter(o => o.status === 'Try In');

    const unregisteredOrders = orders.filter(o => !o.isRegistered && o.status === 'Delivered');

    // Orders needing attention (PMMA or NeedDetails requested by lab/designer)
    const needsAttentionOrders = orders.filter(o =>
        o.technicianStatus === 'PMMA_First' || o.technicianStatus === 'NeedDetails'
    );

    // --- Statistics Data ---
    const activeOrdersCount = orders.filter(o => !['Delivered', 'Cancelled', 'Rejected', 'Returned for Adjustments'].includes(o.status)).length;
    const ordersTodayCount = orders.filter(o => o.createdAt.startsWith(today)).length;
    const readyOrdersCount = orders.filter(o => o.status === 'Ready').length;



    // Helper functions
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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">جاري تحميل البيانات...</p>
                </div>
            </div>
        );
    }

    const showFinancial = user?.role === 'admin' || user?.role === 'accountant';
    const showAllAlerts = user?.role === 'admin' || user?.role === 'representative';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-white">لوحة التحكم</h1>
                    <p className="text-gray-500 dark:text-gray-400">أهلاً بك، {user?.name} 👋</p>
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
                                <span>أوردر جديد</span>
                            </button>
                            <button
                                onClick={() => setShowDoctorForm(true)}
                                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                <UserPlus size={18} />
                                <span>طبيب جديد</span>
                            </button>
                        </>
                    )}
                    {(user?.role === 'admin' || user?.role === 'accountant') && (
                        <>
                            <button
                                onClick={() => window.location.href = '/accounts'}
                                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                <TrendingUp size={18} />
                                <span>كشف حساب</span>
                            </button>
                            <button
                                onClick={() => window.location.href = '/finance'}
                                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                <Package size={18} />
                                <span>تسجيل مصروف</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Statistics Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-1">نشط حالياً</p>
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{activeOrdersCount}</h3>
                    </div>
                    <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                        <Package size={24} />
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-1">أوردرات اليوم</p>
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{ordersTodayCount}</h3>
                    </div>
                    <div className="p-3 rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                        <PlusCircle size={24} />
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-1">جاهز للتسليم</p>
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{readyOrdersCount}</h3>
                    </div>
                    <div className="p-3 rounded-full bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400">
                        <CheckCircle size={24} />
                    </div>
                </div>
            </div>

            {/* ALERT SECTIONS */}
            <div className="space-y-6">

                {/* 1. URGENT / ATTENTION (Red/Orange) */}
                {(rejectedOrders.length > 0 || overdueOrders.length > 0 || needsAttentionOrders.length > 0) && (
                    <div>
                        <h3 className="text-sm font-bold text-gray-500 mb-3 flex items-center gap-2">
                            <AlertTriangle size={16} />
                            تنبيهات هامة
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {rejectedOrders.length > 0 && (
                                <AlertCard
                                    title="حالات مرفوضة/مرتجعة"
                                    count={rejectedOrders.length}
                                    icon={AlertTriangle}
                                    colorClass="red"
                                    useModal
                                    onExpand={() => setActiveModal('rejected')}
                                />
                            )}
                            {overdueOrders.length > 0 && (
                                <AlertCard
                                    title="حالات متأخرة"
                                    count={overdueOrders.length}
                                    icon={AlertTriangle}
                                    colorClass="red"
                                    useModal
                                    onExpand={() => setActiveModal('overdue')}
                                />
                            )}
                            {needsAttentionOrders.length > 0 && (
                                <AlertCard
                                    title="مطلوب انتباه (PMMA/تفاصيل)"
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

                {/* 2. WORKFLOW / TRACKING (Blue/Purple) */}
                {(pendingApprovalOrders.length > 0 || designPhaseOrders.length > 0 || tryInOrders.length > 0) && (
                    <div>
                        <h3 className="text-sm font-bold text-gray-500 mb-3 flex items-center gap-2">
                            <Clock size={16} />
                            متابعة سير العمل
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {pendingApprovalOrders.length > 0 && (
                                <AlertCard
                                    title="حالات منتظرة موافقة المعمل/المصمم"
                                    count={pendingApprovalOrders.length}
                                    icon={UserCheck}
                                    colorClass="purple"
                                    useModal
                                    onExpand={() => setActiveModal('pending')}
                                />
                            )}
                            {designPhaseOrders.length > 0 && (
                                <AlertCard
                                    title="في مرحلة التصميم/الموافقة"
                                    count={designPhaseOrders.length}
                                    icon={Package}
                                    colorClass="blue"
                                    useModal
                                    onExpand={() => setActiveModal('design')}
                                />
                            )}
                            {tryInOrders.length > 0 && (
                                <AlertCard
                                    title="Try-In منتظر رد الطبيب"
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
                            إجراءات مالية وإدارية
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <AlertCard
                                title="أوردرات غير مسجلة"
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
                suppliers.length > 0 && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-bold text-gray-800 dark:text-white">حمل المعامل</h2>
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
                                    <div key={supplier.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
                                        <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center gap-2">
                                                <Building2 className="text-blue-600 dark:text-blue-400 w-5 h-5" />
                                                <h3 className="font-bold text-gray-800 dark:text-white">{supplier.name}</h3>
                                            </div>
                                            <span className="bg-blue-600 text-white px-2.5 py-1 rounded-full text-xs font-bold">
                                                {labOrders.length}
                                            </span>
                                        </div>
                                        <div className="space-y-2">
                                            {labOrders.map(order => (
                                                <div key={order.id} className="flex items-center justify-between text-sm gap-2">
                                                    <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">#{order.caseId}</span>
                                                    <span className="text-gray-600 dark:text-gray-400 truncate flex-1">{order.patientName}</span>
                                                    <div className="flex items-center gap-1">
                                                        {order.workflowType === 'split' && order.designerId && (
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-bold whitespace-nowrap">
                                                                Milling
                                                            </span>
                                                        )}
                                                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                                            {order.status}
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
                )
            }

            {/* Empty State */}
            {
                orders.length === 0 && (
                    <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-xl">
                        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-gray-700 dark:text-gray-300 mb-2">
                            كل شيء يسير بشكل رائع!
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400">
                            لا توجد أوردرات تحتاج إلى اهتمام
                        </p>
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
                title="حالات مرفوضة/مرتجعة"
                isOpen={activeModal === 'rejected'}
                onClose={() => setActiveModal(null)}
            >
                {rejectedOrders.map(order => (
                    <OrderListItem
                        key={order.id}
                        order={order}
                        labName={getLabName(order.supplierId)}
                        designerName={getDesignerName(order.designerId)}
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
        </div >
    );
}
