import { useState, useEffect } from 'react';
import { db, type Order } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/ui/Card';
import { Star } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { ResponsiveTable } from '../../components/ui/ResponsiveTable';

export default function DoctorOrders() {
    const { user } = useAuth();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const { success } = useToast();

    // Rating Modal
    const [ratingOrder, setRatingOrder] = useState<Order | null>(null);
    const [rating, setRating] = useState(0);
    const [feedbackNotes, setFeedbackNotes] = useState('');

    useEffect(() => {
        loadOrders();
    }, [user?.entityId]);

    const loadOrders = async () => {
        if (!user?.entityId) return;
        setLoading(true);
        try {
            // Using pagination endpoint but with filters
            const { data } = await db.getOrders(1, 100, { doctorId: user.entityId });
            setOrders(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleRateSubmit = async () => {
        if (!ratingOrder) return;
        try {
            await db.updateOrder(ratingOrder.id, {
                feedback: {
                    rating,
                    issues: [], // Can implement issue selection if needed
                    notes: feedbackNotes,
                    createdAt: new Date().toISOString()
                }
            });
            success('تم إضافة التقييم بنجاح');
            setRatingOrder(null);
            loadOrders();
        } catch (e) {
            console.error(e);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Pending Review': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'Completed':
            case 'Delivered': return 'bg-green-100 text-green-800 border-green-200';
            case 'In Progress': return 'bg-blue-100 text-blue-800 border-blue-200';
            case 'Rejected': return 'bg-red-100 text-red-800 border-red-200';
            default: return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };

    const getStatusLabel = (status: string) => {
        if (status === 'Pending Review') return 'قيد المراجعة';
        return status;
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto p-4">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">أوردراتي</h1>
                <div className="text-sm text-gray-500">
                    عدد الأوردرات: <span className="font-bold text-gray-800">{orders.length}</span>
                </div>
            </div>

            <Card className="overflow-hidden border border-gray-100 shadow-sm">
                <ResponsiveTable label="جدول أوردرات الطبيب">
                    <table className="w-full min-w-[720px] text-right">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-bold">
                            <tr>
                                <th className="p-4">رقم الحالة</th>
                                <th className="p-4">المريض</th>
                                <th className="p-4">تاريخ الاستلام</th>
                                <th className="p-4">الحالة</th>
                                <th className="p-4">السعر</th>
                                <th className="p-4">التقييم</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-400">جاري التحميل...</td>
                                </tr>
                            ) : orders.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-400">لا توجد أوردرات حالياً</td>
                                </tr>
                            ) : (
                                orders.map(order => (
                                    <tr key={order.id} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="p-4 font-mono text-sm font-bold text-blue-600">
                                            {order.caseId}
                                        </td>
                                        <td className="p-4 font-bold text-gray-700">
                                            {order.patientName}
                                        </td>
                                        <td className="p-4 text-sm text-gray-600">
                                            {order.deliveryDate}
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold border ${getStatusColor(order.status)}`}>
                                                {getStatusLabel(order.status)}
                                            </span>
                                        </td>
                                        <td className="p-4 font-bold text-gray-800">
                                            {order.totalPrice > 0 ? order.totalPrice.toLocaleString() : '-'}
                                        </td>
                                        <td className="p-4">
                                            {order.feedback ? (
                                                <div className="flex text-yellow-500">
                                                    {[...Array(5)].map((_, i) => (
                                                        <Star key={i} size={14} fill={i < order.feedback!.rating ? "currentColor" : "none"} className={i < order.feedback!.rating ? "" : "text-gray-300"} />
                                                    ))}
                                                </div>
                                            ) : (order.status === 'Completed' || order.status === 'Delivered') ? (
                                                <button
                                                    onClick={() => { setRatingOrder(order); setRating(5); }}
                                                    className="text-xs bg-yellow-50 text-yellow-700 px-3 py-1 rounded-lg border border-yellow-200 hover:bg-yellow-100 transition-colors"
                                                >
                                                    إضافة تقييم
                                                </button>
                                            ) : (
                                                <span className="text-xs text-gray-400">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </ResponsiveTable>
            </Card>

            {/* Rating Modal */}
            {ratingOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-md p-6 space-y-4 animate-in zoom-in-95">
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-gray-800">تقييم الجودة</h3>
                            <p className="text-sm text-gray-500">الحالة: {ratingOrder.caseId} - {ratingOrder.patientName}</p>
                        </div>

                        <div className="flex justify-center gap-2 py-4">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    onClick={() => setRating(star)}
                                    aria-label={`Rate ${star} stars`}
                                    className="transition-transform hover:scale-110 focus:outline-none"
                                >
                                    <Star
                                        size={32}
                                        className={star <= rating ? "text-yellow-400 fill-yellow-400" : "text-gray-200 fill-gray-100"}
                                    />
                                </button>
                            ))}
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">ملاحظاتك (اختياري)</label>
                            <textarea
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-blue-500 h-24 resize-none"
                                placeholder="هل واجهت مشاكل؟ هل العمل ممتاز؟"
                                value={feedbackNotes}
                                onChange={e => setFeedbackNotes(e.target.value)}
                            />
                        </div>

                        <div className="flex gap-2 pt-2">
                            <Button variant="secondary" onClick={() => setRatingOrder(null)} className="flex-1">إلغاء</Button>
                            <Button onClick={handleRateSubmit} className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white border-none">حفظ التقييم</Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
