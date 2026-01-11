import { useState, useEffect } from 'react';
import { Package, Star } from 'lucide-react';
import type { Order } from '../../services/db';
import { db } from '../../services/db';
import clsx from 'clsx';
import { generateCaseId } from '../../utils/caseId';
import OrderCard from './OrderCard';

interface OrderListProps {
    orders: Order[];
    onStatusChange: (id: string, status: string) => void;
    userRole?: string;
    userId?: string;
    onEdit?: (order: Order) => void; // Full Edit (Admin)
    onAddNote?: (order: Order) => void; // Add Note (Everyone)
}

export default function OrderList({ orders = [], onStatusChange, userRole, onEdit, onAddNote }: OrderListProps) {
    const [doctors, setDoctors] = useState<Record<string, string>>({});
    const [suppliers, setSuppliers] = useState<Record<string, string>>({});

    // Feedback Modal State
    const [feedbackOrder, setFeedbackOrder] = useState<Order | null>(null);
    const [feedbackData, setFeedbackData] = useState({ rating: 5, issues: [] as string[], notes: '', rootCause: 'Lab' });

    // Filter/Privacy Logic
    const hideSensitiveInfo = userRole === 'lab';

    // Use passed orders directly (Parent handles RBAC filtering)
    const filteredOrders = orders || [];

    useEffect(() => {
        const loadAuxData = async () => {
            try {
                const [docs, sups] = await Promise.all([
                    db.getDoctors(),
                    Promise.resolve(db.getSuppliers()) // Still sync
                ]);

                const mapD: Record<string, string> = {};
                docs.forEach(d => mapD[d.id] = d.name);
                setDoctors(mapD);

                const mapS: Record<string, string> = {};
                sups.forEach(s => mapS[s.id] = s.name);
                setSuppliers(mapS);
            } catch (error) {
                console.error('Error loading auxiliary data:', error);
            }
        };
        loadAuxData();
    }, []);

    // Helper functions moved to utils/orderUtils.tsx
    // checkIsLate imported from utils/orderUtils.tsx



    const handleTechAction = async (orderId: string, action: 'Approved' | 'Rejected' | 'NeedDetails' | 'PMMA_First') => {
        try {
            await db.updateOrder(orderId, { technicianStatus: action });
            onStatusChange(orderId, 'same'); // Triggers refresh
        } catch (error) {
            console.error('Error updating technician status:', error);
        }
    };

    // --- Quality Assurance Logic ---
    const handleRegister = async (id: string) => {
        try {
            await db.updateOrder(id, { isRegistered: true });
            onStatusChange(id, 'same');
        } catch (error) {
            console.error('Error registering order:', error);
        }
    };

    const handleRequestRedo = async (order: Order) => {
        if (!confirm('⚠️ هل أنت متأكد من طلب إعادة تصنيع (Redo)؟\nسيتم إنشاء أوردر جديد بسعر "صفر" للدكتور، وسيتم احتساب التكلفة بناءً على نسبة تحمل المعمل.')) return;

        // 1. Calculate Redo Cost
        let redoCost = order.cost; // Default full cost
        if (order.supplierId) {
            const suppliersList = await db.getSuppliers();
            const supplier = suppliersList.find(s => s.id === order.supplierId);
            if (supplier && supplier.redoCostPercentage !== undefined) {
                // If redoCostPercentage is 25, we pay 25%. Meaning cost is 25% of original.
                // Wait, logic check: "Percentage of cost covered by us"
                // If 25%, we pay 25%.
                redoCost = order.cost * (supplier.redoCostPercentage / 100);
            }
        }

        // 2. Create New Order
        const newOrder: Order = {
            ...order,
            id: Math.random().toString(36).substr(2, 9),
            caseId: generateCaseId(order.caseId.split('-')[0] || 'REDO'), // Simplified ID gen
            status: 'New Case',
            technicianStatus: 'Pending',
            createdAt: new Date().toISOString(),
            deliveryDate: new Date().toISOString().split('T')[0], // Reset Date to Today (needs update)
            actualDeliveryDate: undefined,
            feedback: undefined,
            isRedo: true,
            originalOrderId: order.id,
            totalPrice: 0, // FREE for Doctor (Warranty)
            cost: redoCost,
            comments: []
        };

        try {
            await db.addOrder(newOrder);
            alert(`✅ تم إنشاء طلب إعادة برقم ${newOrder.caseId}`);
            onStatusChange(order.id, 'same'); // Refresh
        } catch (error) {
            console.error('Error creating redo order:', error);
        }
    };

    const handleSubmitFeedback = async () => {
        if (!feedbackOrder) return;

        try {
            await db.updateOrder(feedbackOrder.id, {
                feedback: {
                    rating: feedbackData.rating,
                    issues: feedbackData.issues,
                    rootCause: feedbackData.rootCause as any,
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
        <div className="space-y-3">
            {filteredOrders.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                    <Package className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" />
                    <p className="text-gray-500 dark:text-gray-400">لا توجد أوردرات حالياً</p>
                </div>
            ) : (
                filteredOrders.map((order) => (
                    <OrderCard
                        key={order.id}
                        order={order}
                        doctors={doctors}
                        suppliers={suppliers}
                        userRole={userRole}
                        onStatusChange={onStatusChange}
                        onEdit={onEdit}
                        onAddNote={onAddNote}
                        onTechAction={handleTechAction}
                        onRequestRedo={handleRequestRedo}
                        onFeedback={() => setFeedbackOrder(order)}
                        onRegister={handleRegister}
                        hideSensitiveInfo={hideSensitiveInfo}
                    />
                ))
            )}

            {/* Feedback Modal */}
            {feedbackOrder && (
                <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-gray-100 dark:border-gray-700">
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 border-b border-yellow-100 dark:border-yellow-900/50 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-yellow-800 dark:text-yellow-400 flex items-center gap-2">
                                <Star className="fill-yellow-500 text-yellow-500" size={20} />
                                تقييم جودة الحالة ({feedbackOrder.caseId})
                            </h2>
                            <button onClick={() => setFeedbackOrder(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Rating Stars */}
                            <div className="flex justify-center gap-2">
                                {[1, 2, 3, 4, 5].map(star => (
                                    <button
                                        key={star}
                                        onClick={() => setFeedbackData({ ...feedbackData, rating: star })}
                                        className={clsx("transition-transform hover:scale-110", feedbackData.rating >= star ? "text-yellow-400 fill-yellow-400" : "text-gray-200 dark:text-gray-700")}
                                    >
                                        <Star size={32} />
                                    </button>
                                ))}
                            </div>

                            {/* Issues Tags */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">نوع المشكلة (إن وجد)</label>
                                <div className="flex flex-wrap gap-2">
                                    {['Shade (لون)', 'High Bite (عضة عالية)', 'Fitting (مقاس)', 'Material (خامة)', 'Anatomy (شكل)', 'Late (تأخير)'].map(issue => (
                                        <button
                                            key={issue}
                                            onClick={() => toggleIssue(issue)}
                                            className={clsx("px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
                                                feedbackData.issues.includes(issue)
                                                    ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
                                                    : "bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600")}
                                        >
                                            {issue}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Root Cause */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">السبب الرئيسي (Root Cause)</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {['Lab', 'Doctor', 'Scan', 'Communication'].map(cause => (
                                        <label key={cause} className={clsx("flex items-center gap-2 p-2 border rounded-lg cursor-pointer transition-all", feedbackData.rootCause === cause ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700")}>
                                            <input
                                                type="radio"
                                                name="rootCause"
                                                className="text-blue-600"
                                                checked={feedbackData.rootCause === cause}
                                                onChange={() => setFeedbackData({ ...feedbackData, rootCause: cause })}
                                            />
                                            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{cause}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Details */}
                            <textarea
                                className="w-full p-3 bg-gray-50 dark:bg-gray-700 border-gray-100 dark:border-gray-600 rounded-xl text-sm h-20 outline-none focus:ring-1 focus:ring-yellow-400 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                                placeholder="أي تفاصيل إضافية..."
                                value={feedbackData.notes}
                                onChange={e => setFeedbackData({ ...feedbackData, notes: e.target.value })}
                            />

                            <button
                                onClick={handleSubmitFeedback}
                                className="w-full py-3 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold rounded-xl transition-colors shadow-lg shadow-yellow-100 dark:shadow-none"
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
