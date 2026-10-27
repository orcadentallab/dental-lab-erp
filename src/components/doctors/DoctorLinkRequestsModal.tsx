import { useState, useEffect, useCallback } from 'react';
import { doctorAuthService } from '../../services/auth/doctorAuthService';
import { doctorManualAccessService } from '../../services/auth/doctorManualAccessService';
import { doctorPasswordService } from '../../services/auth/doctorPasswordService';
import { DOCTOR_CODE_REGIONS } from '../../lib/doctorIdentity';
import { PHONE_OWNER_ROLES } from '../../lib/doctorContacts';
import type { DoctorLinkRequestItem } from '../../services/auth/types';
import type { Doctor } from '../../services/db';
import { Check, X, Phone, UserCheck, Clock, ShieldCheck, RefreshCw } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

interface DoctorLinkRequestsModalProps {
    isOpen: boolean;
    onClose: () => void;
    doctors: Doctor[];
    onRequestHandled: () => void;
}

export default function DoctorLinkRequestsModal({
    isOpen,
    onClose,
    doctors,
    onRequestHandled
}: DoctorLinkRequestsModalProps) {
    const { success, error: toastError } = useToast();
    const [requests, setRequests] = useState<DoctorLinkRequestItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [selectedDoctorMap, setSelectedDoctorMap] = useState<Record<string, string>>({});
    const [approveAddressMap, setApproveAddressMap] = useState<Record<string, boolean>>({});

    const loadRequests = useCallback(async () => {
        setLoading(true);
        try {
            const data = await doctorAuthService.getPendingDoctorLinkRequests();
            setRequests(data);
            // Pre-select doctor if matched in request
            const initialMap: Record<string, string> = {};
            data.forEach(r => {
                if (r.manual_access && r.request_type === 'new_doctor') {
                    initialMap[r.id] = '__new__';
                    return;
                }
                if (r.matched_doctor_ids && r.matched_doctor_ids.length === 1) {
                    initialMap[r.id] = r.matched_doctor_ids[0];
                } else if (r.claimed_doctor_code) {
                    const found = doctors.find(d =>
                        d.doctorCode?.toLowerCase() === r.claimed_doctor_code?.toLowerCase()
                    );
                    if (found) initialMap[r.id] = found.id;
                }
            });
            setSelectedDoctorMap(initialMap);
            setApproveAddressMap({});
        } catch (err: unknown) {
            console.error('Failed to load pending doctor link requests:', err);
            toastError('حدث خطأ أثناء تحميل طلبات ربط الأطباء');
        } finally {
            setLoading(false);
        }
    }, [doctors, toastError]);

    useEffect(() => {
        if (isOpen) {
            void Promise.resolve().then(loadRequests);
        }
    }, [isOpen, loadRequests]);

    if (!isOpen) return null;

    const handleApprove = async (requestId: string) => {
        const doctorId = selectedDoctorMap[requestId];
        const request = requests.find(item => item.id === requestId);
        if (!doctorId && !request?.address_update) {
            toastError('يرجى تحديد الطبيب المراد ربطه بالرقم أولاً');
            return;
        }

        setActionLoading(requestId);
        try {
            const res = request?.address_update ? await doctorPasswordService.reviewAddress(requestId, true) : request?.password_registration
                ? await doctorPasswordService.review(requestId, true, doctorId, approveAddressMap[requestId] || false)
                : request?.manual_access
                ? await doctorManualAccessService.review(requestId, true, doctorId === '__new__' ? undefined : doctorId)
                : await doctorAuthService.approveDoctorLinkRequest(requestId, doctorId);
            if (res.success) {
                success(request?.address_update ? 'تم اعتماد تعديل العنوان' : 'تم اعتماد طلب الربط بنجاح وتم تفعيل حساب الطبيب');
                await loadRequests();
                onRequestHandled();
            } else {
                toastError(res.message);
            }
        } catch (err: unknown) {
            console.error(err);
            toastError(err instanceof Error ? err.message : 'فشل اعتماد الطلب');
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async (requestId: string) => {
        const notes = window.prompt('سبب الرفض (اختياري):');
        if (notes === null) return; // cancelled

        setActionLoading(requestId);
        try {
            const request = requests.find(item => item.id === requestId);
            const res = request?.address_update ? await doctorPasswordService.reviewAddress(requestId, false) : request?.password_registration
                ? await doctorPasswordService.review(requestId, false)
                : request?.manual_access
                ? await doctorManualAccessService.review(requestId, false)
                : await doctorAuthService.rejectDoctorLinkRequest(requestId, notes);
            if (res.success) {
                success('تم رفض طلب الربط');
                await loadRequests();
                onRequestHandled();
            } else {
                toastError(res.message);
            }
        } catch (err: unknown) {
            console.error(err);
            toastError(err instanceof Error ? err.message : 'فشل رفض الطلب');
        } finally {
            setActionLoading(null);
        }
    };

    const getReasonLabel = (reqType: DoctorLinkRequestItem['request_type']) => {
        switch (reqType) {
            case 'multi_match':
                return 'الرقم مسجل لأكثر من طبيب';
            case 'center_shared':
                return 'طبيب يتبع مركز / عيادة متعددة';
            case 'code_claim':
                return 'مطالبة بكود طبيب (رقم جديد)';
            case 'new_doctor':
                return 'تسجيل طبيب جديد';
            default:
                return reqType;
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150" dir="rtl">
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center font-bold">
                            <ShieldCheck size={22} />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                                طلبات ربط الأطباء وتعديل العناوين
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                راجع هوية مقدم الطلب قبل فتح الحساب؛ رقم الهاتف في التسجيل بدون كود غير متحقق منه
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-2xl font-bold w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        &times;
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto py-4 space-y-4">
                    {loading ? (
                        <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                            <RefreshCw size={24} className="animate-spin text-blue-500" />
                            <span className="text-xs">جاري تحميل الطلبات...</span>
                        </div>
                    ) : requests.length === 0 ? (
                        <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                            <UserCheck size={36} className="text-emerald-500 stroke-[1.5]" />
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">لا توجد طلبات ربط معلقة حالياً</p>
                            <p className="text-xs text-slate-400">جميع طلبات أرقام الأطباء معتمدة ومربوطة بنجاح.</p>
                        </div>
                    ) : (
                        requests.map((req) => {
                            const currentSelectedDoctor = selectedDoctorMap[req.id] || '';

                            return (
                                <div
                                    key={req.id}
                                    data-testid={`doctor-link-request-${req.id}`}
                                    className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center"
                                >
                                    <div className="space-y-1.5 flex-1">
                                        {req.manual_access && <p className="text-xs font-bold text-amber-700">تسجيل بدون كود — تحقق من هوية الطبيب بالتواصل معه قبل الاعتماد</p>}
                                        {req.password_registration && <p className="text-xs font-bold text-amber-700">حساب بكلمة مرور — راجع هوية الطبيب قبل ربط السجل القديم</p>}
                                        {req.password_registration && req.account_email && <p className="text-xs" dir="ltr">{req.account_email}</p>}
                                        {(req.address_update || req.password_registration || (req.manual_access && req.request_type === 'new_doctor')) && req.profile && <div className="text-sm space-y-1">
                                            <p className="font-bold">{req.profile.name}</p>
                                            <p>{req.profile.address}</p>
                                            <p>{DOCTOR_CODE_REGIONS.find(region => region.value === req.profile?.code_region)?.label}</p>
                                            {req.profile.is_center && <p>مركز طبي</p>}
                                            {req.profile.branches?.map((branch, index) => <p key={index}>الفرع: {branch.name} — {branch.address} — {branch.phone} — {PHONE_OWNER_ROLES.find(role => role.value === branch.phoneOwnerRole)?.label || 'الطبيب'} {branch.phoneOwnerName} — {branch.phoneHasWhatsapp ? 'واتساب' : 'بدون واتساب'}</p>)}
                                            {req.profile.doctors?.map((doctor, index) => <p key={index}>طبيب المركز: {doctor.name} {doctor.phone}</p>)}
                                            {req.profile.contact_phones?.map((contact, index) => <p key={index}>{contact.phone} — {PHONE_OWNER_ROLES.find(role => role.value === contact.ownerRole)?.label} {contact.ownerName} — {contact.hasWhatsapp ? 'واتساب' : 'بدون واتساب'}</p>)}
                                            {req.profile.address_change_requested && <div className="border border-amber-200 rounded-xl p-3 space-y-2"><p className="font-bold">طلب تعديل العنوان</p><p>العنوان المطلوب: {req.profile.requested_address}</p>{!req.address_update && <label className="flex gap-2"><input type="checkbox" checked={approveAddressMap[req.id] || false} onChange={event => setApproveAddressMap({ ...approveAddressMap, [req.id]: event.target.checked })} />اعتماد تعديل العنوان مع الربط</label>}</div>}
                                        </div>}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="inline-flex items-center gap-1 font-mono font-bold text-sm bg-white dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white" dir="ltr">
                                                <Phone size={13} className="text-emerald-500" />
                                                <span>{req.phone}</span>
                                            </span>
                                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                                                {getReasonLabel(req.request_type)}
                                            </span>
                                            {req.claimed_doctor_code && (
                                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40">
                                                    كود مطلوب: {req.claimed_doctor_code}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                                            <span className="flex items-center gap-1">
                                                <Clock size={12} />
                                                <span>{new Date(req.created_at).toLocaleString('ar-EG')}</span>
                                            </span>
                                        </div>

                                        {/* Target Doctor Selector */}
                                        {!req.address_update && <div className="pt-2">
                                            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                ربط بالحساب التالي:
                                            </label>
                                            <select
                                                value={currentSelectedDoctor}
                                                onChange={(e) => {
                                                    setSelectedDoctorMap({
                                                        ...selectedDoctorMap,
                                                        [req.id]: e.target.value
                                                    });
                                                }}
                                                className="w-full text-xs font-bold p-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-white"
                                            >
                                                <option value="" disabled>-- اختر الطبيب للاعتماد --</option>
                                                {req.manual_access && req.request_type === 'new_doctor' && <option value="__new__">إنشاء طبيب / مركز جديد بالبيانات المقدمة</option>}
                                                {doctors.map((d) => (
                                                    <option key={d.id} value={d.id}>
                                                        {d.name} ({d.doctorCode || 'بدون كود'}) {d.phone ? `- ${d.phone}` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                                        <button
                                            type="button"
                                            disabled={actionLoading !== null || (!currentSelectedDoctor && !req.address_update)}
                                            onClick={() => handleApprove(req.id)}
                                            className="px-3.5 py-2 bg-emerald-600 text-white font-bold text-xs rounded-xl hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
                                        >
                                            <Check size={15} />
                                            <span>{req.address_update ? 'اعتماد العنوان' : 'اعتماد الربط'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionLoading !== null}
                                            onClick={() => handleReject(req.id)}
                                            className="px-3 py-2 bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 font-bold text-xs rounded-xl hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors border border-red-200 dark:border-red-800 flex items-center gap-1 cursor-pointer"
                                        >
                                            <X size={15} />
                                            <span>رفض</span>
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs">
                    <span className="text-slate-400">
                        إجمالي المعلق: <strong className="text-slate-700 dark:text-slate-200">{requests.length}</strong>
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                        إغلاق
                    </button>
                </div>
            </div>
        </div>
    );
}
