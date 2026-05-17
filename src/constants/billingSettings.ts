export const BILLING_ENTITY_TYPES = {
    doctor: 'doctor',
    externalLab: 'external_lab',
    designer: 'designer',
} as const;

export type BillingEntityType = typeof BILLING_ENTITY_TYPES[keyof typeof BILLING_ENTITY_TYPES];

export const BILLING_MODES = {
    perOrder: 'per_order',
    monthlyCycle: 'monthly_cycle',
} as const;

export type BillingMode = typeof BILLING_MODES[keyof typeof BILLING_MODES];

export interface EntityBillingSettings {
    id?: string;
    entityType: BillingEntityType;
    entityId: string;
    billingMode: BillingMode;
    billingDay?: number | null;
    perOrderDueDays: number;
    paymentTermsNotes?: string | null;
    autoApplyCredit: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface DueDateInput {
    billingMode: BillingMode;
    billingDay?: number | null;
    triggerDate: string | Date;
    perOrderDueDays?: number | null;
}

export interface FinancialPeriodRange {
    periodStart: string;
    periodEnd: string;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

function assertNever(value: never): never {
    throw new Error(`Unexpected value: ${value}`);
}

export function isBillingEntityType(value: string): value is BillingEntityType {
    return Object.values(BILLING_ENTITY_TYPES).includes(value as BillingEntityType);
}

export function isBillingMode(value: string): value is BillingMode {
    return Object.values(BILLING_MODES).includes(value as BillingMode);
}

export function validateBillingEntityType(value: string): BillingEntityType {
    if (!isBillingEntityType(value)) {
        throw new Error('Invalid billing entity type');
    }
    return value;
}

export function validateBillingMode(value: string): BillingMode {
    if (!isBillingMode(value)) {
        throw new Error('Invalid billing mode');
    }
    return value;
}

export function validateBillingDay(billingDay?: number | null): number | null {
    if (billingDay === undefined || billingDay === null) return null;
    if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
        throw new Error('Invalid billing day');
    }
    return billingDay;
}

export function getDefaultBillingSettings(entityType: BillingEntityType, entityId = ''): EntityBillingSettings {
    return {
        entityType,
        entityId,
        billingMode: BILLING_MODES.perOrder,
        billingDay: null,
        perOrderDueDays: 7,
        paymentTermsNotes: null,
        autoApplyCredit: true,
    };
}

function dateParts(date: string | Date): { year: number; month: number; day: number } {
    if (date instanceof Date) {
        return {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
        };
    }

    const match = date.match(DATE_ONLY_PATTERN);
    if (!match) {
        throw new Error('Invalid trigger date');
    }

    return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
    };
}

function toDateString(year: number, month: number, day: number): string {
    return [
        String(year).padStart(4, '0'),
        String(month).padStart(2, '0'),
        String(day).padStart(2, '0'),
    ].join('-');
}

function addDays(date: string | Date, days: number): string {
    const parts = dateParts(date);
    const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    utcDate.setUTCDate(utcDate.getUTCDate() + days);
    return toDateString(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1, utcDate.getUTCDate());
}

function lastDayOfMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function normalizeBillingDay(year: number, month: number, billingDay: number): number {
    const validBillingDay = validateBillingDay(billingDay);
    if (validBillingDay === null) {
        throw new Error('Billing day is required');
    }
    return Math.min(validBillingDay, lastDayOfMonth(year, month));
}

export function calculateMonthlyCycleDueDate(triggerDate: string | Date, billingDay: number): string {
    const trigger = dateParts(triggerDate);
    const targetMonth = trigger.month === 12 ? 1 : trigger.month + 1;
    const targetYear = trigger.month === 12 ? trigger.year + 1 : trigger.year;
    const dueDay = normalizeBillingDay(targetYear, targetMonth, billingDay);

    return toDateString(targetYear, targetMonth, dueDay);
}

export function calculateDueDate(input: DueDateInput): string {
    validateBillingMode(input.billingMode);

    if (input.billingMode === BILLING_MODES.perOrder) {
        return addDays(input.triggerDate, input.perOrderDueDays ?? 7);
    }

    if (input.billingMode === BILLING_MODES.monthlyCycle) {
        const billingDay = validateBillingDay(input.billingDay);
        if (billingDay === null) {
            throw new Error('Billing day is required for monthly cycle billing');
        }
        return calculateMonthlyCycleDueDate(input.triggerDate, billingDay);
    }

    return assertNever(input.billingMode);
}

export function getFinancialPeriodRange(triggerDate: string | Date, billingMode: BillingMode): FinancialPeriodRange {
    validateBillingMode(billingMode);
    const trigger = dateParts(triggerDate);

    if (billingMode === BILLING_MODES.perOrder) {
        const date = toDateString(trigger.year, trigger.month, trigger.day);
        return { periodStart: date, periodEnd: date };
    }

    return {
        periodStart: toDateString(trigger.year, trigger.month, 1),
        periodEnd: toDateString(trigger.year, trigger.month, lastDayOfMonth(trigger.year, trigger.month)),
    };
}

export function validateBillingSettings(settings: Partial<EntityBillingSettings>): void {
    if (settings.entityType) validateBillingEntityType(settings.entityType);
    if (settings.billingMode) validateBillingMode(settings.billingMode);
    validateBillingDay(settings.billingDay);

    if (settings.billingMode === BILLING_MODES.monthlyCycle && settings.billingDay == null) {
        throw new Error('Billing day is required for monthly cycle billing');
    }

    if (
        settings.perOrderDueDays !== undefined
        && (!Number.isInteger(settings.perOrderDueDays) || settings.perOrderDueDays < 0 || settings.perOrderDueDays > 365)
    ) {
        throw new Error('Invalid per-order due days');
    }
}
