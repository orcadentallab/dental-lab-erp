import { useState, useEffect } from 'react';
import { X, AlertTriangle, Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import type { Order, Supplier, User } from '../../services/db';
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

interface Props {
    order: Order;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    suppliers: Supplier[];
    designers: User[];
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

    useEffect(() => {
        if (isOpen) {
            setPatientName(order.patientName || '');
            setStlUrl(order.stlUrl || '');
            setImagesUrl(order.imagesUrl || '');
            setDeliveryDate(order.deliveryDate || '');
            setIsUrgent(order.isUrgent || false);
            setPriority((order.priority || 'Normal') as 'Normal' | 'Urgent');
            setSupplierId(order.supplierId || '');
            setDesignerId(order.designerId || '');
            setReasonCode('');
            setReasonNote('');
        }
    }, [isOpen, order]);

    const productionStatus = getEffectiveProductionStatus(order);
    const issueState = getEffectiveIssueState(order);

    const isFieldEnabled = (dbField: RepAuditedField): boolean => {
        const guard = REP_FIELD_STATE_GUARDS[dbField];
        if (!guard) return false;
        return guard({ productionStatus, issueState, workflowType: order.workflowType });
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
        return changes;
    };

    const handleSubmit = async () => {
        const changes = getChanges();

        if (Object.keys(changes).length === 0) {
            toastError('لا يوجد تغييرات');
            return;
        }
        if (!reasonCode) {
            toastError('يرجى اختيار سبب التعديل');
            return;
        }
        if (reasonRequiresNote(reasonCode as OrderEditReasonCode) && !reasonNote.trim()) {
            toastError('يرجى كتابة ملاحظة توضيحية');
            return;
        }

        setIsSubmitting(true);
        try {
            await repUpdateOrderWithAudit(order.id, changes, reasonCode, reasonNote.trim() || null);
            success('تم حفظ التعديلات بنجاح');
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
            <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-surface-800 shadow-xl">
                <div className="flex items-center justify-between p-4 border-b border-surface-200">
                    <h2 className="text-lg font-bold text-surface-900">تعديل بيانات الأوردر</h2>
                    <button onClick={onClose} className="p-1 rounded hover:bg-surface-100">
                        <X size={20} />
                    </button>
                </div>

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
                                onChange={(e) => setPriority(e.target.value as 'Normal' | 'Urgent')}
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
                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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

                    <div className="border-t border-surface-200 pt-4 mt-4">
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle size={16} className="text-amber-500" />
                            <span className="text-sm font-bold text-surface-800">سبب التعديل (مطلوب)</span>
                        </div>
                        <select
                            value={reasonCode}
                            onChange={(e) => setReasonCode(e.target.value as OrderEditReasonCode | '')}
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

                        {reasonCode && reasonRequiresNote(reasonCode as OrderEditReasonCode) && (
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
            </Card>
        </div>
    );
}
