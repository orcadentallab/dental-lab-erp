import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import OrderList from '../components/orders/OrderList';
import OrderForm from '../components/orders/OrderForm';
import { db } from '../services/db';
import type { Order, Doctor, Supplier, User } from '../services/db';
import { Plus, X, Search, Send, MessageCircle, FileSpreadsheet, Printer } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { exportToExcelWithHeaders, printTable } from '../lib/exportUtils';
import { useTranslation } from '../translations';

export default function Orders() {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Highlighted order from dashboard navigation
    const highlightedOrderId = searchParams.get('highlight');

    // Clear highlight after 5 seconds
    useEffect(() => {
        if (highlightedOrderId) {
            const timer = setTimeout(() => {
                setSearchParams({}, { replace: true });
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [highlightedOrderId, setSearchParams]);

    const isDesigner = user?.role === 'designer';
    const isAccountant = user?.role === 'accountant';
    const { t } = useTranslation();

    // Data State
    // Data State
    const [orders, setOrders] = useState<Order[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [users, setUsers] = useState<User[]>([]); // For Designer Filter

    // Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [doctorFilter, setDoctorFilter] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');
    const [designerFilter, setDesignerFilter] = useState('');
    const [representativeFilter, setRepresentativeFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Toggle Options
    const [hideDelivered, setHideDelivered] = useState(false);
    const [hideRejected, setHideRejected] = useState(false);

    // Edit State (Admin - Full Edit)
    const [fullEditingOrder, setFullEditingOrder] = useState<Order | null>(null);

    // Note State (Chat Log)
    const [noteEditingOrder, setNoteEditingOrder] = useState<Order | null>(null);
    const [newComment, setNewComment] = useState('');

    // Design Link Modal State
    const [designLinkOrder, setDesignLinkOrder] = useState<Order | null>(null);
    const [designLinkUrl, setDesignLinkUrl] = useState('');

    const refreshOrders = async () => {
        setIsLoading(true);
        try {
            const [ordersData, doctorsData, suppliersData, usersData] = await Promise.all([
                db.getOrders(),
                db.getDoctors(),
                db.getSuppliers(),
                db.getUsers()
            ]);
            setOrders(ordersData);
            setDoctors(doctorsData);
            setSuppliers(suppliersData);
            setUsers(usersData);
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshOrders();
    }, []);

    // Filter Logic
    const rbacFilteredOrders = orders.filter(order => {
        if (user?.role === 'lab') {
            // Prevent Lab from seeing Split orders until 'Under Production' ONLY IF a designer is assigned
            // If it's a split order but NO designer is assigned (yet), they should see it to potentially flag it or just be aware.
            const isSplitWithDesigner = order.workflowType === 'split' && order.designerId;
            if (isSplitWithDesigner && !['Under Production', 'Try In', 'Try In Approved', 'Ready', 'Ready for Delivery', 'Delivered', 'Returned for Adjustments'].includes(order.status)) {
                return false;
            }
            return user.entityId && order.supplierId === user.entityId;
        }

        if (isDesigner) {
            return order.workflowType === 'split' && order.designerId === user.id;
        }

        return true;
    });

    const filteredOrders = rbacFilteredOrders.filter(order => {
        const matchesSearch =
            (order.caseId && order.caseId.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (order.patientName && order.patientName.toLowerCase().includes(searchQuery.toLowerCase()));

        // STRICT MATCH for Status
        const matchesStatus = statusFilter ? order.status === statusFilter : true;

        const matchesDoctor = doctorFilter ? order.doctorId === doctorFilter : true;
        const matchesSupplier = supplierFilter ? order.supplierId === supplierFilter : true;
        const matchesDesigner = designerFilter ? order.designerId === designerFilter : true;

        // Date Logic
        let matchesDate = true;
        if (startDate || endDate) {
            const orderDate = new Date(order.createdAt);
            // Reset times for accurate date-only comparison
            orderDate.setHours(0, 0, 0, 0);

            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                if (orderDate < start) matchesDate = false;
            }

            if (endDate) {
                const end = new Date(endDate);
                end.setHours(0, 0, 0, 0);
                if (orderDate > end) matchesDate = false;
            }
        }

        // Hide Delivered/Rejected Check
        const matchesDelivered = hideDelivered ? (order.status !== 'Delivered' && order.status !== 'Returned for Adjustments') : true;
        const matchesRejected = hideRejected ? order.technicianStatus !== 'Rejected' : true;

        // Representative Filter
        const matchesRepresentative = representativeFilter ? order.representativeId === representativeFilter : true;

        return matchesSearch && matchesStatus && matchesDoctor && matchesSupplier && matchesDesigner && matchesDelivered && matchesRejected && matchesRepresentative && matchesDate;
    });

    const handleCreateOrder = async (orderData: Omit<Order, 'id' | 'createdAt'>) => {
        try {
            await db.addOrder(orderData);
            setIsFormOpen(false);
            await refreshOrders();
        } catch (error) {
            console.error('Error creating order:', error);
        }
    };

    const handleUpdateOrder = async (orderData: Partial<Order>) => {
        if (!fullEditingOrder) return;
        try {
            await db.updateOrder(fullEditingOrder.id, orderData);
            setFullEditingOrder(null);
            await refreshOrders();
        } catch (error) {
            console.error('Error updating order:', error);
        }
    };

    const handleStatusUpdate = async (id: string, status: Order['status'] | 'same') => {
        if (status === 'same') {
            await refreshOrders();
            return;
        }
        try {
            await db.updateOrder(id, { status });
            await refreshOrders();
            await refreshOrders();
        } catch (error) {
            console.error('Error updating status:', error);
            alert(`فشل تحديث الحالة: ${error instanceof Error ? error.message : 'حدث خطأ غير متوقع'}`);
        }
    };

    const handleDeleteOrder = async (order: Order) => {
        try {
            await db.deleteOrder(order.id);
            // alert('Order deleted successfully');
            await refreshOrders();
        } catch (error) {
            console.error('Error deleting order:', error);
            alert('Failed to delete order');
        }
    };

    const openFullEdit = (order: Order) => {
        setFullEditingOrder(order);
    };

    const openAddNote = (order: Order) => {
        setNoteEditingOrder(order);
        setNewComment('');
    };

    // Add Comment
    const handleAddComment = async () => {
        if (!noteEditingOrder || !newComment.trim()) return;

        const timestamp = new Date().toISOString();
        const commentObj = {
            id: Math.random().toString(36).substr(2, 9),
            text: newComment,
            userId: user?.id || 'unknown',
            userName: user?.name || user?.role || 'مستخدم',
            createdAt: timestamp
        };

        const updatedComments = [...(noteEditingOrder.comments || []), commentObj];

        try {
            await db.updateOrder(noteEditingOrder.id, { comments: updatedComments });
            setNoteEditingOrder((prev) => prev ? ({ ...prev, comments: updatedComments }) : null);
            setNewComment('');
            await refreshOrders();
        } catch (error) {
            console.error('Error adding comment:', error);
        }
    };

    // Design Link Update Logic
    const openDesignLinkModal = (order: Order) => {
        setDesignLinkOrder(order);
        setDesignLinkUrl(order.designUrl || '');
    };

    const handleUpdateDesignUrl = async () => {
        if (!designLinkOrder) return;

        try {
            await db.updateOrder(designLinkOrder.id, {
                designUrl: designLinkUrl,
                status: 'Waiting Dr Approval', // Auto-transition
                designStatus: 'waiting_approval' // Update internal design status too
            });

            // Add System Comment with the link
            const timestamp = new Date().toISOString();
            const commentObj = {
                id: Math.random().toString(36).substr(2, 9),
                text: `🔗 تم إضافة/تحديث رابط التصميم:\n${designLinkUrl}`,
                userId: user?.id || 'system',
                userName: user?.name || 'System',
                createdAt: timestamp
            };
            const updatedComments = [...(designLinkOrder.comments || []), commentObj];
            await db.updateOrder(designLinkOrder.id, { comments: updatedComments });

            setDesignLinkOrder(null);
            setDesignLinkUrl('');
            await refreshOrders();
            // alert('Design link updated and status set to Waiting Approval');
        } catch (error) {
            console.error('Error updating design link:', error);
            alert('Failed to update design link');
        }
    };

    // Helpers
    const canFilterByDoctorAndSupplier = user?.role === 'admin' || user?.role === 'representative';

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">{t.common.loading}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* === PAGE TITLE === */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">{t.orders.title}</h1>
                    <p className="text-sm text-gray-500 mt-0.5">إدارة ومتابعة جميع الطلبات والحالات</p>
                </div>
                {/* Export Buttons */}
                {['admin', 'accountant', 'lab'].includes(user?.role || '') && (
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => {
                                const exportData = filteredOrders.map(order => ({
                                    'رقم الحالة': order.caseId,
                                    'الطبيب': doctors.find(d => d.id === order.doctorId)?.name || '-',
                                    'المريض': order.patientName,
                                    'الحالة': order.status,
                                    'السعر': order.totalPrice,
                                    'تاريخ التسليم': order.deliveryDate,
                                    'الأولوية': order.priority === 'Urgent' ? 'عاجل' : 'عادي'
                                }));
                                const headers = {
                                    'رقم الحالة': 'رقم الحالة', 'الطبيب': 'الطبيب', 'المريض': 'المريض',
                                    'الحالة': 'الحالة', 'السعر': 'السعر', 'تاريخ التسليم': 'تاريخ التسليم', 'الأولوية': 'الأولوية'
                                };
                                exportToExcelWithHeaders(exportData, headers, `orders_${new Date().toISOString().split('T')[0]}`);
                            }}
                            className="p-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors border border-green-200"
                            title="تصدير Excel"
                        >
                            <FileSpreadsheet size={18} />
                        </button>
                        <button
                            onClick={() => {
                                printTable(
                                    filteredOrders.map(order => ({
                                        caseId: order.caseId,
                                        doctor: doctors.find(d => d.id === order.doctorId)?.name || '-',
                                        patient: order.patientName,
                                        status: order.status,
                                        price: order.totalPrice,
                                        date: order.deliveryDate
                                    })),
                                    [
                                        { key: 'caseId', label: 'رقم الحالة' },
                                        { key: 'doctor', label: 'الطبيب' },
                                        { key: 'patient', label: 'المريض' },
                                        { key: 'status', label: 'الحالة' },
                                        { key: 'price', label: 'السعر' },
                                        { key: 'date', label: 'تاريخ التسليم' }
                                    ],
                                    'قائمة الأوردرات'
                                );
                            }}
                            className="p-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
                            title="طباعة"
                        >
                            <Printer size={18} />
                        </button>
                    </div>
                )}
            </div>

            {/* === FILTERS PANEL === */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">

                {/* ROW 1: Main Filters (Full Width) */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {/* Status */}
                    <div>
                        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">الحالة</label>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            title="تصفية حسب الحالة"
                            className="w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                            <option value="">كل الحالات</option>
                            <option value="New Case">New Case</option>
                            <option value="Under Design">Under Design</option>
                            <option value="Waiting Dr Approval">Waiting Approval</option>
                            <option value="Under Production">Under Production</option>
                            <option value="Try In">Try In</option>
                            <option value="Try In Approved">Try In Approved</option>
                            <option value="Ready">Ready</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Returned for Adjustments">Returned</option>
                            <option value="Rejected">Rejected</option>
                        </select>
                    </div>

                    {/* Doctor */}
                    {canFilterByDoctorAndSupplier && (
                        <div>
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">الطبيب</label>
                            <select
                                value={doctorFilter}
                                onChange={(e) => setDoctorFilter(e.target.value)}
                                title="تصفية حسب الطبيب"
                                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
                            >
                                <option value="">كل الأطباء</option>
                                {doctors.map(doc => (
                                    <option key={doc.id} value={doc.id}>{doc.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Supplier/Lab */}
                    {canFilterByDoctorAndSupplier && (
                        <div>
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">المعمل</label>
                            <select
                                value={supplierFilter}
                                onChange={(e) => setSupplierFilter(e.target.value)}
                                title="تصفية حسب المعمل"
                                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
                            >
                                <option value="">كل المعامل</option>
                                {suppliers.map(sup => (
                                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Designer */}
                    {canFilterByDoctorAndSupplier && (
                        <div>
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">المصمم</label>
                            <select
                                value={designerFilter}
                                onChange={(e) => setDesignerFilter(e.target.value)}
                                title="تصفية حسب المصمم"
                                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
                            >
                                <option value="">كل المصممين</option>
                                {users.filter(u => u.role === 'designer').map(des => (
                                    <option key={des.id} value={des.id}>{des.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Sales Rep / Delegate */}
                    {canFilterByDoctorAndSupplier && (
                        <div>
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">المندوب</label>
                            <select
                                value={representativeFilter}
                                onChange={(e) => setRepresentativeFilter(e.target.value)}
                                title="تصفية حسب المندوب"
                                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
                            >
                                <option value="">كل المناديب</option>
                                {users.filter(u => u.role === 'representative' || u.role === 'admin').map(rep => (
                                    <option key={rep.id} value={rep.id}>{rep.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                {/* ROW 2: Date Filters + Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-100">
                    {/* Date Filters (Horizontal) */}
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">من</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            title="تاريخ البداية"
                            className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400 w-32"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">إلى</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            title="تاريخ النهاية"
                            className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400 w-32"
                        />
                    </div>

                    {/* Divider */}
                    <div className="hidden sm:block w-px h-6 bg-gray-200"></div>

                    {/* Search Input */}
                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                        <input
                            type="text"
                            placeholder="بحث بالطبيب، المريض، أو رقم الحالة..."
                            className="w-full pl-3 pr-9 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 focus:bg-white"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* New Order Button */}
                    {(user?.role === 'admin' || user?.role === 'representative') && !isAccountant && (
                        <button
                            onClick={() => setIsFormOpen(true)}
                            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm whitespace-nowrap"
                        >
                            <Plus size={16} />
                            <span>{t.orders.newOrder}</span>
                        </button>
                    )}

                    {/* Divider */}
                    <div className="hidden sm:block w-px h-6 bg-gray-200"></div>

                    {/* Hide Closed Toggle */}
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 hover:text-gray-800 select-none whitespace-nowrap">
                        <input
                            type="checkbox"
                            checked={hideDelivered}
                            onChange={(e) => {
                                setHideDelivered(e.target.checked);
                                setHideRejected(e.target.checked);
                            }}
                            className="w-4 h-4 text-blue-500 rounded border-gray-300 focus:ring-blue-400"
                        />
                        إخفاء المنتهية والمرفوضة
                    </label>

                    {/* Reset Filters */}
                    {(searchQuery || statusFilter || doctorFilter || supplierFilter || designerFilter || representativeFilter || startDate || endDate || hideDelivered) && (
                        <button
                            onClick={() => {
                                setSearchQuery(''); setStatusFilter(''); setDoctorFilter(''); setSupplierFilter('');
                                setDesignerFilter(''); setRepresentativeFilter(''); setStartDate(''); setEndDate('');
                                setHideDelivered(false); setHideRejected(false);
                            }}
                            className="text-sm text-red-500 hover:text-red-600 font-medium hover:underline whitespace-nowrap"
                        >
                            مسح الكل
                        </button>
                    )}
                </div>
            </div>

            {/* === SECTION 3: ORDER LIST === */}
            <OrderList
                orders={filteredOrders}
                onStatusChange={handleStatusUpdate}
                userRole={user?.role}
                onEdit={openFullEdit}
                onAddNote={openAddNote}
                onDelete={handleDeleteOrder}
                onUpdateDesignUrl={openDesignLinkModal}
                highlightedOrderId={highlightedOrderId}
            />

            {/* Create New Order Modal */}
            {isFormOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-800">إنشاء أوردر جديد</h2>
                                    <p className="text-gray-500 text-sm mt-1">أدخل بيانات الحالة الجديدة</p>
                                </div>
                                <button onClick={() => setIsFormOpen(false)} className="p-2 rounded-full hover:bg-gray-100 text-gray-500" aria-label="إغلاق">
                                    <X size={22} />
                                </button>
                            </div>
                            <OrderForm onSubmit={handleCreateOrder} onCancel={() => setIsFormOpen(false)} />
                        </div>
                    </div>
                </div>
            )}

            {/* Full Edit Modal */}
            {
                fullEditingOrder && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl animate-scale-in">
                            <div className="p-6 md:p-8">
                                <div className="flex justify-between items-center mb-8 border-b border-gray-100 pb-4">
                                    <div className='flex items-center gap-3'>
                                        <div className='bg-blue-100 p-2 rounded-lg text-blue-600'>
                                            <FileSpreadsheet size={24} />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-gray-800">تعديل الأوردر</h2>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-gray-500 text-sm">رقم الحالة:</span>
                                                <span className="bg-gray-100 px-2 py-0.5 rounded text-sm font-mono font-bold text-gray-700">#{fullEditingOrder.caseId}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setFullEditingOrder(null)} className="bg-gray-100 p-2 rounded-full text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors" aria-label="إغلاق">
                                        <X size={24} />
                                    </button>
                                </div>
                                <OrderForm
                                    onSubmit={handleUpdateOrder}
                                    onCancel={() => setFullEditingOrder(null)}
                                    initialData={fullEditingOrder}
                                />
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Note & Chat Modal */}
            {
                noteEditingOrder && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
                            {/* Header */}
                            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                                <div>
                                    <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                        <MessageCircle size={20} className="text-blue-600" />
                                        سجل الملاحظات والدردشة
                                    </h3>
                                    <p className="text-xs text-gray-500 mt-0.5">الحالة #{noteEditingOrder.caseId}</p>
                                </div>
                                <button onClick={() => setNoteEditingOrder(null)} className="p-1 hover:bg-gray-200 rounded-full transition-colors" aria-label="إغلاق">
                                    <X className="text-gray-500" size={20} />
                                </button>
                            </div>

                            {/* Chat Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                                {/* Instructions Box */}
                                {noteEditingOrder.instructions && (
                                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-1 h-full bg-amber-400"></div>
                                        <p className="text-xs font-bold text-amber-800 mb-2 flex items-center gap-1">
                                            <span className="text-lg">📝</span> التعليمات الأساسية
                                        </p>
                                        <p className="text-sm text-gray-700 leading-relaxed font-medium">{noteEditingOrder.instructions}</p>
                                    </div>
                                )}

                                {/* Divider if needed */}
                                {(noteEditingOrder.comments && noteEditingOrder.comments.length > 0) && (
                                    <div className="relative flex py-2 items-center">
                                        <div className="flex-grow border-t border-gray-200"></div>
                                        <span className="flex-shrink-0 mx-4 text-gray-400 text-xs">سجل النشاط</span>
                                        <div className="flex-grow border-t border-gray-200"></div>
                                    </div>
                                )}

                                {/* Comments List */}
                                {noteEditingOrder.comments && noteEditingOrder.comments.length > 0 ? (
                                    noteEditingOrder.comments.map((comment) => (
                                        <div key={comment.id} className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2 px-2">
                                                <span className="text-xs font-bold text-gray-700">{comment.userName}</span>
                                                <span className="text-[10px] text-gray-400">{new Date(comment.createdAt).toLocaleDateString('ar-EG')} • {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <div className={`p-3 rounded-2xl shadow-sm border border-gray-100 text-sm leading-relaxed ${comment.userId === user?.id ? 'bg-blue-50 text-blue-900 rounded-tr-none mr-4' : 'bg-white text-gray-800 rounded-tl-none ml-4'
                                                }`}>
                                                {comment.text}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    !noteEditingOrder.instructions && (
                                        <div className="flex flex-col items-center justify-center py-10 text-gray-400 opacity-60">
                                            <MessageCircle size={48} className="mb-2" />
                                            <p className="text-sm">لا توجد ملاحظات حتى الآن</p>
                                        </div>
                                    )
                                )}
                            </div>

                            {/* Input Area */}
                            <div className="p-4 bg-white border-t border-gray-100">
                                <div className="flex gap-2 items-end">
                                    <div className="flex-1 relative">
                                        <textarea
                                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl max-h-32 min-h-[50px] focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none resize-none text-sm leading-relaxed"
                                            value={newComment}
                                            onChange={e => setNewComment(e.target.value)}
                                            placeholder="اكتب ملاحظة جديدة..."
                                            rows={2}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleAddComment();
                                                }
                                            }}
                                        />
                                    </div>
                                    <button
                                        onClick={handleAddComment}
                                        disabled={!newComment.trim()}
                                        className="h-[50px] w-[50px] bg-blue-600 text-white rounded-xl hover:bg-blue-700 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-100 hover:shadow-lg"
                                        title="إرسال"
                                    >
                                        <Send size={20} className={newComment.trim() ? 'ml-0.5' : ''} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Design Link Modal */}
            {
                designLinkOrder && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-scale-in">
                            <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    🔗 إضافة رابط التصميم
                                </h3>
                                <button onClick={() => setDesignLinkOrder(null)} aria-label="إغلاق"><X size={20} className="text-gray-400 hover:text-red-500" /></button>
                            </div>
                            <div className="p-6">
                                <label className="block text-sm font-bold text-gray-700 mb-2">رابط الملف</label>
                                <div className="relative mb-4">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🌐</span>
                                    <input
                                        type="url"
                                        className="w-full pl-3 pr-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-sm dir-ltr font-mono text-gray-600"
                                        placeholder="https://drive.google.com/..."
                                        value={designLinkUrl}
                                        onChange={e => setDesignLinkUrl(e.target.value)}
                                    />
                                </div>

                                <div className="bg-blue-50 p-4 rounded-xl text-xs text-blue-800 mb-6 flex gap-2 items-start">
                                    <span className="text-lg">ℹ️</span>
                                    <p className="mt-0.5">عند الحفظ، سيتم تحديث حالة الأوردر تلقائياً إلى <strong>Waiting Dr Approval</strong> وسيتم إرسال إشعار للطبيب.</p>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={handleUpdateDesignUrl}
                                        className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-100"
                                    >
                                        حفظ وإرسال
                                    </button>
                                    <button
                                        onClick={() => setDesignLinkOrder(null)}
                                        className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-200 transition"
                                    >
                                        إلغاء
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
