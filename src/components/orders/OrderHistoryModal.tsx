import { useState } from 'react';
import { X, Clock, User, ArrowRight, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import type { OrderEvent, OrderHistoryEntry } from '../../services/db';

interface OrderHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    history: OrderHistoryEntry[];
    isLoading: boolean;
    events?: OrderEvent[];
    eventsLoading?: boolean;
    eventsError?: boolean;
    showBusinessTimeline?: boolean;
    doctors?: Record<string, string>;
    suppliers?: Record<string, string>;
    users?: Record<string, string>;
}

const EVENT_LABELS: Record<string, string> = {
    order_created: 'تم إنشاء الأوردر',
    production_status_changed: 'تم تغيير حالة الأوردر',
    try_in_started: 'بدأت مرحلة Try-In',
    try_in_approved: 'تمت الموافقة على Try-In',
    try_in_adjustment_requested: 'تم طلب تعديل Try-In',
    order_ready: 'الأوردر جاهز',
    order_delivered: 'تم تسليم الأوردر',
    delivery_route_changed: 'تم تغيير مسار التسليم',
    issue_reported: 'تم تسجيل مشكلة',
    remake_requested: 'تم طلب إعادة',
    rejection_requested: 'تم تسجيل رفض',
    financial_adjustment_requested: 'تم طلب تسوية مالية',
    financial_adjustment_approved: 'تم اعتماد تسوية مالية',
    payment_allocated: 'تم توزيع دفعة',
    manual_allocation_override: 'تعديل يدوي في توزيع الدفع',
    order_closed: 'تم إغلاق الأوردر',
    order_reopened: 'تم إعادة فتح الأوردر',
};

const ROLE_LABELS: Record<string, string> = {
    admin: 'مدير',
    accountant: 'محاسب',
    representative: 'مندوب',
    designer: 'مصمم',
    lab: 'معمل خارجي',
    doctor: 'طبيب',
};

const SEVERITY_STYLES = {
    info: 'bg-blue-50 text-blue-700 border-blue-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    critical: 'bg-red-50 text-red-700 border-red-100',
} as const;

const SEVERITY_ICONS = {
    info: Info,
    warning: AlertTriangle,
    critical: AlertTriangle,
} as const;

function formatEventActor(event: OrderEvent) {
    const role = event.actorRole ? ROLE_LABELS[event.actorRole] || event.actorRole : '';
    const actor = event.changedBy ? `#${event.changedBy.slice(0, 8)}` : 'System';
    return role ? `${actor} · ${role}` : actor;
}

function renderEventDetails(event: OrderEvent) {
    const details = [
        event.reason ? { label: 'السبب', value: event.reason } : undefined,
        event.notes ? { label: 'ملاحظات', value: event.notes } : undefined,
        event.responsibilityParty ? { label: 'المسؤولية', value: event.responsibilityParty } : undefined,
        event.approvalStatus && event.approvalStatus !== 'none' ? { label: 'الاعتماد', value: event.approvalStatus } : undefined,
        event.financialImpact !== null && event.financialImpact !== undefined ? { label: 'الأثر المالي', value: event.financialImpact.toLocaleString() } : undefined,
    ].filter((item): item is { label: string; value: string } => item !== undefined);

    if (details.length === 0) return null;

    return (
        <div className="mt-3 space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            {details.map((detail) => (
                <div key={detail.label} className="flex gap-2">
                    <span className="font-bold text-gray-500">{detail.label}:</span>
                    <span>{detail.value}</span>
                </div>
            ))}
        </div>
    );
}

const FIELD_LABELS: Record<string, string> = {
    status: 'الحالة العامة',
    technician_status: 'حالة الفني',
    design_status: 'حالة التصميم',
    design_url: 'رابط التصميم',
    patient_name: 'اسم المريض',
    cost: 'تكلفة المعمل',
    manual_cost: 'التكلفة اليدوية للمعمل',
    total_price: 'إجمالي السعر',
    design_price: 'تكلفة التصميم',
    manual_design_price: 'التكلفة اليدوية للتصميم',
    discount: 'الخصم',
    delivery_date: 'تاريخ التسليم',
    priority: 'الأولوية',
    delivery_type: 'نوع التسليم',
    doctor_id: 'الطبيب المعالج',
    supplier_id: 'المورد / المعمل الخارجي',
    designer_id: 'المصمم',
    is_redo: 'طلب إعادة العمل',
    is_urgent: 'حالة عاجلة',
    issue_state: 'حالة المشكلة/الإرجاع',
    rejected_lab_cost: 'تكلفة الرفض على المعمل',
};

function formatDiffValue(
    key: string,
    val: unknown,
    doctors?: Record<string, string>,
    suppliers?: Record<string, string>,
    users?: Record<string, string>
): string {
    if (val === null || val === undefined || val === '') {
        return 'فارغ';
    }
    if (val === true || val === 'true') {
        return 'نعم';
    }
    if (val === false || val === 'false') {
        return 'لا';
    }

    const valStr = String(val);

    // Resolve IDs using lookup tables
    if (key === 'doctor_id' && doctors) {
        return doctors[valStr] || valStr;
    }
    if (key === 'supplier_id' && suppliers) {
        return suppliers[valStr] || valStr;
    }
    if (key === 'designer_id' && users) {
        return users[valStr] || valStr;
    }

    // Format monetary values
    const monetaryFields = ['cost', 'manual_cost', 'total_price', 'design_price', 'manual_design_price', 'discount', 'rejected_lab_cost'];
    if (monetaryFields.includes(key)) {
        const num = Number(val);
        if (!isNaN(num)) {
            return `${num.toLocaleString('en-EG')} ج.م`;
        }
    }

    // Priority translations
    if (key === 'priority') {
        if (valStr === 'Urgent') return 'عاجل';
        if (valStr === 'Normal') return 'عادي';
    }

    // Delivery type translations
    if (key === 'delivery_type') {
        if (valStr === 'Final') return 'نهائي (Final)';
        if (valStr === 'Try-In' || valStr === 'TryIn') return 'تجربة (Try-In)';
    }

    // Issue state translations
    if (key === 'issue_state') {
        const issueMap: Record<string, string> = {
            'none': 'لا يوجد',
            'returned': 'مرتجع للتعديل',
            'cancelled': 'ملغي',
            'on_hold': 'موقوف مؤقتاً',
            'redo': 'إعادة إنتاج',
            'doctor_rejected': 'مرتجع طبيب',
            'lab_rejected': 'رفض معمل',
        };
        return issueMap[valStr] || valStr;
    }

    // General status translations
    if (key === 'status') {
        const statusMap: Record<string, string> = {
            'Pending Review': 'قيد المراجعة',
            'Under Production': 'تحت الإنتاج',
            'Ready': 'جاهز التسليم',
            'Delivered': 'تم التسليم',
            'Cancelled': 'ملغي',
            'Rejected': 'مرفوض',
            'Returned for Adjustments': 'مرتجع للتعديل',
        };
        return statusMap[valStr] || valStr;
    }

    if (key === 'technician_status') {
        const techStatusMap: Record<string, string> = {
            'Pending': 'معلق',
            'Approved': 'مقبول',
            'Rejected': 'مرفوض',
            'NeedDetails': 'بحاجة لتفاصيل',
            'PMMA_First': 'PMMA أولاً',
        };
        return techStatusMap[valStr] || valStr;
    }

    if (key === 'design_status') {
        const designStatusMap: Record<string, string> = {
            'Pending': 'معلق',
            'Approved': 'مقبول',
            'Rejected': 'مرفوض',
            'NeedDetails': 'بحاجة لتفاصيل',
        };
        return designStatusMap[valStr] || valStr;
    }

    return valStr;
}

const isRecord = (v: unknown): v is Record<string, unknown> => {
    return typeof v === 'object' && v !== null;
};

export default function OrderHistoryModal({
    isOpen,
    onClose,
    history,
    isLoading,
    events = [],
    eventsLoading = false,
    eventsError = false,
    showBusinessTimeline = false,
    doctors = {},
    suppliers = {},
    users = {},
}: OrderHistoryModalProps) {
    const [activeTab, setActiveTab] = useState<'events' | 'history'>(showBusinessTimeline ? 'events' : 'history');

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Clock size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800">{showBusinessTimeline ? 'سجل الأحداث' : 'سجل النشاط (Audit Log)'}</h3>
                            <p className="text-xs text-gray-500">تتبع جميع التعديلات والحالات لهذا الطلب</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="إغلاق">
                        <X size={24} />
                    </button>
                </div>

                {showBusinessTimeline && (
                    <div className="flex border-b border-gray-100 bg-white px-4 pt-3">
                        <button
                            onClick={() => setActiveTab('events')}
                            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'events' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}
                        >
                            سجل الأحداث
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}
                        >
                            Audit Log
                        </button>
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
                    {showBusinessTimeline && activeTab === 'events' ? (
                        eventsLoading ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-10 text-gray-400">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                <p>جاري تحميل سجل الأحداث...</p>
                            </div>
                        ) : eventsError ? (
                            <div className="text-center py-8 text-red-500">
                                <AlertTriangle className="mx-auto mb-2" size={28} />
                                <p>تعذر تحميل سجل الأحداث</p>
                            </div>
                        ) : events.length === 0 ? (
                            <div className="text-center py-8 text-gray-400">
                                <p>لا توجد أحداث مسجلة بعد</p>
                            </div>
                        ) : (
                            <div className="space-y-5 relative before:absolute before:inset-y-0 before:right-[19px] before:w-0.5 before:bg-blue-100">
                                {events.map((event) => {
                                    const SeverityIcon = SEVERITY_ICONS[event.severity];

                                    return (
                                        <div key={event.id} className="relative flex gap-4 pr-10">
                                            <div className={`absolute right-0 top-1 w-10 h-10 rounded-full flex items-center justify-center border-4 border-white shadow-sm z-10 ${event.severity === 'critical' ? 'bg-red-100 text-red-600' : event.severity === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                                                {event.eventType === 'order_delivered' ? <CheckCircle2 size={16} /> : <SeverityIcon size={16} />}
                                            </div>

                                            <div className="flex-1 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-2">
                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-bold text-gray-800 text-sm">{EVENT_LABELS[event.eventType] || event.eventType}</span>
                                                            <span className={`text-[10px] border px-2 py-0.5 rounded-full font-bold ${SEVERITY_STYLES[event.severity]}`}>
                                                                {event.severity}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-400 mt-1">{formatEventActor(event)}</p>
                                                    </div>
                                                    <span className="text-xs text-gray-400" dir="ltr">
                                                        {format(new Date(event.changedAt), 'dd/MM/yyyy hh:mm a', { locale: ar })}
                                                    </span>
                                                </div>

                                                {(event.oldValue || event.newValue) && (
                                                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2 text-xs">
                                                        <span className="text-red-500 line-through bg-red-50 px-2 py-0.5 rounded">{event.oldValue || 'Empty'}</span>
                                                        <ArrowRight size={12} className="text-gray-400" />
                                                        <span className="text-green-700 font-bold bg-green-50 px-2 py-0.5 rounded">{event.newValue || 'Empty'}</span>
                                                    </div>
                                                )}

                                                {renderEventDetails(event)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : isLoading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    ) : history.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                            <p>لا يوجد سجل نشاط لهذا الطلب بعد.</p>
                        </div>
                    ) : (
                        <div className="space-y-6 relative before:absolute before:inset-y-0 before:right-[19px] before:w-0.5 before:bg-gray-200">
                            {history.map((item) => (
                                <div key={item.id} className="relative flex gap-4 pr-10">
                                    {/* Timeline Dot */}
                                    <div className={`absolute right-0 top-1 w-10 h-10 rounded-full flex items-center justify-center border-4 border-white shadow-sm z-10 ${item.action_type === 'CREATE' ? 'bg-green-100 text-green-600' :
                                        item.action_type === 'STATUS_CHANGE' ? 'bg-teal-100 text-teal-600' :
                                            item.action_type === 'UPDATE' ? 'bg-blue-100 text-blue-600' :
                                                'bg-gray-100 text-gray-600'
                                        }`}>
                                        {item.action_type === 'CREATE' ? <Clock size={16} /> : <User size={16} />}
                                    </div>

                                    {/* Content Card */}
                                    <div className="flex-1 bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-gray-800 text-sm">{item.user_name || 'System'}</span>
                                                <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-mono">
                                                    {item.action_type}
                                                </span>
                                            </div>
                                            <span className="text-xs text-gray-400" dir="ltr">
                                                {format(new Date(item.created_at), 'dd/MM/yyyy hh:mm a', { locale: ar })}
                                            </span>
                                        </div>

                                        <p className="text-sm text-gray-600 font-medium mb-2">{item.details}</p>

                                        {/* Changes Diff */}
                                        {item.changes && Object.keys(item.changes).length > 0 && (
                                            <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-500 space-y-1">
                                                {/* Special handling for CREATE - show subset of fields or nothing */}
                                                {item.action_type === 'CREATE' ? (
                                                    <div className="text-gray-400 italic">تم إنشاء الطلب</div>
                                                ) : (
                                                    Object.entries(item.changes).map(([key, val]) => {
                                                        // Safety check: ensure val is an object with old/new
                                                        if (!val || typeof val !== 'object') return null;
                                                        if (!isRecord(val)) return null;

                                                        return (
                                                            <div key={key} className="flex items-center gap-2">
                                                                <span className="font-semibold text-gray-700">{FIELD_LABELS[key] || key}:</span>
                                                                <span className="text-red-500 line-through bg-red-50 px-1 rounded">
                                                                    {formatDiffValue(key, val.old, doctors, suppliers, users)}
                                                                </span>
                                                                <ArrowRight size={10} className="text-gray-400" />
                                                                <span className="text-green-600 font-bold bg-green-50 px-1 rounded">
                                                                    {formatDiffValue(key, val.new, doctors, suppliers, users)}
                                                                </span>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
