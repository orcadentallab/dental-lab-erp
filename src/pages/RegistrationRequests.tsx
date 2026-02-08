import { useState, useEffect } from 'react';
import {
    getPendingRequests,
    getAllRequests,
    approveRequest,
    rejectRequest,
    type RegistrationRequest
} from '../services/supabase/registrationRequests';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
    UserPlus,
    CheckCircle,
    XCircle,
    Clock,
    Phone,
    Mail,
    MapPin,
    Building2,
    Loader2,
    Filter,
    RefreshCw
} from 'lucide-react';

export default function RegistrationRequests() {
    const { user } = useAuth();
    const { success: toastSuccess, error: toastError } = useToast();

    const [requests, setRequests] = useState<RegistrationRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'pending' | 'all'>('pending');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectNotes, setRejectNotes] = useState('');

    useEffect(() => {
        loadRequests();
    }, [filter]);

    const loadRequests = async () => {
        setLoading(true);
        try {
            const data = filter === 'pending'
                ? await getPendingRequests()
                : await getAllRequests();
            setRequests(data);
        } catch (err) {
            console.error(err);
            toastError('حدث خطأ أثناء جلب الطلبات');
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (request: RegistrationRequest) => {
        if (!user) return;

        setProcessingId(request.id);
        try {
            await approveRequest(request.id, user.id);
            toastSuccess(`تم قبول طلب ${request.name} وإنشاء الحساب بنجاح`);
            loadRequests();
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'حدث خطأ');
        } finally {
            setProcessingId(null);
        }
    };

    const handleReject = async (requestId: string) => {
        if (!user) return;

        setProcessingId(requestId);
        try {
            await rejectRequest(requestId, user.id, rejectNotes);
            toastSuccess('تم رفض الطلب');
            setRejectingId(null);
            setRejectNotes('');
            loadRequests();
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'حدث خطأ');
        } finally {
            setProcessingId(null);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'pending': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
            case 'approved': return 'bg-green-100 text-green-700 border-green-200';
            case 'rejected': return 'bg-red-100 text-red-700 border-red-200';
            default: return 'bg-gray-100 text-gray-700 border-gray-200';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'pending': return 'في الانتظار';
            case 'approved': return 'تم القبول';
            case 'rejected': return 'مرفوض';
            default: return status;
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('ar-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const pendingCount = requests.filter(r => r.status === 'pending').length;

    return (
        <div className="space-y-6 max-w-6xl mx-auto p-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <UserPlus size={20} className="text-white" />
                        </div>
                        طلبات تسجيل الأطباء
                    </h1>
                    <p className="text-gray-500 mt-1">إدارة طلبات التسجيل الجديدة</p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Filter */}
                    <div className="flex bg-gray-100 rounded-lg p-1">
                        <button
                            onClick={() => setFilter('pending')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${filter === 'pending'
                                    ? 'bg-white text-blue-600 shadow'
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <Clock size={16} />
                            في الانتظار
                            {pendingCount > 0 && (
                                <span className="bg-yellow-500 text-white px-2 py-0.5 rounded-full text-xs">
                                    {pendingCount}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${filter === 'all'
                                    ? 'bg-white text-blue-600 shadow'
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <Filter size={16} />
                            الكل
                        </button>
                    </div>

                    {/* Refresh */}
                    <Button
                        variant="secondary"
                        onClick={loadRequests}
                        disabled={loading}
                        className="!p-3"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </Button>
                </div>
            </div>

            {/* Requests List */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={32} className="animate-spin text-blue-500" />
                </div>
            ) : requests.length === 0 ? (
                <Card className="p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <UserPlus size={32} className="text-gray-400" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-700 mb-2">
                        لا توجد طلبات {filter === 'pending' ? 'معلقة' : ''}
                    </h3>
                    <p className="text-gray-500">
                        ستظهر طلبات التسجيل الجديدة هنا
                    </p>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {requests.map(request => (
                        <Card key={request.id} className="p-6 hover:shadow-lg transition-shadow">
                            <div className="flex flex-col lg:flex-row gap-4">
                                {/* Info */}
                                <div className="flex-1 space-y-3">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-800">
                                                {request.name}
                                            </h3>
                                            {request.clinicName && (
                                                <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                                                    <Building2 size={14} />
                                                    {request.clinicName}
                                                </p>
                                            )}
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusColor(request.status)}`}>
                                            {getStatusLabel(request.status)}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <Phone size={16} className="text-blue-500" />
                                            <span className="font-mono ltr">{request.phone}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <Mail size={16} className="text-blue-500" />
                                            <span className="truncate">{request.email}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <MapPin size={16} className="text-blue-500" />
                                            <span className="truncate">{request.address}</span>
                                        </div>
                                    </div>

                                    <p className="text-xs text-gray-400">
                                        تم التقديم: {formatDate(request.createdAt)}
                                    </p>
                                </div>

                                {/* Actions */}
                                {request.status === 'pending' && (
                                    <div className="flex lg:flex-col gap-2 lg:w-40">
                                        <Button
                                            onClick={() => handleApprove(request)}
                                            disabled={processingId === request.id}
                                            className="flex-1 bg-green-500 hover:bg-green-600 text-white gap-2"
                                        >
                                            {processingId === request.id ? (
                                                <Loader2 size={18} className="animate-spin" />
                                            ) : (
                                                <CheckCircle size={18} />
                                            )}
                                            قبول
                                        </Button>
                                        <Button
                                            onClick={() => setRejectingId(request.id)}
                                            variant="secondary"
                                            className="flex-1 text-red-600 hover:bg-red-50 gap-2"
                                        >
                                            <XCircle size={18} />
                                            رفض
                                        </Button>
                                    </div>
                                )}
                            </div>

                            {/* Reject Dialog */}
                            {rejectingId === request.id && (
                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        سبب الرفض (اختياري)
                                    </label>
                                    <textarea
                                        value={rejectNotes}
                                        onChange={e => setRejectNotes(e.target.value)}
                                        placeholder="أدخل سبب الرفض..."
                                        rows={2}
                                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg resize-none outline-none focus:border-red-500"
                                    />
                                    <div className="flex gap-2 mt-3">
                                        <Button
                                            onClick={() => handleReject(request.id)}
                                            disabled={processingId === request.id}
                                            className="bg-red-500 hover:bg-red-600 text-white"
                                        >
                                            {processingId === request.id ? (
                                                <Loader2 size={18} className="animate-spin" />
                                            ) : (
                                                'تأكيد الرفض'
                                            )}
                                        </Button>
                                        <Button
                                            onClick={() => { setRejectingId(null); setRejectNotes(''); }}
                                            variant="secondary"
                                        >
                                            إلغاء
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
