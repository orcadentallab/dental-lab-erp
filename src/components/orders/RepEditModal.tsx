import { useState, useEffect, useMemo } from 'react';
import { X, AlertTriangle, Save, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import { db } from '../../services/db';
import type { Order, Supplier, User, Service, Doctor } from '../../services/db';
import { repUpdateOrderWithAudit } from '../../services/supabase/orderWorkflow';
import {
    ORDER_EDIT_REASON_CODES,
    ORDER_EDIT_REASON_LABELS_AR,
    reasonRequiresNote,
    type OrderEditReasonCode,
} from '../../constants/orderEditReasons';
import {
    REP_FIELD_STATE_GUARDS,
    type RepAuditedField,
} from '../../lib/workflowPermissions';
import { getEffectiveProductionStatus, getEffectiveIssueState } from '../../constants/orderLifecycle';
import { useToast } from '../../context/ToastContext';
import { TeethTagsInput } from '../ui/TeethTagsInput';
import { getDoctorServicePrice } from '../../lib/pricingUtils';
import { hasCustomPermission, FIXED_SALARY_DESIGNER_PERMISSION } from '../../lib/userRoles';

interface Props {
    order: Order;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    suppliers: Supplier[];
    designers: User[];
}

interface FormOrderItem {
    serviceType: string;
    teethNumbers: string[];
    price: number;
    customPrice?: number;
}

const calculateOrderCost = (
    workflowType: 'full' | 'split',
    items: { serviceType: string; teethNumbers: string[] }[],
    services: Service[],
    suppliers: Supplier[],
    selectedSupplier: string,
    designers: User[],
    designerId: string
) => {
    if (workflowType === 'full') {
        return items.reduce((sum, item) => {
            const count = item.teethNumbers ? item.teethNumbers.length : 0;
            const svc = services.find(s => s.name === item.serviceType);
            let unitCost = svc ? svc.costPrice : 0;
            if (selectedSupplier) {
                const sup = suppliers.find(s => s.id === selectedSupplier);
                if (sup?.customPrices?.[item.serviceType] !== undefined) unitCost = sup.customPrices[item.serviceType];
            }
            return sum + (unitCost * count);
        }, 0);
    }

    const designer = designers.find(d => d.id === designerId);
    const sup = suppliers.find(s => s.id === selectedSupplier);
    return items.reduce((sum, item) => {
        const count = item.teethNumbers && item.teethNumbers.length > 0 ? item.teethNumbers.length : 1;
        const svc = services.find(s => s.name === item.serviceType);
        const designUnitCost = designer?.designerServicePrices?.[item.serviceType] !== undefined
            ? designer.designerServicePrices![item.serviceType]
            : (svc?.designerPrice ?? 0);
        const isSalaried = hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION);
        const dCost = isSalaried ? 0 : designUnitCost * count;
        let mCost = 0;
        if (sup?.millingPrices?.[item.serviceType] !== undefined) mCost = sup.millingPrices[item.serviceType] * count;
        else if (svc?.millingPrice) mCost = svc.millingPrice * count;
        else if (svc) mCost = (svc.costPrice * 0.5) * count;
        return sum + dCost + mCost;
    }, 0);
};

const calculateAutomaticDesignPrice = (
    items: { serviceType: string; teethNumbers: string[] }[],
    services: Service[],
    designers: User[],
    designerId: string
) => {
    const designer = designers.find(d => d.id === designerId);
    return items.reduce((sum, item) => {
        const count = item.teethNumbers && item.teethNumbers.length > 0 ? item.teethNumbers.length : 1;
        const svc = services.find(s => s.name === item.serviceType);
        const designUnitCost = designer?.designerServicePrices?.[item.serviceType] !== undefined
            ? designer.designerServicePrices![item.serviceType]
            : (svc?.designerPrice ?? 0);
        return sum + (designUnitCost * count);
    }, 0);
};

interface FormChanges {
    patient_name?: string;
    stl_url?: string;
    images_url?: string;
    delivery_date?: string;
    is_urgent?: boolean | string;
    priority?: string;
    supplier_id?: string;
    designer_id?: string;
    instructions?: string;
    items?: { serviceType: string; teethNumbers: string[] | string }[];
}

interface PendingProposalInfo {
    id: string;
    reason?: string;
    notes?: string;
    changes: FormChanges;
}

function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null;
}

function parsePendingProposal(raw: unknown): PendingProposalInfo | null {
    if (!isRecord(raw)) return null;

    const id = raw.id;
    if (typeof id !== 'string') return null;

    const reason = typeof raw.reason === 'string' ? raw.reason : undefined;
    const notes = typeof raw.notes === 'string' ? raw.notes : undefined;

    const metadata = raw.metadata;
    if (!isRecord(metadata)) return null;

    const changes = metadata.changes;
    if (!isRecord(changes)) return null;

    const parsedChanges: FormChanges = {};

    if (typeof changes.patient_name === 'string') parsedChanges.patient_name = changes.patient_name;
    if (typeof changes.stl_url === 'string') parsedChanges.stl_url = changes.stl_url;
    if (typeof changes.images_url === 'string') parsedChanges.images_url = changes.images_url;
    if (typeof changes.delivery_date === 'string') parsedChanges.delivery_date = changes.delivery_date;
    if (typeof changes.is_urgent === 'boolean' || typeof changes.is_urgent === 'string') {
        parsedChanges.is_urgent = changes.is_urgent;
    }
    if (typeof changes.priority === 'string') parsedChanges.priority = changes.priority;
    if (typeof changes.supplier_id === 'string') parsedChanges.supplier_id = changes.supplier_id;
    if (typeof changes.designer_id === 'string') parsedChanges.designer_id = changes.designer_id;
    if (typeof changes.instructions === 'string') parsedChanges.instructions = changes.instructions;

    if (Array.isArray(changes.items)) {
        const parsedItems: { serviceType: string; teethNumbers: string[] | string }[] = [];
        for (const item of changes.items) {
            if (isRecord(item)) {
                const serviceType = typeof item.serviceType === 'string' ? item.serviceType : '';
                let teethNumbers: string[] | string = [];
                if (Array.isArray(item.teethNumbers)) {
                    teethNumbers = item.teethNumbers.map(t => String(t));
                } else if (typeof item.teethNumbers === 'string') {
                    teethNumbers = item.teethNumbers;
                }
                parsedItems.push({ serviceType, teethNumbers });
            }
        }
        parsedChanges.items = parsedItems;
    }

    return {
        id,
        reason,
        notes,
        changes: parsedChanges
    };
}

export default function RepEditModal({ order, isOpen, onClose, onSuccess, suppliers, designers }: Props) {
    const { success, error: toastError } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [reasonCode, setReasonCode] = useState<OrderEditReasonCode | ''>('');
    const [reasonNote, setReasonNote] = useState('');

    const [patientName, setPatientName] = useState(order.patientName || '');
    const [stlUrl, setStlUrl] = useState(order.stlUrl || '');
    const [imagesUrl, setImagesUrl] = useState(order.imagesUrl || '');
    const [deliveryDate, setDeliveryDate] = useState(order.deliveryDate || '');
    const [isUrgent, setIsUrgent] = useState(order.isUrgent || false);
    const [priority, setPriority] = useState<'Normal' | 'Urgent'>(order.priority || 'Normal');
    const [supplierId, setSupplierId] = useState(order.supplierId || '');
    const [designerId, setDesignerId] = useState(order.designerId || '');
    const [instructions, setInstructions] = useState(order.instructions || '');
    const [items, setItems] = useState<FormOrderItem[]>([]);

    const [services, setServices] = useState<Service[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);

    const [pendingProposal, setPendingProposal] = useState<PendingProposalInfo | null>(null);
    const [showPendingNotice, setShowPendingNotice] = useState(false);
    const [isLoadingPending, setIsLoadingPending] = useState(false);

    const visibleSuppliers = useMemo(
        () => suppliers.filter(supplier => supplier.isActive !== false || supplier.id === supplierId),
        [suppliers, supplierId]
    );

    useEffect(() => {
        const loadServicesAndDoctors = async () => {
            try {
                const [servicesData, doctorsData] = await Promise.all([
                    db.getServices(),
                    db.getDoctors()
                ]);
                setServices(servicesData);
                setDoctors(doctorsData);
            } catch (err) {
                console.error('Failed to load services or doctors in RepEditModal', err);
            }
        };
        loadServicesAndDoctors();
    }, []);

    useEffect(() => {
        const checkPendingProposal = async () => {
            if (!isOpen || !order.id) return;
            setIsLoadingPending(true);
            try {
                const { supabase: localSupabase } = await import('../../lib/supabase');
                const { data, error: queryError } = await localSupabase
                    .from('order_events')
                    .select('*')
                    .eq('order_id', order.id)
                    .eq('event_type', 'order_edit_proposed')
                    .eq('approval_status', 'pending')
                    .maybeSingle();

                if (queryError) throw queryError;
                if (data) {
                    const parsed = parsePendingProposal(data);
                    if (parsed) {
                        setPendingProposal(parsed);
                        setShowPendingNotice(true);
                    }
                } else {
                    setPendingProposal(null);
                    setShowPendingNotice(false);
                }
            } catch (err) {
                console.error('Failed to check pending proposals:', err);
            } finally {
                setIsLoadingPending(false);
            }
        };

        if (isOpen) {
            setPatientName(order.patientName || '');
            setStlUrl(order.stlUrl || '');
            setImagesUrl(order.imagesUrl || '');
            setDeliveryDate(order.deliveryDate || '');
            setIsUrgent(order.isUrgent || false);
            const initialPriority = order.priority;
            if (initialPriority === 'Normal' || initialPriority === 'Urgent') {
                setPriority(initialPriority);
            } else {
                setPriority('Normal');
            }
            setSupplierId(order.supplierId || '');
            setDesignerId(order.designerId || '');
            setInstructions(order.instructions || '');
            setItems(order.items && order.items.length > 0 ? order.items.map(i => {
                const tn: unknown = i.teethNumbers;
                let parsedTeeth: string[] = [];
                if (Array.isArray(tn)) {
                    parsedTeeth = tn.map(String);
                } else if (typeof tn === 'string') {
                    parsedTeeth = tn.split(',');
                }
                return {
                    serviceType: i.serviceType,
                    teethNumbers: parsedTeeth,
                    price: i.price,
                    customPrice: undefined
                };
            }) : [{ serviceType: '', teethNumbers: [], price: 0 }]);
            setReasonCode('');
            setReasonNote('');

            checkPendingProposal();
        }
    }, [isOpen, order]);

    const loadPendingChanges = () => {
        if (!pendingProposal) {
            setShowPendingNotice(false);
            return;
        }

        const changes = pendingProposal.changes;

        if (changes.patient_name !== undefined) setPatientName(changes.patient_name);
        if (changes.stl_url !== undefined) setStlUrl(changes.stl_url);
        if (changes.images_url !== undefined) setImagesUrl(changes.images_url);
        if (changes.delivery_date !== undefined) setDeliveryDate(changes.delivery_date);
        if (changes.is_urgent !== undefined) {
            setIsUrgent(changes.is_urgent === true || changes.is_urgent === 'true');
        }
        if (changes.priority !== undefined) {
            const prio = changes.priority;
            if (prio === 'Normal' || prio === 'Urgent') {
                setPriority(prio);
            }
        }
        if (changes.supplier_id !== undefined) setSupplierId(changes.supplier_id);
        if (changes.designer_id !== undefined) setDesignerId(changes.designer_id);
        if (changes.instructions !== undefined) setInstructions(changes.instructions);
        if (changes.items !== undefined) {
            setItems(changes.items.map(i => {
                const tn = i.teethNumbers;
                let parsedTeeth: string[] = [];
                if (Array.isArray(tn)) {
                    parsedTeeth = tn.map(String);
                } else if (typeof tn === 'string') {
                    parsedTeeth = tn.split(',');
                }
                return {
                    serviceType: i.serviceType,
                    teethNumbers: parsedTeeth,
                    price: 0,
                    customPrice: undefined
                };
            }));
        }

        if (pendingProposal.reason) {
            const found = ORDER_EDIT_REASON_CODES.find(code => code === pendingProposal.reason);
            setReasonCode(found || '');
        }
        if (pendingProposal.notes) {
            setReasonNote(pendingProposal.notes);
        }

        setShowPendingNotice(false);
    };

    const productionStatus = getEffectiveProductionStatus(order);
    const issueState = getEffectiveIssueState(order);

    const isFieldEnabled = (dbField: RepAuditedField): boolean => {
        const guard = REP_FIELD_STATE_GUARDS[dbField];
        if (!guard) return false;
        return guard({ productionStatus, issueState, workflowType: order.workflowType });
    };

    const handleRemoveItem = (index: number) => {
        if (items.length > 1) {
            const newItems = [...items];
            newItems.splice(index, 1);
            setItems(newItems);
        }
    };

    const handleAddItem = () => {
        if (services.length > 0) {
            setItems([...items, { serviceType: services[0].name, teethNumbers: [], price: 0 }]);
        } else {
            setItems([...items, { serviceType: '', teethNumbers: [], price: 0 }]);
        }
    };

    const updateItem = (index: number, field: keyof FormOrderItem, value: string | number | string[]) => {
        const newItems = [...items];
        if (field === 'serviceType' && typeof value === 'string') {
            newItems[index] = { ...newItems[index], serviceType: value, price: 0, customPrice: undefined };
        } else if (field === 'teethNumbers' && Array.isArray(value)) {
            newItems[index] = { ...newItems[index], teethNumbers: value };
        } else if (field === 'price' && typeof value === 'number') {
            newItems[index] = { ...newItems[index], price: value };
        } else if (field === 'customPrice' && (typeof value === 'number' || value === undefined)) {
            newItems[index] = { ...newItems[index], customPrice: value };
        }
        setItems(newItems);
    };

    const hasItemsChanged = (): boolean => {
        const oldItems = order.items || [];
        if (items.length !== oldItems.length) return true;
        for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx];
            const oldIt = oldItems[idx];
            if (!oldIt) return true;
            if (it.serviceType !== oldIt.serviceType) return true;
            const t1 = [...(it.teethNumbers || [])].sort().join(',');
            const t2 = [...(oldIt.teethNumbers || [])].sort().join(',');
            if (t1 !== t2) return true;
        }
        return false;
    };

    const getChanges = (): Partial<Order> => {
        const changes: Partial<Order> = {};
        if (patientName !== (order.patientName || '') && isFieldEnabled('patient_name'))    changes.patientName = patientName;
        if (stlUrl !== (order.stlUrl || '') && isFieldEnabled('stl_url'))                  changes.stlUrl = stlUrl;
        if (imagesUrl !== (order.imagesUrl || '') && isFieldEnabled('images_url'))          changes.imagesUrl = imagesUrl;
        if (deliveryDate !== (order.deliveryDate || '') && isFieldEnabled('delivery_date')) changes.deliveryDate = deliveryDate;
        if (isUrgent !== (order.isUrgent || false) && isFieldEnabled('is_urgent'))          changes.isUrgent = isUrgent;
        if (priority !== (order.priority || 'Normal') && isFieldEnabled('priority'))        changes.priority = priority;
        if (supplierId !== (order.supplierId || '') && isFieldEnabled('supplier_id'))       changes.supplierId = supplierId || undefined;
        if (designerId !== (order.designerId || '') && isFieldEnabled('designer_id'))       changes.designerId = designerId || undefined;
        if (instructions !== (order.instructions || '') && isFieldEnabled('instructions')) changes.instructions = instructions;

        const itemsChanged = hasItemsChanged();
        const supplierChanged = supplierId !== (order.supplierId || '');
        const designerChanged = designerId !== (order.designerId || '');

        let resolvedItems = items;
        if (itemsChanged && isFieldEnabled('items')) {
            const mapped = items.map(it => {
                const svc = services.find(s => s.name === it.serviceType);
                const finalDoctor = doctors.find(d => d.id === order.doctorId);
                const unitPrice = getDoctorServicePrice(it.serviceType, svc, finalDoctor, doctors);
                return {
                    serviceType: it.serviceType,
                    teethNumbers: it.teethNumbers,
                    price: unitPrice
                };
            });
            changes.items = mapped;
            resolvedItems = mapped;

            const subTotal = mapped.reduce((sum, item) => {
                const count = item.teethNumbers ? item.teethNumbers.length : 0;
                return sum + (count * item.price);
            }, 0);
            changes.totalPrice = Math.max(0, subTotal - (order.discount || 0));
        }

        if ((itemsChanged && isFieldEnabled('items')) ||
            (supplierChanged && isFieldEnabled('supplier_id')) ||
            (designerChanged && isFieldEnabled('designer_id'))
        ) {
            const currentItems = resolvedItems.map(it => {
                const svc = services.find(s => s.name === it.serviceType);
                const finalDoctor = doctors.find(d => d.id === order.doctorId);
                const unitPrice = getDoctorServicePrice(it.serviceType, svc, finalDoctor, doctors);
                return {
                    serviceType: it.serviceType,
                    teethNumbers: it.teethNumbers,
                    price: unitPrice
                };
            });

            changes.cost = calculateOrderCost(
                order.workflowType || 'full',
                currentItems,
                services,
                suppliers,
                supplierId,
                designers,
                designerId
            );

            if (order.workflowType === 'split') {
                changes.designPrice = calculateAutomaticDesignPrice(
                    currentItems,
                    services,
                    designers,
                    designerId
                );
            }
        }

        return changes;
    };

    const handleSubmit = async () => {
        const changes = getChanges();

        if (Object.keys(changes).length === 0) {
            toastError('لا يوجد تغييرات');
            return;
        }
        if (reasonCode === '') {
            toastError('يرجى اختيار سبب التعديل');
            return;
        }
        if (reasonRequiresNote(reasonCode) && !reasonNote.trim()) {
            toastError('يرجى كتابة ملاحظة توضيحية');
            return;
        }

        setIsSubmitting(true);
        try {
            await repUpdateOrderWithAudit(order.id, changes, reasonCode, reasonNote.trim() || null);

            // Check if it went to pending approval (order is delivered)
            const isDelivered = ['Delivered', 'Completed'].includes(order.status) || order.productionStatus === 'final_delivered';
            if (isDelivered) {
                success('تم إرسال طلب التعديل لمراجعة الأدمن بنجاح');
            } else {
                success('تم حفظ التعديلات بنجاح');
            }
            onSuccess();
            onClose();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'فشل في حفظ التعديلات';
            toastError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const hasChanges = Object.keys(getChanges()).length > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-surface-800 shadow-xl animate-in fade-in duration-200">
                <div className="flex items-center justify-between p-4 border-b border-surface-200">
                    <h2 className="text-lg font-bold text-surface-900">تعديل بيانات الأوردر</h2>
                    <button onClick={onClose} className="p-1 rounded hover:bg-surface-100">
                        <X size={20} />
                    </button>
                </div>

                {showPendingNotice ? (
                    <div className="p-6 space-y-6 text-center animate-in fade-in duration-200">
                        <div className="flex justify-center">
                            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-full text-amber-600">
                                <AlertTriangle size={36} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-lg font-bold text-surface-900">تعديل معلق بالفعل</h3>
                            <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                                يرجى العلم بأن هناك تعديلًا معلقًا بالفعل بانتظار موافقة الإدارة على هذا الطلب.
                            </p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
                            <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
                                الرجوع
                            </Button>
                            <Button onClick={loadPendingChanges} className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white">
                                تعديل الطلب المعلق
                            </Button>
                        </div>
                    </div>
                ) : isLoadingPending ? (
                    <div className="p-12 text-center text-surface-500">
                        جاري التحقق من التعديلات المعلقة...
                    </div>
                ) : (
                    <>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-surface-700 mb-1">اسم المريض</label>
                                <Input
                                    value={patientName}
                                    onChange={(e) => setPatientName(e.target.value)}
                                    disabled={!isFieldEnabled('patient_name')}
                                    placeholder="اسم المريض"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-surface-700 mb-1">رابط STL</label>
                                <Input
                                    value={stlUrl}
                                    onChange={(e) => setStlUrl(e.target.value)}
                                    disabled={!isFieldEnabled('stl_url')}
                                    placeholder="https://..."
                                    dir="ltr"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-surface-700 mb-1">رابط الصور</label>
                                <Input
                                    value={imagesUrl}
                                    onChange={(e) => setImagesUrl(e.target.value)}
                                    disabled={!isFieldEnabled('images_url')}
                                    placeholder="https://..."
                                    dir="ltr"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-surface-700 mb-1">تاريخ التسليم</label>
                                <Input
                                    type="date"
                                    value={deliveryDate}
                                    onChange={(e) => setDeliveryDate(e.target.value)}
                                    disabled={!isFieldEnabled('delivery_date')}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-surface-700 mb-1">الأولوية</label>
                                    <select
                                        value={priority}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === 'Normal' || val === 'Urgent') {
                                                setPriority(val);
                                            }
                                        }}
                                        disabled={!isFieldEnabled('priority')}
                                        className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm disabled:opacity-50"
                                    >
                                        <option value="Normal">عادي</option>
                                        <option value="Urgent">عاجل</option>
                                    </select>
                                </div>
                                <div className="flex items-end pb-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={isUrgent}
                                            onChange={(e) => setIsUrgent(e.target.checked)}
                                            disabled={!isFieldEnabled('is_urgent')}
                                            className="w-4 h-4 rounded border-surface-300"
                                        />
                                        <span className="text-sm font-medium text-surface-700">طارئ</span>
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-surface-700 mb-1">المعمل</label>
                                <select
                                    value={supplierId}
                                    onChange={(e) => setSupplierId(e.target.value)}
                                    disabled={!isFieldEnabled('supplier_id')}
                                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm disabled:opacity-50"
                                >
                                    <option value="">— بدون —</option>
                                    {visibleSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>

                            {order.workflowType === 'split' && (
                                <div>
                                    <label className="block text-sm font-medium text-surface-700 mb-1">المصمم</label>
                                    <select
                                        value={designerId}
                                        onChange={(e) => setDesignerId(e.target.value)}
                                        disabled={!isFieldEnabled('designer_id')}
                                        className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm disabled:opacity-50"
                                    >
                                        <option value="">— بدون —</option>
                                        {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-surface-700 mb-1">تعليمات / ملاحظات</label>
                                <textarea
                                    value={instructions}
                                    onChange={(e) => setInstructions(e.target.value)}
                                    disabled={!isFieldEnabled('instructions')}
                                    placeholder="تعليمات أو ملاحظات الحالة..."
                                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm disabled:opacity-50 resize-y min-h-[80px]"
                                    rows={3}
                                />
                            </div>

                            <div className="border-t border-surface-200 pt-4 mt-4">
                                <div className="flex justify-between items-center mb-3">
                                    <label className="block text-sm font-bold text-surface-800">الأصناف المطلوبة</label>
                                    {isFieldEnabled('items') && (
                                        <Button size="sm" variant="secondary" onClick={handleAddItem} className="h-8 text-xs gap-1">
                                            <Plus size={14} /> إضافة صنف
                                        </Button>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    {items.map((item, index) => (
                                        <div key={index} className="flex gap-2 items-center bg-surface-50 p-2 rounded-lg border border-surface-200">
                                            <div className="w-6 h-6 rounded bg-white flex items-center justify-center font-bold text-surface-400 text-xs border border-surface-150 shrink-0">
                                                {index + 1}
                                            </div>
                                            <div className="w-1/3">
                                                <select
                                                    value={item.serviceType}
                                                    onChange={(e) => updateItem(index, 'serviceType', e.target.value)}
                                                    disabled={!isFieldEnabled('items')}
                                                    className="w-full bg-transparent font-bold text-xs outline-none text-surface-800 cursor-pointer border border-surface-200 rounded px-2 py-1 bg-white disabled:opacity-50"
                                                >
                                                    {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                                </select>
                                            </div>
                                            <div className="flex-1">
                                                <TeethTagsInput
                                                    value={item.teethNumbers}
                                                    onChange={(teeth) => updateItem(index, 'teethNumbers', teeth)}
                                                    disabled={!isFieldEnabled('items')}
                                                    placeholder="أدخل رقم السن..."
                                                />
                                            </div>
                                            {items.length > 1 && isFieldEnabled('items') && (
                                                <button
                                                    onClick={() => handleRemoveItem(index)}
                                                    className="p-1.5 text-surface-400 hover:text-red-500 transition-colors"
                                                    title="حذف"
                                                    type="button"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="border-t border-surface-200 pt-4 mt-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle size={16} className="text-amber-500" />
                                    <span className="text-sm font-bold text-surface-800">سبب التعديل (مطلوب)</span>
                                </div>
                                <select
                                    value={reasonCode}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        const found = ORDER_EDIT_REASON_CODES.find(code => code === val);
                                        setReasonCode(found || '');
                                    }}
                                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm mb-2"
                                >
                                    <option value="">— اختر السبب —</option>
                                    {ORDER_EDIT_REASON_CODES
                                        .filter(c => c !== 'items_corrected' && c !== 'teeth_corrected')
                                        .map(code => (
                                            <option key={code} value={code}>{ORDER_EDIT_REASON_LABELS_AR[code]}</option>
                                        ))
                                    }
                                </select>

                                {reasonCode !== '' && reasonRequiresNote(reasonCode) && (
                                    <textarea
                                        value={reasonNote}
                                        onChange={(e) => setReasonNote(e.target.value)}
                                        placeholder="اكتب ملاحظة توضيحية..."
                                        className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm resize-none"
                                        rows={2}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 p-4 border-t border-surface-200">
                            <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>إلغاء</Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={isSubmitting || !hasChanges || !reasonCode}
                                className="bg-primary-600 hover:bg-primary-700 text-white"
                            >
                                <Save size={14} />
                                <span className="mr-1">{isSubmitting ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
                            </Button>
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
}
