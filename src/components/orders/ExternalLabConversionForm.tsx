import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase';
import type { Order, Supplier } from '../../services/db';

interface Props {
    order: Order;
    suppliers: Supplier[];
    onCancel: () => void;
    onSuccess: () => void;
}

export default function ExternalLabConversionForm({ order, suppliers, onCancel, onSuccess }: Props) {
    const [supplierId, setSupplierId] = useState('');
    const [cost, setCost] = useState('');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const { error: toastError, success } = useToast();
    const labs = suppliers.filter(supplier =>
        supplier.isActive !== false && (supplier.supplierType ?? 'external_lab') === 'external_lab'
    );
    const fieldClass = 'w-full rounded-lg border border-surface-200 bg-white px-3 py-2';

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (saving || !reason.trim() || !supplierId || !cost) return;
        setSaving(true);
        try {
            const { error } = await supabase.rpc('admin_convert_order_to_external_lab', {
                p_order_id: order.id,
                p_supplier_id: supplierId,
                p_lab_cost: Number(cost),
                p_reason: reason.trim(),
            });
            if (error) {
                toastError(error.message);
                return;
            }
            success('تم تحويل الحالة للمعمل الخارجي وإغلاق مراحل الإنتاج المفتوحة');
            onSuccess();
        } catch {
            toastError('تعذر تحويل الحالة. حاول مرة أخرى.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} dir="rtl" className="mx-auto max-w-lg space-y-4 p-4">
            <h2 className="text-lg font-bold">تحويل إلى معمل خارجي · {order.caseId}</h2>
            <p className="text-sm text-surface-600">يُغلق التحويل مراحل الإنتاج المفتوحة ويحتفظ بالتصميم المكتمل وتكلفته.</p>
            <fieldset disabled={saving} className="space-y-3">
                <label className="block space-y-1 text-sm">
                    <span>المعمل الخارجي</span>
                    <select required value={supplierId} onChange={event => setSupplierId(event.target.value)} className={fieldClass}>
                        <option value="">اختر المعمل</option>
                        {labs.map(lab => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
                    </select>
                </label>
                <label className="block space-y-1 text-sm">
                    <span>تكلفة المعمل بالجنيه</span>
                    <input required type="number" min="0" max="9999999999.99" step="0.01" value={cost}
                        onChange={event => setCost(event.target.value)} className={fieldClass} />
                </label>
                <label className="block space-y-1 text-sm">
                    <span>سبب التحويل</span>
                    <textarea required value={reason} onChange={event => setReason(event.target.value)} className={fieldClass} />
                </label>
            </fieldset>
            <div className="flex gap-2">
                <Button type="submit" disabled={saving || !reason.trim() || !supplierId || !cost}>
                    {saving ? 'جاري التحويل…' : 'تأكيد التحويل'}
                </Button>
                <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>رجوع</Button>
            </div>
        </form>
    );
}
