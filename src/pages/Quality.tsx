import { useState, useEffect } from 'react';
import { db, type Order, type Supplier, type Doctor } from '../services/db';
import { AlertCircle, Clock, Star, CheckCircle, Building2 } from 'lucide-react';

export default function QualityDashboard() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const [ordersData, suppliersData, doctorsData] = await Promise.all([
                    db.getOrders(),
                    db.getSuppliers(),
                    db.getDoctors()
                ]);
                setOrders(ordersData);
                setSuppliers(suppliersData);
                setDoctors(doctorsData);
            } catch (error) {
                console.error('Error loading quality data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    // --- Metrics Calculations ---
    const completedOrders = orders.filter(o => o.status === 'Delivered' || o.status === 'Completed');

    // 1. On-Time Delivery Rate
    const lateOrders = completedOrders.filter(o => {
        if (!o.deliveryDate || !o.actualDeliveryDate) return false;
        return o.actualDeliveryDate > o.deliveryDate;
    });
    const onTimeRate = completedOrders.length > 0
        ? Math.round(((completedOrders.length - lateOrders.length) / completedOrders.length) * 100)
        : 100;

    // 2. Feedback Stats
    const ratedOrders = completedOrders.filter(o => o.feedback);
    const avgRating = ratedOrders.length > 0
        ? (ratedOrders.reduce((sum, o) => sum + o.feedback!.rating, 0) / ratedOrders.length).toFixed(1)
        : '---';

    // 3. Redo Rate
    const redoOrders = orders.filter(o => o.isRedo);
    const redoRate = orders.length > 0
        ? ((redoOrders.length / orders.length) * 100).toFixed(1)
        : '0';

    // 4. Supplier Performance
    const supplierStats = suppliers.map(sup => {
        const supOrders = completedOrders.filter(o => o.supplierId === sup.id);
        const supRated = supOrders.filter(o => o.feedback);
        const supAvg = supRated.length > 0
            ? (supRated.reduce((sum, o) => sum + o.feedback!.rating, 0) / supRated.length)
            : 0;
        const supLate = supOrders.filter(o => o.actualDeliveryDate && o.actualDeliveryDate > o.deliveryDate).length;

        return {
            id: sup.id,
            name: sup.name,
            total: supOrders.length,
            rating: supAvg,
            lateCount: supLate,
            lateRate: supOrders.length > 0 ? (supLate / supOrders.length) * 100 : 0
        };
    });

    // 5. Issues Breakdown
    const issuesMap: Record<string, number> = {};
    ratedOrders.forEach(o => {
        o.feedback!.issues.forEach(issue => {
            issuesMap[issue] = (issuesMap[issue] || 0) + 1;
        });
    });
    const issuesData = Object.entries(issuesMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);


    // 6. Pending Feedback
    const pendingFeedback = orders.filter(o => o.status === 'Delivered' && !o.feedback);

    // Modal State
    const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [feedbackData, setFeedbackData] = useState({
        rating: 5,
        issues: [] as string[],
        rootCause: 'Lab',
        notes: ''
    });

    const handleOpenFeedback = (order: Order) => {
        setSelectedOrder(order);
        setFeedbackData({ rating: 5, issues: [], rootCause: 'Lab', notes: '' });
        setFeedbackModalOpen(true);
    };

    const toggleIssue = (issue: string) => {
        setFeedbackData(prev => ({
            ...prev,
            issues: prev.issues.includes(issue)
                ? prev.issues.filter(i => i !== issue)
                : [...prev.issues, issue]
        }));
    };

    const handleSubmitFeedback = async () => {
        if (!selectedOrder) return;

        const feedback = {
            rating: feedbackData.rating,
            issues: feedbackData.issues,
            rootCause: feedbackData.rootCause as any,
            notes: feedbackData.notes,
            createdAt: new Date().toISOString()
        };

        try {
            await db.updateOrder(selectedOrder.id, { feedback }); // Sync update
            // Refresh to get latest state or just update local
            const updatedOrders = await db.getOrders();
            setOrders(updatedOrders);
            setFeedbackModalOpen(false);
        } catch (error) {
            console.error('Error saving feedback:', error);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">لوحة ضمان الجودة (Quality Assurance)</h1>
                <p className="text-gray-500">متابعة دقيقة لمؤشرات الأداء ورضا العملاء</p>
                {isLoading && <div className="text-sm text-blue-600 animate-pulse mt-2">جاري تحديث البيانات...</div>}
            </div>

            {/* Pending Feedback Section */}
            {pendingFeedback.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 relative overflow-hidden mb-6">
                    <div className="absolute top-0 left-0 w-2 h-full bg-orange-400"></div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold text-orange-800 flex items-center gap-2">
                            <Star className="fill-orange-500 text-orange-500" size={24} />
                            حالات بانتظار التقييم ({pendingFeedback.length})
                        </h2>
                        <span className="text-sm text-orange-600 bg-orange-100 px-3 py-1 rounded-full font-medium">يرجى تقييمها لضمان الجودة</span>
                    </div>

                    <div className="grid gap-3">
                        {pendingFeedback.map(order => (
                            <div key={order.id} className="bg-white p-4 rounded-xl shadow-sm flex flex-col md:flex-row justify-between items-center gap-4 border border-orange-100">
                                <div className="flex items-center gap-4 w-full md:w-auto">
                                    <div className="bg-gray-100 p-2 rounded-lg font-mono text-gray-600 font-bold">#{order.caseId}</div>
                                    <div>
                                        <div className="font-bold text-gray-900">{order.patientName}</div>
                                        <div className="text-xs text-gray-500">{(doctors.find(d => d.id === order.doctorId)?.name || 'Unknown')} • {order.items.map(i => i.serviceType).join(', ')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                                    <div className="text-xs text-gray-500">
                                        تم التسليم: <span dir="ltr">{order.deliveryDate}</span>
                                    </div>
                                    <button
                                        onClick={() => handleOpenFeedback(order)}
                                        className="bg-orange-500 text-white px-6 py-2 rounded-lg font-bold hover:bg-orange-600 shadow-sm shadow-orange-200 transition-all active:scale-95"
                                    >
                                        تقييم الآن
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-green-100 rounded-lg text-green-600">
                            <Clock size={24} />
                        </div>
                        {onTimeRate < 90 && <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded">يحتاج تحسين</span>}
                    </div>
                    <div className="text-3xl font-bold text-gray-900 mb-1">{onTimeRate}%</div>
                    <div className="text-sm text-gray-500">التزام بالمواعيد (On-Time)</div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-yellow-100 rounded-lg text-yellow-600">
                            <Star size={24} />
                        </div>
                    </div>
                    <div className="text-3xl font-bold text-gray-900 mb-1">{avgRating} <span className="text-lg text-gray-400 font-normal">/ 5.0</span></div>
                    <div className="text-sm text-gray-500">متوسط تقييم الجودة</div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-red-100 rounded-lg text-red-600">
                            <AlertCircle size={24} />
                        </div>
                    </div>
                    <div className="text-3xl font-bold text-gray-900 mb-1">{redoRate}%</div>
                    <div className="text-sm text-gray-500">نسبة إعادة التصنيع (Redo Rate)</div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                            <CheckCircle size={24} />
                        </div>
                    </div>
                    <div className="text-3xl font-bold text-gray-900 mb-1">{completedOrders.length}</div>
                    <div className="text-sm text-gray-500">إجمالي الحالات المسلمة</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Supplier Performance Table */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <Building2 size={20} className="text-gray-400" />
                        أداء المعامل (Suppliers)
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-right">
                            <thead>
                                <tr className="text-xs text-gray-500 border-b border-gray-100">
                                    <th className="pb-2 font-medium">المعمل</th>
                                    <th className="pb-2 font-medium">الحالات</th>
                                    <th className="pb-2 font-medium">التقييم</th>
                                    <th className="pb-2 font-medium text-red-500">نسبة التأخير</th>
                                </tr>
                            </thead>
                            <tbody className="text-sm">
                                {supplierStats.length > 0 ? supplierStats.map(sup => (
                                    <tr key={sup.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                                        <td className="py-3 font-bold text-gray-800">{sup.name}</td>
                                        <td className="py-3 text-gray-600 font-mono">{sup.total}</td>
                                        <td className="py-3">
                                            {sup.rating > 0 ? (
                                                <div className="flex items-center gap-1 text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded w-fit text-xs font-bold">
                                                    <Star size={10} fill="currentColor" />
                                                    {sup.rating.toFixed(1)}
                                                </div>
                                            ) : <span className="text-gray-300">-</span>}
                                        </td>
                                        <td className="py-3">
                                            {sup.lateRate > 0 ? (
                                                <span className="text-red-600 font-bold">{sup.lateRate.toFixed(0)}%</span>
                                            ) : <span className="text-green-500 text-xs">0% (ممتاز)</span>}
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={4} className="py-8 text-center text-gray-400 text-sm">لا توجد بيانات للمعامل</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Issues Breakdown */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <AlertCircle size={20} className="text-red-400" />
                        أكثر المشاكل تكراراً
                    </h3>
                    <div className="space-y-4">
                        {issuesData.length > 0 ? issuesData.map((item, idx) => (
                            <div key={idx}>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="font-bold text-gray-700">{item.name}</span>
                                    <span className="text-gray-500 font-mono">{item.count} حالة</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-red-400 rounded-full"
                                        style={{ width: `${(item.count / ratedOrders.length) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        )) : (
                            <div className="text-center py-12 text-gray-400">
                                <CheckCircle size={48} className="mx-auto text-green-100 mb-2" />
                                <p>لا توجد شكاوى مسجلة حتى الآن!</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Recent Feedback Log */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <h3 className="text-lg font-bold text-gray-800 mb-4">أحدث التقييمات المسجلة</h3>
                <div className="space-y-3">
                    {ratedOrders.slice(0, 5).map(order => (
                        <div key={order.id} className="p-3 border rounded-xl flex justify-between items-start hover:bg-gray-50 transition-colors">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">#{order.caseId}</span>
                                    <span className="font-bold text-gray-800 text-sm">{order.patientName}</span>
                                </div>
                                {order.feedback?.notes && (
                                    <p className="text-sm text-gray-600 italic">"{order.feedback.notes}"</p>
                                )}
                                <div className="flex gap-2">
                                    {order.feedback?.issues.map(issue => (
                                        <span key={issue} className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-100">{issue}</span>
                                    ))}
                                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Cause: {order.feedback?.rootCause}</span>
                                </div>
                            </div>

                            <div className="flex flex-col items-end gap-1">
                                <div className="flex gap-0.5">
                                    {[...Array(5)].map((_, i) => (
                                        <Star key={i} size={12} className={i < (order.feedback?.rating || 0) ? "fill-yellow-400 text-yellow-400" : "text-gray-200"} />
                                    ))}
                                </div>
                                <span className="text-[10px] text-gray-400">{new Date(order.feedback!.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                    ))}
                    {ratedOrders.length === 0 && (
                        <p className="text-center text-gray-400 text-sm py-4">لا توجد تقييمات</p>
                    )}
                </div>
            </div>
            {/* Feedback Modal */}
            {feedbackModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6">
                            <h3 className="text-xl font-bold text-center text-gray-900 mb-6">تقييم جودة الحالة</h3>

                            {/* Star Rating */}
                            <div className="flex justify-center gap-2 mb-8">
                                {[1, 2, 3, 4, 5].map(star => (
                                    <button
                                        key={star}
                                        onClick={() => setFeedbackData(p => ({ ...p, rating: star }))}
                                        className="transition-transform hover:scale-110 active:scale-90"
                                    >
                                        <Star
                                            size={32}
                                            className={star <= feedbackData.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-200"}
                                        />
                                    </button>
                                ))}
                            </div>

                            {/* Issues (Only if rating < 5) */}
                            {feedbackData.rating < 5 && (
                                <div className="space-y-4 mb-6">
                                    <p className="text-sm font-bold text-gray-700">ما هي المشكلة؟</p>
                                    <div className="flex flex-wrap gap-2">
                                        {['Shade', 'Fitting', 'Contact', 'Anatomy', 'High Bite', 'Margin', 'Material'].map(issue => (
                                            <button
                                                key={issue}
                                                onClick={() => toggleIssue(issue)}
                                                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${feedbackData.issues.includes(issue)
                                                    ? 'bg-red-50 border-red-200 text-red-600'
                                                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                                                    }`}
                                            >
                                                {issue}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 mt-4">
                                        {['Lab', 'Doctor', 'Scan', 'Communication'].map(cause => (
                                            <button
                                                key={cause}
                                                onClick={() => setFeedbackData(p => ({ ...p, rootCause: cause as any }))}
                                                className={`py-2 text-xs font-bold rounded-lg border text-center ${feedbackData.rootCause === cause
                                                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                                                    : 'bg-white border-gray-100 text-gray-400'
                                                    }`}
                                            >
                                                {cause}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Notes */}
                            <textarea
                                className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm mb-6 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                                rows={3}
                                placeholder="ملاحظات إضافية..."
                                value={feedbackData.notes}
                                onChange={e => setFeedbackData(p => ({ ...p, notes: e.target.value }))}
                            ></textarea>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setFeedbackModalOpen(false)}
                                    className="flex-1 py-3 text-gray-600 font-bold hover:bg-gray-50 rounded-xl"
                                >
                                    إلغاء
                                </button>
                                <button
                                    onClick={handleSubmitFeedback}
                                    className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200"
                                >
                                    حفظ التقييم
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
