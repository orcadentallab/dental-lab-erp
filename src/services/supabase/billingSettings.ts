import {
    BILLING_ENTITY_TYPES,
    BILLING_MODES,
    getDefaultBillingSettings,
    validateBillingEntityType,
    validateBillingSettings,
    type BillingEntityType,
    type EntityBillingSettings,
} from '../../constants/billingSettings';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';

type EntityBillingSettingsRow = {
    id: string;
    entity_type: BillingEntityType;
    entity_id: string;
    billing_mode: EntityBillingSettings['billingMode'];
    billing_day: number | null;
    per_order_due_days: number;
    payment_terms_notes: string | null;
    auto_apply_credit: boolean;
    credit_limit: number | string | null;
    stop_work_threshold: number | string | null;
    created_at: string;
    updated_at: string;
};

export type UpsertEntityBillingSettingsInput = Omit<EntityBillingSettings, 'id' | 'createdAt' | 'updatedAt'>;

async function getSupabaseClient() {
    const { supabase } = await import('../../lib/supabase');
    return supabase;
}

/** NUMERIC columns arrive from PostgREST as strings; keep null distinct from 0. */
function toNullableNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function dbToBillingSettings(row: EntityBillingSettingsRow): EntityBillingSettings {
    return {
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        billingMode: row.billing_mode,
        billingDay: row.billing_day,
        perOrderDueDays: row.per_order_due_days,
        paymentTermsNotes: row.payment_terms_notes,
        autoApplyCredit: row.auto_apply_credit,
        creditLimit: toNullableNumber(row.credit_limit),
        stopWorkThreshold: toNullableNumber(row.stop_work_threshold),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function billingSettingsToDb(settings: UpsertEntityBillingSettingsInput) {
    return {
        entity_type: settings.entityType,
        entity_id: settings.entityId,
        billing_mode: settings.billingMode,
        billing_day: settings.billingMode === BILLING_MODES.monthlyCycle ? settings.billingDay : null,
        per_order_due_days: settings.perOrderDueDays,
        payment_terms_notes: settings.paymentTermsNotes || null,
        auto_apply_credit: settings.autoApplyCredit,
        credit_limit: settings.creditLimit ?? null,
        stop_work_threshold: settings.stopWorkThreshold ?? null,
    };
}

export async function validateBillingEntityExists(entityType: BillingEntityType, entityId: string): Promise<void> {
    if (!entityId) {
        throw new ValidationError('معرف الجهة مطلوب لإعدادات الفوترة');
    }

    const supabase = await getSupabaseClient();
    const tableByType: Record<BillingEntityType, string> = {
        [BILLING_ENTITY_TYPES.doctor]: 'doctors',
        [BILLING_ENTITY_TYPES.externalLab]: 'suppliers',
        [BILLING_ENTITY_TYPES.designer]: 'users',
    };

    const { data, error } = await supabase
        .from(tableByType[entityType])
        .select('id')
        .eq('id', entityId)
        .maybeSingle();

    if (error) {
        throw ErrorHandler.handle(error, 'validateBillingEntityExists');
    }

    if (!data) {
        throw new ValidationError('الجهة غير موجودة، لا يمكن حفظ إعدادات الفوترة');
    }
}

export async function getEntityBillingSettings(
    entityType: BillingEntityType,
    entityId: string
): Promise<EntityBillingSettings> {
    validateBillingEntityType(entityType);

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
        .from('entity_billing_settings')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .maybeSingle();

    if (error) {
        throw ErrorHandler.handle(error, 'getEntityBillingSettings');
    }

    return data
        ? dbToBillingSettings(data as EntityBillingSettingsRow)
        : getDefaultBillingSettings(entityType, entityId);
}

export async function upsertEntityBillingSettings(
    settings: UpsertEntityBillingSettingsInput
): Promise<EntityBillingSettings> {
    validateBillingEntityType(settings.entityType);
    validateBillingSettings(settings);
    await validateBillingEntityExists(settings.entityType, settings.entityId);

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
        .from('entity_billing_settings')
        .upsert(billingSettingsToDb(settings), { onConflict: 'entity_type,entity_id' })
        .select('*')
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'upsertEntityBillingSettings');
    }

    return dbToBillingSettings(data as EntityBillingSettingsRow);
}
