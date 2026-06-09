import { useEffect, useState } from 'react';
import { CheckCircle, CreditCard, Loader2, Save, AlertTriangle } from 'lucide-react';
import { BILLING_MODES, type BillingMode } from '../../constants/billingSettings';
import { db, type EntityBillingSettings } from '../../services/db';

type BillingEntityType = EntityBillingSettings['entityType'];

interface BillingSettingsPanelProps {
    entityType: BillingEntityType;
    entityId: string;
    title: string;
    canEdit: boolean;
}

const COPY_BY_ENTITY: Record<BillingEntityType, {
    perOrder: string;
    monthlyCycle: string;
    billingDay: string;
    perOrderDueDays: string;
    paymentTermsNotes: string;
    autoApplyCredit: string;
}> = {
    doctor: {
        perOrder: 'حالة بحالة',
        monthlyCycle: 'تحصيل شهري',
        billingDay: 'يوم التحصيل',
        perOrderDueDays: 'عدد أيام السماح',
        paymentTermsNotes: 'ملاحظات التحصيل',
        autoApplyCredit: 'استخدام الرصيد الدائن تلقائيًا',
    },
    external_lab: {
        perOrder: 'حالة بحالة',
        monthlyCycle: 'دفع شهري',
        billingDay: 'يوم الدفع',
        perOrderDueDays: 'عدد أيام السماح',
        paymentTermsNotes: 'ملاحظات الدفع',
        autoApplyCredit: 'استخدام الرصيد الدائن تلقائيًا',
    },
    designer: {
        perOrder: 'حالة بحالة',
        monthlyCycle: 'دفع شهري',
        billingDay: 'يوم الدفع',
        perOrderDueDays: 'عدد أيام السماح',
        paymentTermsNotes: 'ملاحظات الدفع',
        autoApplyCredit: 'استخدام الرصيد الدائن تلقائيًا',
    },
};

const defaultSettings = (entityType: BillingEntityType, entityId: string): EntityBillingSettings => ({
    entityType,
    entityId,
    billingMode: BILLING_MODES.perOrder,
    billingDay: null,
    perOrderDueDays: 7,
    paymentTermsNotes: null,
    autoApplyCredit: true,
});

function validateSettings(settings: EntityBillingSettings): string | null {
    if (settings.billingMode === BILLING_MODES.monthlyCycle) {
        if (!settings.billingDay) return 'يوم التحصيل/الدفع مطلوب عند اختيار النظام الشهري';
        if (settings.billingDay < 1 || settings.billingDay > 31) return 'يوم التحصيل/الدفع يجب أن يكون من 1 إلى 31';
    }

    if (!Number.isInteger(settings.perOrderDueDays) || settings.perOrderDueDays < 0 || settings.perOrderDueDays > 365) {
        return 'عدد أيام السماح يجب أن يكون من 0 إلى 365';
    }

    return null;
}

export default function BillingSettingsPanel({ entityType, entityId, title, canEdit }: BillingSettingsPanelProps) {
    const copy = COPY_BY_ENTITY[entityType];
    const [settings, setSettings] = useState<EntityBillingSettings>(() => defaultSettings(entityType, entityId));
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;

        const loadSettings = async () => {
            if (!entityId) return;

            setIsLoading(true);
            setError(null);
            setSuccess(null);
            try {
                const data = await db.getEntityBillingSettings(entityType, entityId);
                if (isMounted) setSettings(data);
            } catch (err) {
                console.error('Failed to load billing settings:', err);
                if (isMounted) {
                    setSettings(defaultSettings(entityType, entityId));
                    setError('تعذر تحميل إعدادات الفوترة');
                }
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        loadSettings();

        return () => {
            isMounted = false;
        };
    }, [entityType, entityId]);

    const updateSettings = (updates: Partial<EntityBillingSettings>) => {
        setSettings(prev => ({ ...prev, ...updates }));
        setError(null);
        setSuccess(null);
    };

    const handleSave = async () => {
        if (!canEdit || !entityId) return;

        const validationError = validateSettings(settings);
        if (validationError) {
            setError(validationError);
            setSuccess(null);
            return;
        }

        setIsSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const saved = await db.upsertEntityBillingSettings({
                entityType,
                entityId,
                billingMode: settings.billingMode,
                billingDay: settings.billingMode === BILLING_MODES.monthlyCycle ? settings.billingDay : null,
                perOrderDueDays: settings.perOrderDueDays,
                paymentTermsNotes: settings.paymentTermsNotes || null,
                autoApplyCredit: settings.autoApplyCredit,
            });
            setSettings(saved);
            setSuccess('تم حفظ إعدادات الفوترة بنجاح');
        } catch (err) {
            console.error('Failed to save billing settings:', err);
            setError('تعذر حفظ إعدادات الفوترة');
        } finally {
            setIsSaving(false);
        }
    };

    const disabled = !canEdit || isLoading || isSaving;

    return (
        <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
            <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
                        <CreditCard size={18} />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-800">{title}</h3>
                        {!canEdit && <p className="text-xs text-gray-500 mt-0.5">عرض فقط</p>}
                    </div>
                </div>
                {isLoading && <Loader2 className="animate-spin text-blue-500" size={18} />}
            </div>

            {isLoading ? (
                <p className="text-sm text-gray-500">جاري تحميل إعدادات الفوترة...</p>
            ) : (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">النظام</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(() => {
                                const options: { value: BillingMode; label: string }[] = [
                                    { value: BILLING_MODES.perOrder, label: copy.perOrder },
                                    { value: BILLING_MODES.monthlyCycle, label: copy.monthlyCycle },
                                ];
                                return options.map(option => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => updateSettings({
                                            billingMode: option.value,
                                            billingDay: option.value === BILLING_MODES.monthlyCycle ? settings.billingDay : null,
                                        })}
                                        className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${settings.billingMode === option.value
                                            ? 'border-blue-500 bg-white text-blue-700 shadow-sm'
                                            : 'border-gray-200 bg-white/60 text-gray-500 hover:bg-white'
                                            } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
                                    >
                                        {option.label}
                                    </button>
                                ));
                            })()}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {settings.billingMode === BILLING_MODES.monthlyCycle && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{copy.billingDay}</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="31"
                                    required
                                    disabled={disabled}
                                    value={settings.billingDay ?? ''}
                                    onChange={e => updateSettings({ billingDay: e.target.value === '' ? null : Number(e.target.value) })}
                                    className="w-full p-2 border border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{copy.perOrderDueDays}</label>
                            <input
                                type="number"
                                min="0"
                                max="365"
                                disabled={disabled}
                                value={settings.perOrderDueDays}
                                onChange={e => updateSettings({ perOrderDueDays: Number(e.target.value) })}
                                className="w-full p-2 border border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{copy.paymentTermsNotes}</label>
                        <textarea
                            disabled={disabled}
                            value={settings.paymentTermsNotes || ''}
                            onChange={e => updateSettings({ paymentTermsNotes: e.target.value })}
                            rows={2}
                            className="w-full p-2 border border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
                        />
                    </div>

                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input
                            type="checkbox"
                            disabled={disabled}
                            checked={settings.autoApplyCredit}
                            onChange={e => updateSettings({ autoApplyCredit: e.target.checked })}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                        />
                        {copy.autoApplyCredit}
                    </label>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                            <AlertTriangle size={16} />
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-700">
                            <CheckCircle size={16} />
                            {success}
                        </div>
                    )}

                    {canEdit && (
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={disabled}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                            حفظ إعدادات الفوترة
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
