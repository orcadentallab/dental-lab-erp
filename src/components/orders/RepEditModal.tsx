import { useState, useEffect, useId, useMemo } from 'react';
import { X, AlertTriangle, Save, Plus, Trash2, ClipboardPenLine, Check, FlaskConical, LockKeyhole, Info } from 'lucide-react';
import { Input } from '../ui/Input';
import DateField from '../ui/DateField';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';
import { db } from '../../services/db';
import type { Order, Supplier, User, Service, ServiceFamily, Doctor } from '../../services/db';
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
import { getEffectiveProductionStatus, getEffectiveIssueState, requiresAdminApprovalForOrderEdit } from '../../constants/orderLifecycle';
import { useToast } from '../../context/ToastContext';
import { TeethTagsInput } from '../ui/TeethTagsInput';
import { getDoctorServicePrice, reconcileLegacyItemPrices } from '../../lib/pricingUtils';
import { hasCustomPermission, FIXED_SALARY_DESIGNER_PERMISSION } from '../../lib/userRoles';
import { productionStatusAfterDeliveryTypeChange } from '../../constants/deliveryTypeChange';
import { PRODUCTION_STATUS_LABELS_AR } from '../../constants/workflow';
import { CATALOG_EXTERNAL_ROUTE_ID, CATALOG_PRINT_ROUTE_ID, MIXED_TRY_IN_ROUTE_ID } from '../../services/supabase/production';

const labelClass = 'mb-1.5 block text-sm font-semibold text-surface-800 dark:text-slate-200';
const fieldClass = 'min-h-11 w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-base text-surface-900 placeholder:text-surface-500 transition-colors motion-reduce:transition-none focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:bg-surface-100 disabled:text-surface-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-300';
const actionClass = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed';
const secondaryActionClass = actionClass + ' border border-surface-200 text-surface-700 hover:bg-surface-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700';
const primaryActionClass = actionClass + ' bg-primary-700 text-white hover:bg-primary-800 disabled:bg-surface-100 disabled:text-surface-600 dark:bg-primary-600 dark:hover:bg-primary-700 dark:disabled:bg-slate-700 dark:disabled:text-slate-300';

const deliveryOptions = [
    { value: 'Final', label: 'نهائي', english: 'Final', Icon: Check },
    { value: 'TryIn', label: 'بروفة', english: 'Try-In', Icon: FlaskConical },
] as const;

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
        if (!selectedSupplier) return 0;
        return items.reduce((sum, item) => {
            const count = item.teethNumbers ? item.teethNumbers.length : 0;
            const svc = services.find(s => s.name === item.serviceType);
            let unitCost = svc ? svc.costPrice : 0;
            const sup = suppliers.find(s => s.id === selectedSupplier);
            if (sup?.customPrices?.[item.serviceType] !== undefined) unitCost = sup.customPrices[item.serviceType];
            return sum + (unitCost * count);
        }, 0);
    }

    const designer = designers.find(d => d.id === designerId);
    const sup = selectedSupplier ? suppliers.find(s => s.id === selectedSupplier) : null;
    return items.reduce((sum, item) => {
        const count = item.teethNumbers && item.teethNumbers.length > 0 ? item.teethNumbers.length : 1;
        const svc = services.find(s => s.name === item.serviceType);
        const designUnitCost = designer?.designerServicePrices?.[item.serviceType] !== undefined
            ? designer.designerServicePrices![item.serviceType]
            : (svc?.designerPrice ?? 0);
        const isSalaried = hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION);
        const dCost = isSalaried ? 0 : designUnitCost * count;
        let mCost = 0;
        if (selectedSupplier) {
            if (sup?.millingPrices?.[item.serviceType] !== undefined) mCost = sup.millingPrices[item.serviceType] * count;
            else if (svc?.millingPrice) mCost = svc.millingPrice * count;
            else if (svc) mCost = (svc.costPrice * 0.5) * count;
        }
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
    delivery_type?: 'Final' | 'TryIn';
    patient_name?: string;
    stl_url?: string;
    images_url?: string;
    delivery_date?: string;
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
    if (changes.delivery_type === 'Final' || changes.delivery_type === 'TryIn') parsedChanges.delivery_type = changes.delivery_type;

    if (typeof changes.patient_name === 'string') parsedChanges.patient_name = changes.patient_name;
    if (typeof changes.stl_url === 'string') parsedChanges.stl_url = changes.stl_url;
    if (typeof changes.images_url === 'string') parsedChanges.images_url = changes.images_url;
    if (typeof changes.delivery_date === 'string') parsedChanges.delivery_date = changes.delivery_date;
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
    const formId = useId();
    const dialogRef = useDialogBehavior(isOpen, () => {
        if (!isSubmitting) onClose();
    });
    const [reasonCode, setReasonCode] = useState<OrderEditReasonCode | ''>('');
    const [reasonNote, setReasonNote] = useState('');

    const [patientName, setPatientName] = useState(order.patientName || '');
    const [deliveryType, setDeliveryType] = useState<'Final' | 'TryIn'>(order.deliveryType || 'Final');
    const [stlUrl, setStlUrl] = useState(order.stlUrl || '');
    const [imagesUrl, setImagesUrl] = useState(order.imagesUrl || '');
    const [deliveryDate, setDeliveryDate] = useState(order.deliveryDate || '');
    const [supplierId, setSupplierId] = useState(order.supplierId || '');
    const [designerId, setDesignerId] = useState(order.designerId || '');
    const [instructions, setInstructions] = useState(order.instructions || '');
    const [items, setItems] = useState<FormOrderItem[]>([]);

    const [services, setServices] = useState<Service[]>([]);
    const activeServices = services.filter(service => service.isActive !== false);
    const [families, setFamilies] = useState<ServiceFamily[]>([]);
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
                const [servicesData, familiesData, doctorsData] = await Promise.all([
                    db.getServices(),
                    db.getServiceFamilies(),
                    db.getDoctors()
                ]);
                setServices(servicesData);
                setFamilies(familiesData);
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
            setDeliveryType(order.deliveryType || 'Final');
            setStlUrl(order.stlUrl || '');
            setImagesUrl(order.imagesUrl || '');
            setDeliveryDate(order.deliveryDate || '');
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
        if (changes.delivery_type !== undefined) setDeliveryType(changes.delivery_type);
        if (changes.stl_url !== undefined) setStlUrl(changes.stl_url);
        if (changes.images_url !== undefined) setImagesUrl(changes.images_url);
        if (changes.delivery_date !== undefined) setDeliveryDate(changes.delivery_date);
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

    const routeLocksDeliveryType = [MIXED_TRY_IN_ROUTE_ID, CATALOG_PRINT_ROUTE_ID, CATALOG_EXTERNAL_ROUTE_ID]
        .some(routeId => routeId === order.routeOverrideId);

    const isFieldEnabled = (dbField: RepAuditedField): boolean => {
        if (dbField === 'delivery_type' && (routeLocksDeliveryType || order.isDeleted)) return false;
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
        setItems([...items, { serviceType: activeServices[0]?.name ?? '', teethNumbers: [], price: 0 }]);
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
        if (deliveryType !== (order.deliveryType || 'Final') && isFieldEnabled('delivery_type')) changes.deliveryType = deliveryType;
        if (stlUrl !== (order.stlUrl || '') && isFieldEnabled('stl_url'))                  changes.stlUrl = stlUrl;
        if (imagesUrl !== (order.imagesUrl || '') && isFieldEnabled('images_url'))          changes.imagesUrl = imagesUrl;
        if (deliveryDate !== (order.deliveryDate || '') && isFieldEnabled('delivery_date')) changes.deliveryDate = deliveryDate;
        if (supplierId !== (order.supplierId || '') && isFieldEnabled('supplier_id'))       changes.supplierId = supplierId || undefined;
        if (designerId !== (order.designerId || '') && isFieldEnabled('designer_id'))       changes.designerId = designerId || undefined;
        if (instructions !== (order.instructions || '') && isFieldEnabled('instructions')) changes.instructions = instructions;

        const itemsChanged = hasItemsChanged();
        const supplierChanged = supplierId !== (order.supplierId || '');
        const designerChanged = designerId !== (order.designerId || '');

        const orderDoctor = doctors.find(d => d.id === order.doctorId);
        const catalogUnitPrice = (serviceType: string) => getDoctorServicePrice(
            serviceType,
            services.find(s => s.name === serviceType),
            orderDoctor,
            doctors
        );

        // Unit prices of the order as it stands today. Legacy orders (created
        // 2026-01-31 → 2026-04-06) were saved with price = 0 on every item, so
        // rebuild those from the order's stored total first — otherwise editing
        // one line would re-price the whole order at today's catalog prices.
        const originalItems = reconcileLegacyItemPrices(
            (order.items || []).map(i => ({
                serviceType: i.serviceType,
                teethNumbers: Array.isArray(i.teethNumbers) ? i.teethNumbers.map(String) : [],
                price: i.price
            })),
            order.totalPrice || 0,
            order.discount || 0,
            catalogUnitPrice
        );

        let resolvedItems = items;
        if (itemsChanged && isFieldEnabled('items')) {
            const mapped = items.map((it, idx) => {
                // A line the rep did not re-type keeps the price it was sold at;
                // only a new line, or one switched to another service (updateItem
                // clears its price), picks up the current catalog price.
                const original = originalItems[idx];
                const carriedPrice = it.price > 0
                    ? it.price
                    : (original && original.serviceType === it.serviceType ? original.price : 0);
                const unitPrice = carriedPrice > 0 ? carriedPrice : catalogUnitPrice(it.serviceType);
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
            // Lab/designer cost is derived from the service cost prices, not from
            // the selling price, so the resolved lines can be passed through as-is.
            const currentItems = resolvedItems.map(it => ({
                serviceType: it.serviceType,
                teethNumbers: it.teethNumbers,
                price: it.price
            }));

            const automaticCost = calculateOrderCost(
                order.workflowType || 'full',
                currentItems,
                services,
                suppliers,
                supplierId,
                designers,
                designerId
            );

            if (order.workflowType === 'split') {
                const automaticDesignPrice = calculateAutomaticDesignPrice(
                    currentItems,
                    services,
                    designers,
                    designerId
                );
                // The designer can change in this very edit, so the salary rule
                // is read off the designer being assigned, not the old one.
                const isSalaried = hasCustomPermission(
                    designers.find(d => d.id === designerId),
                    FIXED_SALARY_DESIGNER_PERMISSION
                );

                // A manually entered price is a deliberate decision. Re-pricing
                // the items or switching supplier re-derives the automatic
                // figures, but it must not silently discard an override that is
                // still meant to stand. A salaried designer is the one
                // exception: they earn nothing per case either way.
                const effectiveDesignPrice = order.manualDesignPrice ?? automaticDesignPrice;
                const automaticMilling = automaticCost - (isSalaried ? 0 : automaticDesignPrice);
                const effectiveMilling = order.manualCost ?? automaticMilling;

                changes.designPrice = effectiveDesignPrice;
                // Only cost is sent. lab_cost/designer_cost are not on the
                // representative's audited-field whitelist and must not be:
                // that list is a permissions surface, not a plumbing detail.
                // The phase 3 reconciler re-derives the split from cost, which
                // is exactly the legacy direction it still supports.
                changes.cost = effectiveMilling + (isSalaried ? 0 : effectiveDesignPrice);
            } else {
                changes.cost = order.manualCost ?? automaticCost;
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

            // Mirror the RPC's check of this case's own delivery evidence.
            const isDelivered = requiresAdminApprovalForOrderEdit(order);
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
    const deliveryTypeEditable = isFieldEnabled('delivery_type');
    const deliveryTypeChanged = deliveryTypeEditable && deliveryType !== (order.deliveryType || 'Final');
    const needsApproval = requiresAdminApprovalForOrderEdit(order);
    const itemsEditable = isFieldEnabled('items');
    const deliveryNote = routeLocksDeliveryType
        ? 'نوع التسليم ثابت في خريطة الإنتاج الخاصة بالأوردر.'
        : !deliveryTypeEditable ? 'تغيير نوع التسليم غير متاح في حالة الأوردر الحالية.' : '';

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={formId + '-title'} tabIndex={-1} dir="rtl"
                className="flex max-h-[96dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-surface-200 bg-white text-surface-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:max-h-[92dvh] sm:rounded-3xl">
                <header className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-slate-700 sm:px-6 sm:py-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-200">
                        <ClipboardPenLine size={21} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 id={formId + '-title'} className="text-lg font-bold sm:text-xl">تعديل بيانات الأوردر</h2>
                        <p className="truncate text-sm text-surface-600 dark:text-slate-300"><bdi>{order.caseId}</bdi></p>
                    </div>
                    <button type="button" onClick={onClose} disabled={isSubmitting} aria-label="إغلاق فورمة التعديل"
                        className={secondaryActionClass + ' w-11 shrink-0 px-0'}>
                        <X size={19} aria-hidden="true" />
                    </button>
                </header>

                {showPendingNotice ? (
                    <div className="space-y-4 overflow-y-auto p-5 sm:p-6">
                        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
                            <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
                            <div>
                                <h3 className="font-bold">تعديل معلق بالفعل</h3>
                                <p className="mt-1 text-sm leading-relaxed">فيه طلب تعديل للأوردر ده بانتظار موافقة الأدمن.</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={loadPendingChanges} className={primaryActionClass}>تعديل الطلب المعلق</button>
                            <button type="button" onClick={onClose} className={secondaryActionClass}>الرجوع</button>
                        </div>
                    </div>
                ) : isLoadingPending ? (
                    <div role="status" className="p-8 text-center text-sm text-surface-600 dark:text-slate-300">جاري التحقق من التعديلات المعلقة...</div>
                ) : (
                    <>
                        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
                            <fieldset className="min-w-0" aria-describedby={deliveryNote || deliveryTypeChanged ? formId + '-delivery-note' : undefined}>
                                <legend className="mb-2 text-base font-bold">نوع التسليم</legend>
                                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                                    {deliveryOptions.map(({ value, label, english, Icon }) => (
                                        <label key={value} className={deliveryTypeEditable && !isSubmitting ? 'min-w-0 cursor-pointer' : 'min-w-0 cursor-not-allowed'}>
                                            <input type="radio" name={formId + '-delivery-type'} value={value} checked={deliveryType === value}
                                                onChange={() => setDeliveryType(value)} disabled={isSubmitting || !deliveryTypeEditable}
                                                className="peer sr-only" />
                                            <span className="flex min-h-[4.25rem] items-center gap-2 rounded-xl border border-surface-200 bg-white p-2.5 text-surface-800 transition-colors motion-reduce:transition-none peer-enabled:hover:border-primary-400 peer-checked:border-primary-600 peer-checked:bg-primary-50 peer-checked:text-primary-900 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-500 peer-disabled:bg-surface-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:peer-checked:border-primary-400 dark:peer-checked:bg-primary-900/60 dark:peer-checked:text-primary-100 dark:peer-disabled:bg-slate-800 sm:gap-3 sm:px-3.5">
                                                <Icon size={18} aria-hidden="true" className="shrink-0" />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-bold">{label}</span>
                                                    <span className="block text-right text-xs font-medium text-surface-600 dark:text-slate-300" dir="ltr">{english}</span>
                                                </span>
                                                <span aria-hidden="true" className={deliveryType === value
                                                    ? 'h-4 w-4 shrink-0 rounded-full border-[5px] border-primary-600 bg-white dark:border-primary-300 dark:bg-slate-900'
                                                    : 'h-4 w-4 shrink-0 rounded-full border border-surface-300 dark:border-slate-500'} />
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                {(deliveryNote || deliveryTypeChanged) && (
                                    <div id={formId + '-delivery-note'} role="status"
                                        className="mt-2.5 flex items-start gap-2 rounded-xl border border-primary-100 bg-primary-50 px-3 py-2.5 text-sm leading-relaxed text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100">
                                        {deliveryNote ? <LockKeyhole size={16} aria-hidden="true" className="mt-0.5 shrink-0" /> : <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />}
                                        <span>{deliveryNote || <>
                                            المرحلة بعد التعديل <strong>{PRODUCTION_STATUS_LABELS_AR[productionStatusAfterDeliveryTypeChange(productionStatus, order.deliveryType, deliveryType)]}</strong>.
                                            {needsApproval ? ' يُطبّق بعد موافقة الأدمن.' : ' يتم تحديث مسار الإنتاج والالتزامات المالية عند الحفظ.'}
                                        </>}</span>
                                    </div>
                                )}
                            </fieldset>

                            <section aria-labelledby={formId + '-details'} className="border-t border-surface-200 pt-4 dark:border-slate-700">
                                <h3 id={formId + '-details'} className="mb-3 text-base font-bold">بيانات الحالة</h3>
                                <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
                                    <div>
                                        <label htmlFor={formId + '-patient'} className={labelClass}>اسم المريض</label>
                                        <Input id={formId + '-patient'} value={patientName} onChange={e => setPatientName(e.target.value)}
                                            disabled={!isFieldEnabled('patient_name')} className={fieldClass} />
                                    </div>
                                    <div>
                                        <label htmlFor={formId + '-date'} className={labelClass}>تاريخ التسليم</label>
                                        <DateField id={formId + '-date'} value={deliveryDate} onChange={setDeliveryDate}
                                            disabled={!isFieldEnabled('delivery_date')} className="dark:[&>div:first-child]:border-slate-600 dark:[&>div:first-child]:bg-slate-900 dark:[&_input]:text-slate-100 dark:[&_button]:text-slate-300" />
                                    </div>
                                    <div>
                                        <label htmlFor={formId + '-stl'} className={labelClass}>رابط STL</label>
                                        <Input id={formId + '-stl'} value={stlUrl} onChange={e => setStlUrl(e.target.value)}
                                            disabled={!isFieldEnabled('stl_url')} placeholder="https://..." dir="ltr" className={fieldClass} />
                                    </div>
                                    <div>
                                        <label htmlFor={formId + '-images'} className={labelClass}>رابط الصور</label>
                                        <Input id={formId + '-images'} value={imagesUrl} onChange={e => setImagesUrl(e.target.value)}
                                            disabled={!isFieldEnabled('images_url')} placeholder="https://..." dir="ltr" className={fieldClass} />
                                    </div>
                                    <div className={order.workflowType === 'split' ? undefined : 'sm:col-span-2'}>
                                        <label htmlFor={formId + '-lab'} className={labelClass}>المعمل</label>
                                        <select id={formId + '-lab'} value={supplierId} onChange={e => setSupplierId(e.target.value)}
                                            disabled={!isFieldEnabled('supplier_id')} className={fieldClass + ' enabled:cursor-pointer'}>
                                            <option value="">بدون معمل</option>
                                            {visibleSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    {order.workflowType === 'split' && (
                                        <div>
                                            <label htmlFor={formId + '-designer'} className={labelClass}>المصمم</label>
                                            <select id={formId + '-designer'} value={designerId} onChange={e => setDesignerId(e.target.value)}
                                                disabled={!isFieldEnabled('designer_id')} className={fieldClass + ' enabled:cursor-pointer'}>
                                                <option value="">بدون مصمم</option>
                                                {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    <div className="sm:col-span-2">
                                        <label htmlFor={formId + '-notes'} className={labelClass}>التعليمات والملاحظات</label>
                                        <textarea id={formId + '-notes'} value={instructions} onChange={e => setInstructions(e.target.value)}
                                            disabled={!isFieldEnabled('instructions')} className={fieldClass + ' resize-y'} rows={2} />
                                    </div>
                                </div>
                            </section>

                            <section aria-labelledby={formId + '-items'} className="space-y-3 border-t border-surface-200 pt-4 dark:border-slate-700">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 id={formId + '-items'} className="text-base font-bold">الأصناف المطلوبة</h3>
                                    {itemsEditable && (
                                        <button type="button" onClick={handleAddItem} className={secondaryActionClass}>
                                            <Plus size={16} aria-hidden="true" /> إضافة صنف
                                        </button>
                                    )}
                                </div>
                                {items.map((item, index) => (
                                    <div key={index} className="flex items-start gap-2 rounded-xl border border-surface-200 bg-surface-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                                            <select aria-label={`الخدمة للصنف ${index + 1}`} value={item.serviceType}
                                                onChange={e => updateItem(index, 'serviceType', e.target.value)} disabled={!itemsEditable}
                                                className={fieldClass + ' min-w-0 enabled:cursor-pointer'}>
                                                <option value="" disabled>{activeServices.length ? 'اختر الخدمة' : 'مفيش خدمات فعالة'}</option>
                                                {item.serviceType && !activeServices.some(s => s.name === item.serviceType) && (
                                                    <option value={item.serviceType} disabled>{item.serviceType}{services.some(s => s.name === item.serviceType && s.isActive === false) ? ' (غير فعالة)' : ''}</option>
                                                )}
                                                {families.map(family => {
                                                    const familyServices = activeServices.filter(s => s.familyId === family.id);
                                                    if (familyServices.length === 0) return null;
                                                    return (
                                                        <optgroup key={family.id} label={family.nameAr}>
                                                            {familyServices.map(s => (
                                                                <option key={s.id} value={s.name}>{s.name}{family.defaultServiceId === s.id ? ' (افتراضي)' : ''}</option>
                                                            ))}
                                                        </optgroup>
                                                    );
                                                })}
                                                {activeServices.some(s => !s.familyId) && (
                                                    <optgroup label="خدمات فردية">
                                                        {activeServices.filter(s => !s.familyId).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                                    </optgroup>
                                                )}
                                            </select>
                                            <TeethTagsInput value={item.teethNumbers} onChange={teeth => updateItem(index, 'teethNumbers', teeth)}
                                                disabled={!itemsEditable} placeholder="رقم السن" className="min-h-11 min-w-0 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:[&_input]:placeholder:text-slate-400" />
                                        </div>
                                        {items.length > 1 && itemsEditable && (
                                            <button type="button" onClick={() => handleRemoveItem(index)} aria-label={`حذف الصنف ${index + 1}`}
                                                className={secondaryActionClass + ' w-11 shrink-0 px-0 hover:border-red-200 hover:text-red-700 dark:hover:text-red-300'}>
                                                <Trash2 size={16} aria-hidden="true" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </section>

                        </div>
                        <footer className="flex shrink-0 flex-col gap-3 border-t border-surface-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-end sm:px-6">
                            <div className="min-w-0 flex-1">
                                <label htmlFor={formId + '-reason'} className={labelClass}>سبب التعديل <span className="text-surface-600 dark:text-slate-300">(مطلوب)</span></label>
                                <select id={formId + '-reason'} required value={reasonCode}
                                    onChange={e => setReasonCode(ORDER_EDIT_REASON_CODES.find(code => code === e.target.value) || '')}
                                    className={fieldClass + ' cursor-pointer'}>
                                    <option value="">اختر السبب</option>
                                    {ORDER_EDIT_REASON_CODES.filter(code => code !== 'items_corrected' && code !== 'teeth_corrected').map(code => (
                                        <option key={code} value={code}>{ORDER_EDIT_REASON_LABELS_AR[code]}</option>
                                    ))}
                                </select>
                                {reasonCode !== '' && reasonRequiresNote(reasonCode) && (
                                    <div className="mt-3">
                                        <label htmlFor={formId + '-reason-note'} className={labelClass}>ملاحظة توضيحية</label>
                                        <textarea id={formId + '-reason-note'} required value={reasonNote} onChange={e => setReasonNote(e.target.value)}
                                            className={fieldClass + ' resize-y'} rows={2} />
                                    </div>
                                )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <button type="button" onClick={handleSubmit} disabled={isSubmitting || !hasChanges || !reasonCode}
                                    className={primaryActionClass + ' flex-1 sm:flex-none'}>
                                    <Save size={16} aria-hidden="true" />
                                    {isSubmitting ? 'جاري الحفظ...' : needsApproval ? 'إرسال للمراجعة' : 'حفظ التعديلات'}
                                </button>
                                <button type="button" onClick={onClose} disabled={isSubmitting} className={secondaryActionClass}>إلغاء</button>
                            </div>
                        </footer>
                    </>
                )}
            </div>
        </div>
    );
}
