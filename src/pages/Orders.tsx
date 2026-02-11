import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import OrderList from '../components/orders/OrderList';
import OrderForm from '../components/orders/OrderForm';
import { db } from '../services/db';
import type { Order, Doctor, Supplier, User } from '../services/db';
import { Plus, X, Search, Send, MessageCircle, FileSpreadsheet, Printer, Calendar, Filter, User as UserIcon, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { exportToExcelWithHeaders } from '../lib/exportUtils';
import { generateDoctorInvoicePDF, generateOrdersListPDF } from '../services/pdfService';
import { calculateOpeningBalance, DEFAULT_LAB_INFO } from '../utils/finance';
import { useTranslation } from '../translations';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';

import { useReactToPrint } from 'react-to-print';
import { OrderInvoice } from '../components/orders/OrderInvoice';
import AcceptOrderModal from '../components/orders/AcceptOrderModal';


export default function Orders() {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const highlightedOrderId = searchParams.get('highlight');

    useEffect(() => {
        if (highlightedOrderId) {
            const timer = setTimeout(() => {
                setSearchParams({}, { replace: true });
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [highlightedOrderId, setSearchParams]);

    // Note: isDesigner check removed - RLS handles role-based filtering at DB level
    const isAccountant = user?.role === 'accountant';
    const { t } = useTranslation();

    // Data state
    const [orders, setOrders] = useState<Order[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [users, setUsers] = useState<User[]>([]);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const PAGE_SIZE = 50;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    // Filter state (server-side)
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [doctorFilter, setDoctorFilter] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');
    const [designerFilter, setDesignerFilter] = useState('');
    const [representativeFilter, setRepresentativeFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [hideDelivered, setHideDelivered] = useState(true);
    const [hideRejected, setHideRejected] = useState(false);

    // Modal state
    const [fullEditingOrder, setFullEditingOrder] = useState<Order | null>(null);
    const [noteEditingOrder, setNoteEditingOrder] = useState<Order | null>(null);
    const [newComment, setNewComment] = useState('');
    const [designLinkOrder, setDesignLinkOrder] = useState<Order | null>(null);
    const [designLinkUrl, setDesignLinkUrl] = useState('');
    const [acceptingOrder, setAcceptingOrder] = useState<Order | null>(null);

    // Build filters object for server-side query
    const buildFilters = () => {
        const filters: {
            status?: string;
            startDate?: string;
            endDate?: string;
            doctorId?: string;
            representativeId?: string;
            supplierId?: string;
            designerId?: string;
            search?: string;
            hideDelivered?: boolean;
            hideRejected?: boolean;
        } = {};

        if (statusFilter) filters.status = statusFilter;
        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;
        if (doctorFilter) filters.doctorId = doctorFilter;
        if (representativeFilter) filters.representativeId = representativeFilter;
        if (supplierFilter) filters.supplierId = supplierFilter;
        if (designerFilter) filters.designerId = designerFilter;
        if (searchQuery.trim()) filters.search = searchQuery.trim();
        if (hideDelivered) filters.hideDelivered = true;
        if (hideRejected) filters.hideRejected = true;

        return filters;
    };

    // Fetch orders with server-side pagination and filtering
    const refreshOrders = async (page: number = currentPage) => {
        setIsLoading(true);
        try {
            const filters = buildFilters();
            const [ordersResult, doctorsData, suppliersData, usersData] = await Promise.all([
                db.getOrders(page, PAGE_SIZE, filters),
                db.getDoctors(),
                db.getSuppliers(),
                db.getUsers()
            ]);
            setOrders(ordersResult.data);
            setTotalCount(ordersResult.count);
            setDoctors(doctorsData);
            setSuppliers(suppliersData);
            setUsers(usersData);
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // CONSOLIDATED: Single debounced effect for all filter and search changes
    // Debounces all filter changes to prevent multiple rapid fetches
    useEffect(() => {
        const timer = setTimeout(() => {
            setCurrentPage(1);
            refreshOrders(1);
        }, 150); // Shorter debounce for filter changes, still prevents rapid calls
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, doctorFilter, supplierFilter, designerFilter, representativeFilter, startDate, endDate, hideDelivered, hideRejected]); // Removed searchQuery from here

    // Page change handler
    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        refreshOrders(page);
    };

    // NOTE: Client-side filtering REMOVED - all filtering now happens server-side
    // RLS handles role-based filtering at the database level
    // The 'orders' array already contains only filtered records from the server

    const handleSearch = () => {
        setCurrentPage(1);
        refreshOrders(1);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

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

    // CENTRALIZED STATUS UPDATE - ensures status/designStatus sync for Split Workflows
    const handleStatusUpdate = async (id: string, status: Order['status'] | 'same') => {
        if (status === 'same') {
            await refreshOrders();
            return;
        }
        try {
            // Use centralized status update to ensure designStatus sync
            await db.updateOrderStatus(id, status);
            await refreshOrders();
        } catch (error) {
            alert(`فشل تحديث الحالة: ${error instanceof Error ? error.message : 'حدث خطأ غير متوقع'}`);
        }
    };

    const handleDeleteOrder = async (order: Order) => {
        try {
            await db.deleteOrder(order.id);
            await refreshOrders();
        } catch {
            alert('Failed to delete order');
        }
    };

    const openFullEdit = (order: Order) => setFullEditingOrder(order);

    const openAddNote = (order: Order) => {
        setNoteEditingOrder(order);
        setNewComment('');
    };

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

    const openDesignLinkModal = (order: Order) => {
        setDesignLinkOrder(order);
        setDesignLinkUrl(order.designUrl || '');
    };

    const handleUpdateDesignUrl = async () => {
        if (!designLinkOrder) return;
        try {
            // Use centralized function that handles all side-effects
            await db.submitDesignForApproval(
                designLinkOrder.id,
                designLinkUrl,
                user?.id || 'system',
                user?.name || 'System'
            );
            setDesignLinkOrder(null);
            setDesignLinkUrl('');
            await refreshOrders();
        } catch {
            alert('Failed to update design link');
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
            // 1. Update Order with new details
            const orderUpdate = {
                caseId: data.caseId,
                workflowType: data.workflowType,
                supplierId: data.supplierId,
                designerId: data.workflowType === 'split' ? (data.designerId || undefined) : undefined,
                receivedDate: data.receivedDate,
                deliveryDate: data.deliveryDate,
                // Status mapping:
                // Full Lab -> New Case (Waiting for Lab)
                // Split -> New Case (Waiting for Designer)
                // Actually unified status: 'New Case' is fine start. 
                // BUT logic says:
                // Split -> status='New Case', designStatus='Pending'
                // Full -> status='New Case', technicianStatus='Pending'
                status: 'New Case' as Order['status'], // Explicit cast
                designStatus: (data.workflowType === 'split' ? 'pending' : undefined) as Order['designStatus'],
                technicianStatus: 'Pending' as 'Pending' | 'Approved' | 'Rejected' | 'NeedDetails' | 'PMMA_First',
            };

            await db.updateOrder(acceptingOrder.id, orderUpdate);

            // 2. Add System Comment
            const supplierName = suppliers.find(s => s.id === data.supplierId)?.name;
            const designerName = users.find(u => u.id === data.designerId)?.name;

            let commentText = `Starting ${data.workflowType === 'full' ? 'Full Lab' : 'Split'} Workflow.`;
            commentText += `\nLab: ${supplierName}`;
            if (data.workflowType === 'split') commentText += `\nDesigner: ${designerName}`;

            // Create system comment object
            const systemComment = {
                id: Math.random().toString(36).substr(2, 9),
                text: commentText,
                userId: user?.id || 'system',
                userName: user?.name || 'System',
                createdAt: new Date().toISOString()
            };

            // Use updateOrder to append comment
            // We need to fetch current comments first to append, but updateOrder handles full replacement.
            // Ideally we'd use a specific updateComments method or db.updateOrder support.
            // Since we just updated order above, we can assume we need to fetch fresh or just append.
            // Actually, updateOrder in db.ts supports partial updates.
            // Let's refetch or just push.
            // Better yet, use the centralized status update function which SUPPORTS comments!
            // Wait, we need to update multiple fields (status, designStatus, dates, supplier etc).
            // db.updateOrder is best here.

            // To be safe, let's fetch the latest order state to append comments correctly
            const freshOrder = await db.getOrder(acceptingOrder.id);
            if (freshOrder) {
                const updatedComments = [...(freshOrder.comments || []), systemComment];
                await db.updateOrder(acceptingOrder.id, { comments: updatedComments });
            }

            setAcceptingOrder(null);
            await refreshOrders(); // Refresh dashboard
        } catch (error) {
            console.error('Failed to accept order:', error);
            alert('Failed to accept order. Please try again.');
        }
    };

    const canFilterByDoctorAndSupplier = user?.role === 'admin' || user?.role === 'representative';

    // Print Logic
    const [printingOrder, setPrintingOrder] = useState<Order | null>(null);
    const printRef = useRef<HTMLDivElement>(null);

    const handlePrintProcessed = useReactToPrint({
        content: () => printRef.current,
        onAfterPrint: () => setPrintingOrder(null),
    } as any);

    useEffect(() => {
        if (printingOrder) {
            handlePrintProcessed();
        }
    }, [printingOrder, handlePrintProcessed]);

    const handlePrintClick = (order: Order) => {
        setPrintingOrder(order);
    };

    const handleExportInvoice = async (order: Order) => {
        const doctor = doctors.find(d => d.id === order.doctorId);
        let previousBalance: number | undefined;

        try {
            const { orders: allOrders, transactions } = await db.fetchFullEntityStatement(order.doctorId, 'doctor');
            const orderDate = order.deliveryDate || order.createdAt.split('T')[0];
            previousBalance = calculateOpeningBalance(allOrders, transactions, order.doctorId, orderDate);
        } catch {
            console.warn('Could not calculate previous balance for invoice');
        }

        await generateDoctorInvoicePDF(order, doctor, DEFAULT_LAB_INFO, previousBalance);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen w-full">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
                    <p className="text-surface-600 animate-pulse">{t.common.loading}</p>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
        >
            {/* Hidden Invoice for Printing */}
            <div className="hidden">
                {printingOrder && (
                    <OrderInvoice
                        ref={printRef}
                        order={printingOrder}
                        doctor={doctors.find(d => d.id === printingOrder.doctorId)}
                        labInfo={{
                            name: 'ORCA Dental Lab',
                            address: 'Cairo, Egypt',
                            phone: '+20 123 456 7890'
                        }}
                    />
                )}
            </div>

            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-700 to-primary-500">{t.orders.title}</h1>
                    <p className="text-xs sm:text-sm text-surface-500 mt-1">إدارة ومتابعة جميع الطلبات والحالات</p>
                </div>
                {['admin', 'accountant', 'lab'].includes(user?.role || '') && (
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                const exportData = orders.map((order: Order) => ({
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
                            className="text-green-600 border-green-200 hover:bg-green-50"
                        >
                            <FileSpreadsheet size={18} />
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => {
                                generateOrdersListPDF(
                                    orders.map((order: Order) => ({
                                        caseId: order.caseId,
                                        doctor: doctors.find(d => d.id === order.doctorId)?.name || '-',
                                        patient: order.patientName,
                                        status: order.status,
                                        price: order.totalPrice,
                                        date: order.deliveryDate
                                    })),
                                    DEFAULT_LAB_INFO
                                );
                            }}
                            className="text-surface-600 border-surface-200 hover:bg-surface-50"
                        >
                            <Printer size={18} />
                        </Button>
                    </div>
                )}
            </div>

            {/* Header & Filters - Compact Pro Max */}
            <div className="sticky top-4 z-40 mb-6 space-y-4">
                <Card className="p-3 border-none shadow-sm bg-white/95 backdrop-blur-md ring-1 ring-surface-950/5">
                    <div className="flex flex-col gap-2">
                        {/* Row 1: Search, Date, Actions, Checkbox 1 */}
                        <div className="flex flex-col lg:flex-row gap-3 items-center">
                            {/* Actions & Search */}
                            <div className="flex flex-1 items-center gap-3 w-full">
                                {/* New Order Button */}
                                {(user?.role === 'admin' || user?.role === 'representative') && !isAccountant && (
                                    <Button onClick={() => setIsFormOpen(true)} className="gap-2 shadow-sm shadow-primary-500/20 bg-primary-600 hover:bg-primary-700 text-white border-0 ring-0 h-9 px-4 rounded-xl whitespace-nowrap">
                                        <Plus size={16} />
                                        <span className="font-bold text-sm hidden xl:inline">{t.orders.newOrder}</span>
                                        <span className="font-bold text-sm xl:hidden">{t.common.add}</span>
                                    </Button>
                                )}

                                {/* Search Input */}
                                <div className="relative flex-1 group min-w-[200px]">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Search className="h-4 w-4 text-surface-400 group-focus-within:text-primary-500 transition-colors" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder={t.common.search}
                                        className="block w-full pl-10 pr-16 py-2 bg-surface-50 border-none ring-1 ring-surface-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/50 transition-all shadow-sm group-hover:ring-surface-300"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                    />
                                    <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                                        <Button size="sm" variant="ghost" className="h-7 text-xs text-surface-400 hover:text-primary-600 p-1" onClick={handleSearch}>
                                            ENTER
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Date Range (Moved to Top) */}
                            <div className="flex items-center bg-surface-50 ring-1 ring-surface-200 rounded-lg px-2 group hover:bg-white transition-colors h-9 flex-shrink-0 w-full sm:w-auto">
                                <Calendar className="h-3.5 w-3.5 text-surface-400 mr-2 flex-shrink-0" />
                                <input
                                    type="date"
                                    title="Start Date"
                                    aria-label="Start Date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="bg-transparent border-none p-1.5 text-xs outline-none text-surface-600 font-medium placeholder-surface-400 w-24 sm:w-28 min-w-0"
                                />
                                <span className="text-surface-300 mx-1">/</span>
                                <input
                                    type="date"
                                    title="End Date"
                                    aria-label="End Date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="bg-transparent border-none p-1.5 text-xs outline-none text-surface-600 font-medium placeholder-surface-400 w-24 sm:w-28 min-w-0"
                                />
                            </div>

                            {/* Checkbox 1 (Top Left) */}
                            <div className="hidden lg:flex items-center min-w-[110px] justify-end">
                                <label className="flex items-center gap-1.5 cursor-pointer group select-none">
                                    <input type="checkbox" checked={hideDelivered} onChange={(e) => setHideDelivered(e.target.checked)} className="hidden" />
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${hideDelivered ? 'bg-primary-600 border-primary-600' : 'border-surface-300 bg-white group-hover:border-primary-500'}`}>
                                        {hideDelivered && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                                    </div>
                                    <span className={`text-[10px] uppercase font-bold tracking-wider ${hideDelivered ? 'text-primary-700' : 'text-surface-400 group-hover:text-primary-600 ml-auto'}`}>إخفاء المنتهية</span>
                                </label>
                            </div>
                        </div>

                        {/* Row 2: All Filters & Checkbox 2 */}
                        <div className="flex flex-col lg:flex-row gap-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 flex-1">
                                {/* Status */}
                                <div className="col-span-1 relative group">
                                    <select
                                        title="Status Filter"
                                        aria-label="Filter by Status"
                                        value={statusFilter}
                                        onChange={(e) => setStatusFilter(e.target.value)}
                                        className="w-full pl-8 pr-8 py-2 bg-surface-50 border-none ring-1 ring-surface-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-primary-500/50 appearance-none cursor-pointer group-hover:bg-white transition-colors"
                                    >
                                        <option value="">{t.common.status}</option>
                                        <option value="New Case">New Case</option>
                                        <option value="Under Design">Under Design</option>
                                        <option value="Waiting Dr Approval">Wait Approval</option>
                                        <option value="Under Production">Production</option>
                                        <option value="Try In">Try In</option>
                                        <option value="Review">Review</option>
                                        <option value="Ready">Ready</option>
                                        <option value="Completed">Completed</option>
                                        <option value="Delivered">Delivered</option>
                                        <option value="Rejected">Rejected</option>
                                    </select>
                                    <Filter className="absolute left-2.5 top-2 h-3.5 w-3.5 text-surface-400" />
                                    <ChevronDown className="absolute right-2.5 top-2.5 h-3 w-3 text-surface-400 pointer-events-none" />
                                </div>

                                {canFilterByDoctorAndSupplier && (
                                    <>
                                        {/* Doctor */}
                                        <div className="col-span-1 relative group">
                                            <select
                                                title="Doctor Filter"
                                                aria-label="Filter by Doctor"
                                                value={doctorFilter}
                                                onChange={(e) => setDoctorFilter(e.target.value)}
                                                className="w-full pl-8 pr-8 py-2 bg-surface-50 border-none ring-1 ring-surface-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-primary-500/50 appearance-none cursor-pointer group-hover:bg-white transition-colors"
                                            >
                                                <option value="">كل الأطباء</option>
                                                {doctors.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                                            </select>
                                            <UserIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-surface-400" />
                                            <ChevronDown className="absolute right-2.5 top-2.5 h-3 w-3 text-surface-400 pointer-events-none" />
                                        </div>

                                        {/* Supplier */}
                                        <div className="col-span-1 relative group">
                                            <select
                                                title="Supplier Filter"
                                                aria-label="Filter by Supplier"
                                                value={supplierFilter}
                                                onChange={(e) => setSupplierFilter(e.target.value)}
                                                className="w-full pl-2 pr-6 py-2 bg-surface-50 border-none ring-1 ring-surface-200 rounded-lg text-xs text-surface-500 focus:ring-2 focus:ring-primary-500/50 appearance-none cursor-pointer group-hover:bg-white transition-colors"
                                            >
                                                <option value="">كل المعامل</option>
                                                {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                                            </select>
                                            <ChevronDown className="absolute right-2 top-2.5 h-3 w-3 text-surface-300 pointer-events-none" />
                                        </div>

                                        {/* Designer */}
                                        <div className="col-span-1 relative group">
                                            <select
                                                title="Designer Filter"
                                                aria-label="Filter by Designer"
                                                value={designerFilter}
                                                onChange={(e) => setDesignerFilter(e.target.value)}
                                                className="w-full pl-2 pr-6 py-2 bg-surface-50 border-none ring-1 ring-surface-200 rounded-lg text-xs text-surface-500 focus:ring-2 focus:ring-primary-500/50 appearance-none cursor-pointer group-hover:bg-white transition-colors"
                                            >
                                                <option value="">كل المصممين</option>
                                                {users.filter(u => u.role === 'designer').map(des => <option key={des.id} value={des.id}>{des.name}</option>)}
                                            </select>
                                            <ChevronDown className="absolute right-2 top-2.5 h-3 w-3 text-surface-300 pointer-events-none" />
                                        </div>

                                        {/* Representative */}
                                        <div className="col-span-1 relative group">
                                            <select
                                                title="Representative Filter"
                                                aria-label="Filter by Representative"
                                                value={representativeFilter}
                                                onChange={(e) => setRepresentativeFilter(e.target.value)}
                                                className="w-full pl-2 pr-6 py-2 bg-surface-50 border-none ring-1 ring-surface-200 rounded-lg text-xs text-surface-500 focus:ring-2 focus:ring-primary-500/50 appearance-none cursor-pointer group-hover:bg-white transition-colors"
                                            >
                                                <option value="">كل المناديب</option>
                                                {users.filter(u => (u.role === 'representative' || u.role === 'admin') && u.username !== 'admin').map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                                            </select>
                                            <ChevronDown className="absolute right-2 top-2.5 h-3 w-3 text-surface-300 pointer-events-none" />
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Checkbox 2 (Bottom Left) */}
                            <div className="hidden lg:flex items-center min-w-[110px] justify-end">
                                <label className="flex items-center gap-1.5 cursor-pointer group select-none">
                                    <input type="checkbox" checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)} className="hidden" />
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${hideRejected ? 'bg-red-500 border-red-500' : 'border-surface-300 bg-white group-hover:border-red-500'}`}>
                                        {hideRejected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                                    </div>
                                    <span className={`text-[10px] uppercase font-bold tracking-wider ${hideRejected ? 'text-red-700' : 'text-surface-400 group-hover:text-red-600 ml-auto'}`}>إخفاء المرفوضة</span>
                                </label>
                            </div>

                            {/* Mobile Checkboxes (Visible only on small screens) */}
                            <div className="flex lg:hidden gap-4 mt-2">
                                <label className="flex items-center gap-2 text-xs">
                                    <input type="checkbox" checked={hideDelivered} onChange={(e) => setHideDelivered(e.target.checked)} />
                                    إخفاء المنتهية
                                </label>
                                <label className="flex items-center gap-2 text-xs">
                                    <input type="checkbox" checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)} />
                                    إخفاء المرفوضة
                                </label>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Order List */}
            <OrderList
                orders={orders}
                onStatusChange={handleStatusUpdate}
                userRole={user?.role}
                onEdit={openFullEdit}
                onAddNote={openAddNote}
                onDelete={handleDeleteOrder}
                onUpdateDesignUrl={openDesignLinkModal}
                highlightedOrderId={highlightedOrderId}
                onAccept={(order) => setAcceptingOrder(order)}
                onPrint={handlePrintClick}
                onExportInvoice={handleExportInvoice}
                currentUser={user || undefined}
            />


            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-6">
                    <Button
                        variant="outline"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage <= 1}
                        className="px-3 py-1.5 text-sm"
                    >
                        السابق
                    </Button>
                    <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let pageNum: number;
                            if (totalPages <= 5) {
                                pageNum = i + 1;
                            } else if (currentPage <= 3) {
                                pageNum = i + 1;
                            } else if (currentPage >= totalPages - 2) {
                                pageNum = totalPages - 4 + i;
                            } else {
                                pageNum = currentPage - 2 + i;
                            }
                            return (
                                <Button
                                    key={pageNum}
                                    variant={currentPage === pageNum ? 'primary' : 'outline'}
                                    onClick={() => handlePageChange(pageNum)}
                                    className="px-3 py-1.5 text-sm min-w-[40px]"
                                >
                                    {pageNum}
                                </Button>
                            );
                        })}
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages}
                        className="px-3 py-1.5 text-sm"
                    >
                        التالي
                    </Button>
                    <span className="text-sm text-surface-500 mr-4">
                        {totalCount} طلب
                    </span>
                </div>
            )}

            {/* Modals - Wrapped with AnimatePresence for transitions */}
            <AnimatePresence>
                {isFormOpen && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl">
                            <div className="p-6">
                                <div className="flex justify-between items-center mb-6 pb-4 border-b border-surface-100">
                                    <div>
                                        <h2 className="text-2xl font-bold text-surface-900">إنشاء أوردر جديد</h2>
                                        <p className="text-surface-500 text-sm mt-1">أدخل بيانات الحالة الجديدة</p>
                                    </div>
                                    <button onClick={() => setIsFormOpen(false)} aria-label="Close" className="p-2 rounded-full hover:bg-surface-100 text-surface-400 transition-colors"><X size={24} /></button>
                                </div>
                                <OrderForm onSubmit={handleCreateOrder} onCancel={() => setIsFormOpen(false)} />
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {fullEditingOrder && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl">
                            <div className="p-8">
                                <div className="flex justify-between items-center mb-8 border-b border-surface-100 pb-4">
                                    <div className='flex items-center gap-4'>
                                        <div className='bg-primary-100 p-3 rounded-xl text-primary-600'><FileSpreadsheet size={24} /></div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-surface-900">تعديل الأوردر</h2>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-surface-500 text-sm">رقم الحالة:</span>
                                                <span className="bg-surface-100 px-2 py-0.5 rounded text-sm font-mono font-bold text-surface-700">#{fullEditingOrder.caseId}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setFullEditingOrder(null)} aria-label="Close" className="p-2 rounded-full hover:bg-surface-100 text-surface-400 transition-colors"><X size={24} /></button>
                                </div>
                                <OrderForm onSubmit={handleUpdateOrder} onCancel={() => setFullEditingOrder(null)} initialData={fullEditingOrder} />
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {noteEditingOrder && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                            <div className="p-4 border-b flex justify-between items-center bg-surface-50">
                                <div>
                                    <h3 className="font-bold text-lg text-surface-900 flex items-center gap-2"><MessageCircle size={20} className="text-primary-600" /> التواصل والملاحظات</h3>
                                    <p className="text-xs text-surface-500 mt-0.5">الحالة #{noteEditingOrder.caseId}</p>
                                </div>
                                <button onClick={() => setNoteEditingOrder(null)} aria-label="Close" className="p-1 hover:bg-surface-200 rounded-full transition-colors"><X className="text-surface-400" size={20} /></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
                                {noteEditingOrder.instructions && (
                                    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-1.5 h-full bg-amber-400"></div>
                                        <p className="text-xs font-bold text-amber-800 mb-2 flex items-center gap-1"><span className="text-lg">📝</span> التعليمات الأساسية</p>
                                        <p className="text-sm text-surface-800 leading-relaxed font-medium">{noteEditingOrder.instructions}</p>
                                    </div>
                                )}
                                <div className="space-y-3">
                                    {noteEditingOrder.comments?.map((comment) => (
                                        <div key={comment.id} className={`flex flex-col ${comment.userId === user?.id ? 'items-start' : 'items-end'}`}>
                                            <div className="flex items-center gap-2 mb-1 px-1">
                                                <span className="text-xs font-bold text-surface-700">{comment.userName}</span>
                                                <span className="text-[10px] text-surface-400">{new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <div className={`p-3 max-w-[85%] rounded-2xl text-sm leading-relaxed shadow-sm ${comment.userId === user?.id
                                                ? 'bg-primary-50 text-primary-900 rounded-tr-none'
                                                : 'bg-surface-100 text-surface-900 rounded-tl-none'
                                                }`}>
                                                {comment.text}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="p-4 bg-white border-t border-surface-100">
                                <div className="flex gap-2 items-end">
                                    <textarea
                                        className="flex-1 p-3 bg-surface-50 border border-surface-200 rounded-xl focus:ring-2 focus:ring-primary-100 focus:border-primary-400 outline-none resize-none text-sm transition-all"
                                        value={newComment}
                                        onChange={e => setNewComment(e.target.value)}
                                        placeholder="اكتب ملاحظة..."
                                        rows={2}
                                    />
                                    <Button onClick={handleAddComment} disabled={!newComment.trim()} aria-label="Send Comment" className="h-[46px] w-[46px] rounded-xl p-0 flex items-center justify-center shadow-lg shadow-primary-500/20">
                                        <Send size={18} className={newComment.trim() ? 'ml-0.5' : ''} />
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {designLinkOrder && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden">
                            <div className="p-4 bg-surface-50 border-b flex justify-between items-center">
                                <h3 className="font-bold text-surface-800 flex items-center gap-2">🔗 إضافة رابط التصميم</h3>
                                <button onClick={() => setDesignLinkOrder(null)} aria-label="Close"><X size={20} className="text-surface-400 hover:text-red-500" /></button>
                            </div>
                            <div className="p-6">
                                <Input
                                    label="رابط الملف"
                                    placeholder="https://drive.google.com/..."
                                    value={designLinkUrl}
                                    onChange={e => setDesignLinkUrl(e.target.value)}
                                    className="font-mono text-sm"
                                />
                                <div className="bg-blue-50 p-4 rounded-xl text-xs text-blue-800 mb-6 mt-4 flex gap-2">
                                    <span className="text-lg">ℹ️</span>
                                    <p className="mt-0.5 leading-relaxed">عند الحفظ، سيتم تحديث حالة الأوردر تلقائياً إلى <strong>Waiting Dr Approval</strong>.</p>
                                </div>
                                <div className="flex gap-3">
                                    <Button onClick={handleUpdateDesignUrl} className="flex-1 shadow-lg shadow-primary-500/20">حفظ وإرسال</Button>
                                    <Button variant="secondary" onClick={() => setDesignLinkOrder(null)} className="flex-1">إلغاء</Button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
                {acceptingOrder && (
                    <AcceptOrderModal
                        order={acceptingOrder}
                        doctors={doctors}
                        suppliers={suppliers}
                        designers={users.filter(u => u.role === 'designer')}
                        existingOrders={orders}
                        onClose={() => setAcceptingOrder(null)}
                        onConfirm={handleAcceptOrder}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}
