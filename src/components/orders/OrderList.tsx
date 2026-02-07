import { useState, useEffect, useCallback } from 'react';
import { Package, Star } from 'lucide-react';
import type { Order } from '../../services/db';
import { db } from '../../services/db';
import clsx from 'clsx';
import { generateCaseId } from '../../utils/caseId';
import OrderCard from './OrderCard';

interface OrderListProps {
    orders: Order[];
    onStatusChange: (id: string, status: Order['status'] | 'same') => void;
    userRole?: string;
    userId?: string;
    onEdit?: (order: Order) => void; // Full Edit (Admin)
    onAddNote?: (order: Order) => void; // Add Note (Everyone)
    onUpdateDesignUrl?: (order: Order) => void; // Update Design URL (Designer/Admin)
    onDelete?: (order: Order) => void;
    highlightedOrderId?: string | null; // Order ID to highlight and scroll to
    onAccept?: (order: Order) => void;
}

export default function OrderList({ orders = [], onStatusChange, userRole, onEdit, onAddNote, onUpdateDesignUrl, onDelete, highlightedOrderId, onAccept }: OrderListProps) {
    const [doctors, setDoctors] = useState<Record<string, string>>({});
    const [suppliers, setSuppliers] = useState<Record<string, string>>({});

    // Feedback Modal State
    const [feedbackOrder, setFeedbackOrder] = useState<Order | null>(null);
    const [feedbackData, setFeedbackData] = useState<{ rating: number; issues: string[]; notes: string; rootCause: 'Lab' | 'Doctor' | 'Scan' | 'Communication' }>({ rating: 5, issues: [], notes: '', rootCause: 'Lab' });

    // Filter/Privacy Logic
    const hideSensitiveInfo = userRole === 'lab' || userRole === 'designer';
    const filteredOrders = orders || []; // Define filteredOrders

    const [usersMap, setUsersMap] = useState<Record<string, string>>({});

    useEffect(() => {
        const loadAuxData = async () => {
            try {
                const [docs, sups, allUsers] = await Promise.all([
                    db.getDoctors(),
                    Promise.resolve(db.getSuppliers()),
                    db.getUsers()
                ]);

                const mapD: Record<string, string> = {};
                docs.forEach(d => mapD[d.id] = d.name);
                setDoctors(mapD);

                const mapS: Record<string, string> = {};
                sups.forEach(s => mapS[s.id] = s.name);
                setSuppliers(mapS);

                const mapU: Record<string, string> = {};
                allUsers.forEach(u => mapU[u.id] = u.name);
                setUsersMap(mapU);

                // Add Designers Map logic if needed for filters inside list, though handled above
            } catch (error) {
                console.error('Error loading auxiliary data:', error);
            }
        };
        loadAuxData();
    }, []);

    const finalOrders = filteredOrders;

    const handleTechAction = useCallback(async (orderId: string, action: 'Approved' | 'Rejected' | 'NeedDetails' | 'PMMA_First') => {
        try {
            await db.updateOrder(orderId, { technicianStatus: action });

            // Auto-Status Logic: If Accepted and current status is 'New Case', move to 'Under Design'
            if (action === 'Approved') {
                const order = orders.find(o => o.id === orderId);
                if (order && order.status === 'New Case') {
                    await db.updateOrder(orderId, { status: 'Under Design' });
                }
            }



            onStatusChange(orderId, 'same'); // Triggers refresh
        } catch (error) {
            console.error('Error updating technician status:', error);
        }
    }, [orders, onStatusChange]);

    // --- Quality Assurance Logic ---

    const handleRequestRedo = useCallback(async (order: Order) => {
        if (!confirm('⚠️ هل أنت متأكد من طلب إعادة تصنيع (Redo)؟\nسيتم إنشاء أوردر جديد بسعر "صفر" للدكتور، وسيتم احتساب التكلفة بناءً على نسبة تحمل المعمل.')) return;

        // 1. Calculate Redo Cost
        let redoCost = order.cost; // Default full cost
        if (order.supplierId) {
            const suppliersList = await db.getSuppliers();
            const supplier = suppliersList.find(s => s.id === order.supplierId);
            if (supplier && supplier.redoCostPercentage !== undefined) {
                redoCost = order.cost * (supplier.redoCostPercentage / 100);
            }
        }

        // 2. Create New Order
        const newOrder: Order = {
            ...order,
            id: Math.random().toString(36).substr(2, 9),
            caseId: generateCaseId(order.caseId.split('-')[0] || 'REDO'),
            status: 'New Case',
            technicianStatus: 'Pending',
            createdAt: new Date().toISOString(),
            deliveryDate: new Date().toISOString().split('T')[0],
            actualDeliveryDate: undefined,
            feedback: undefined,
            isRedo: true,
            originalOrderId: order.id,
            totalPrice: 0,
            cost: redoCost,
            comments: []
        };

        try {
            await db.addOrder(newOrder);
            alert(`✅ تم إنشاء طلب إعادة برقم ${newOrder.caseId}`);
            onStatusChange(order.id, 'same');
        } catch (error) {
            console.error('Error creating redo order:', error);
        }
    }, [onStatusChange]);

    const handleSubmitFeedback = async () => {
        if (!feedbackOrder) return;

        try {
            await db.updateOrder(feedbackOrder.id, {
                feedback: {
                    rating: feedbackData.rating,
                    issues: feedbackData.issues,
                    rootCause: feedbackData.rootCause,
                    notes: feedbackData.notes,
                    createdAt: new Date().toISOString()
                }
            });

            setFeedbackOrder(null);
            setFeedbackData({ rating: 5, issues: [], notes: '', rootCause: 'Lab' });
            onStatusChange(feedbackOrder.id, 'same');
        } catch (error) {
            console.error('Error submitting feedback:', error);
        }
    };

    const toggleIssue = (issue: string) => {
        setFeedbackData(prev => ({
            ...prev,
            issues: prev.issues.includes(issue)
                ? prev.issues.filter(i => i !== issue)
                : [...prev.issues, issue]
        }));
    };

    return (
        <div className="space-y-4">
            {finalOrders.length === 0 ? (
                <div className="text-center py-16 bg-surface-50/50 dark:bg-surface-800/10 rounded-2xl border-2 border-dashed border-surface-200 dark:border-surface-700/50 flex flex-col items-center justify-center">
                    <div className="bg-surface-100 dark:bg-surface-700 p-4 rounded-full mb-4">
                        <Package className="h-10 w-10 text-surface-400 dark:text-surface-500" />
                    </div>
                    <h3 className="text-lg font-bold text-surface-700 dark:text-surface-200">لا توجد أوردرات حالياً</h3>
                    <p className="text-surface-500 dark:text-surface-400 mt-1 max-w-sm mx-auto">لم يتم العثور على أي طلبات تطابق معايير البحث الحالية.</p>
                </div>
            ) : (
                finalOrders.map((order) => (
                    <OrderCard
                        key={order.id}
                        order={order}
                        doctors={doctors}
                        suppliers={suppliers}
                        users={usersMap}
                        userRole={userRole}
                        onStatusChange={onStatusChange}
                        onEdit={onEdit}
                        onAddNote={onAddNote}
                        onUpdateDesignUrl={onUpdateDesignUrl}
                        onTechAction={handleTechAction}
                        onRequestRedo={handleRequestRedo}
                        onFeedback={() => setFeedbackOrder(order)}
                        hideSensitiveInfo={hideSensitiveInfo}
                        onDelete={onDelete}
                        isHighlighted={highlightedOrderId === order.id}
                        onAccept={onAccept}
                    />
                ))
            )}

            {/* Feedback Modal */}
            {feedbackOrder && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-surface-100 dark:border-gray-700 animate-in zoom-in-95">
                        <div className="bg-amber-50 dark:bg-amber-900/20 p-4 border-b border-amber-100 dark:border-amber-900/50 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-amber-800 dark:text-amber-400 flex items-center gap-2">
                                <Star className="fill-amber-500 text-amber-500" size={20} />
                                تقييم جودة الحالة ({feedbackOrder.caseId})
                            </h2>
                            <button onClick={() => setFeedbackOrder(null)} className="text-surface-400 hover:text-surface-600">✕</button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Rating Stars */}
                            <div className="flex justify-center gap-2">
                                {[1, 2, 3, 4, 5].map(star => (
                                    <button
                                        key={star}
                                        onClick={() => setFeedbackData({ ...feedbackData, rating: star })}
                                        className={clsx("transition-transform hover:scale-110 p-1", feedbackData.rating >= star ? "text-amber-400 fill-amber-400" : "text-surface-200 dark:text-gray-700")}
                                        aria-label={`Rate ${star} stars`}
                                    >
                                        <Star size={32} />
                                    </button>
                                ))}
                            </div>

                            {/* Issues Tags */}
                            <div>
                                <label className="block text-xs font-bold text-surface-600 dark:text-gray-300 mb-2">نوع المشكلة (إن وجد)</label>
                                <div className="flex flex-wrap gap-2">
                                    {['Shade (لون)', 'High Bite (عضة عالية)', 'Fitting (مقاس)', 'Material (خامة)', 'Anatomy (شكل)', 'Late (تأخير)'].map(issue => (
                                        <button
                                            key={issue}
                                            onClick={() => toggleIssue(issue)}
                                            className={clsx("px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                                                feedbackData.issues.includes(issue)
                                                    ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
                                                    : "bg-surface-50 dark:bg-gray-700 text-surface-500 dark:text-gray-400 border-surface-200 dark:border-gray-600 hover:bg-surface-100")}
                                        >
                                            {issue}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Root Cause */}
                            <div>
                                <label className="block text-xs font-bold text-surface-600 dark:text-gray-300 mb-2">السبب الرئيسي (Root Cause)</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['Lab', 'Doctor', 'Scan', 'Communication'] as const).map(cause => (
                                        <label key={cause} className={clsx("flex items-center gap-2 p-2.5 border rounded-xl cursor-pointer transition-all", feedbackData.rootCause === cause ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700" : "border-surface-200 dark:border-gray-700 hover:bg-surface-50")}>
                                            <input
                                                type="radio"
                                                name="rootCause"
                                                className="text-primary-600 focus:ring-primary-500"
                                                checked={feedbackData.rootCause === cause}
                                                onChange={() => setFeedbackData({ ...feedbackData, rootCause: cause })}
                                            />
                                            <span className="text-sm font-bold">{cause}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Details */}
                            <textarea
                                className="w-full p-3 bg-surface-50 dark:bg-gray-700 border-surface-200 dark:border-gray-600 rounded-xl text-sm h-24 outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 resize-none"
                                placeholder="أي تفاصيل إضافية..."
                                value={feedbackData.notes}
                                onChange={e => setFeedbackData({ ...feedbackData, notes: e.target.value })}
                            />

                            <button
                                onClick={handleSubmitFeedback}
                                className="w-full py-3.5 bg-amber-400 hover:bg-amber-500 text-amber-950 font-bold rounded-xl transition-all shadow-lg shadow-amber-200 dark:shadow-none hover:-translate-y-0.5"
                            >
                                حفظ التقييم
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
