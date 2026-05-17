import { BILLING_ENTITY_TYPES } from './billingSettings';
import {
    OBLIGATION_DIRECTIONS,
    OBLIGATION_STATUSES,
    type ObligationDirection,
    type ObligationTriggerType,
} from './financialObligations';

export const ALLOCATION_MODES = {
    fifo: 'fifo',
} as const;

export type AllocationMode = typeof ALLOCATION_MODES[keyof typeof ALLOCATION_MODES];

export type AllocationPreviewEntityType =
    typeof BILLING_ENTITY_TYPES.doctor
    | typeof BILLING_ENTITY_TYPES.externalLab;

export interface AllocationPreviewParams {
    entityType: AllocationPreviewEntityType;
    entityId: string;
    direction: ObligationDirection;
    amount: number;
    paymentDate?: string;
    mode?: AllocationMode;
    includeNotDue?: boolean;
    transactionId?: string;
}

export interface AllocationPreviewObligation {
    id: string;
    orderId: string;
    caseId?: string | null;
    patientName?: string | null;
    triggerType: ObligationTriggerType;
    dueDate: string;
    triggerDate: string;
    netAmount: number;
    allocatedAmount: number;
    remainingAmount: number;
    status: string;
    createdAt: string;
}

export interface AllocationPreviewItem {
    obligationId: string;
    orderId: string;
    caseId?: string | null;
    patientName?: string | null;
    triggerType: ObligationTriggerType;
    dueDate: string;
    triggerDate: string;
    netAmount: number;
    alreadyAllocatedAmount: number;
    currentRemainingAmount: number;
    previewAllocatedAmount: number;
    previewRemainingAmountAfter: number;
}

export interface AllocationPreviewResult {
    entityType: AllocationPreviewEntityType;
    entityId: string;
    direction: ObligationDirection;
    amount: number;
    mode: AllocationMode;
    transactionId?: string | null;
    allocationPlan: AllocationPreviewItem[];
    totalAllocated: number;
    unallocatedAmount: number;
    creditPreviewAmount: number;
    warnings: string[];
}

export const DOCTOR_OVERPAYMENT_PREVIEW_WARNING =
    'Payment exceeds open doctor receivables; excess would become doctor credit/prepayment.';

export const SUPPLIER_OVERPAYMENT_PREVIEW_WARNING =
    'Payment exceeds open supplier payables; review required.';

const ACTIVE_PREVIEW_STATUSES = new Set<string>([
    OBLIGATION_STATUSES.unpaid,
    OBLIGATION_STATUSES.partiallyPaid,
]);

export function validateAllocationPreviewParams(params: AllocationPreviewParams): void {
    if (![BILLING_ENTITY_TYPES.doctor, BILLING_ENTITY_TYPES.externalLab].includes(params.entityType)) {
        throw new Error('Invalid allocation preview entity type');
    }

    if (!params.entityId) {
        throw new Error('Entity id is required');
    }

    if (![OBLIGATION_DIRECTIONS.receivable, OBLIGATION_DIRECTIONS.payable].includes(params.direction)) {
        throw new Error('Invalid allocation preview direction');
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
        throw new Error('Allocation preview amount must be greater than zero');
    }

    if (params.mode && params.mode !== ALLOCATION_MODES.fifo) {
        throw new Error('Invalid allocation preview mode');
    }
}

function normalizeDate(date?: string): string {
    return (date || new Date().toISOString()).split('T')[0];
}

function compareDate(a: string, b: string): number {
    return normalizeDate(a).localeCompare(normalizeDate(b));
}

export function sortObligationsForFifoPreview(
    obligations: AllocationPreviewObligation[]
): AllocationPreviewObligation[] {
    return [...obligations].sort((a, b) =>
        compareDate(a.dueDate, b.dueDate)
        || compareDate(a.triggerDate, b.triggerDate)
        || compareDate(a.createdAt, b.createdAt)
    );
}

export function filterOpenObligationsForPreview(
    obligations: AllocationPreviewObligation[],
    options: { includeNotDue: boolean; paymentDate?: string }
): AllocationPreviewObligation[] {
    const paymentDate = normalizeDate(options.paymentDate);

    return obligations.filter(obligation => {
        if (!ACTIVE_PREVIEW_STATUSES.has(obligation.status)) return false;
        if (obligation.status === OBLIGATION_STATUSES.void) return false;
        if ((obligation.remainingAmount || 0) <= 0) return false;
        if (!options.includeNotDue && normalizeDate(obligation.dueDate) > paymentDate) return false;
        return true;
    });
}

export function buildFifoAllocationPreview(
    params: AllocationPreviewParams,
    obligations: AllocationPreviewObligation[]
): AllocationPreviewResult {
    validateAllocationPreviewParams(params);

    const mode = params.mode || ALLOCATION_MODES.fifo;
    const includeNotDue = params.includeNotDue ?? true;
    const openObligations = sortObligationsForFifoPreview(
        filterOpenObligationsForPreview(obligations, {
            includeNotDue,
            paymentDate: params.paymentDate,
        })
    );

    let remainingPayment = params.amount;
    const allocationPlan: AllocationPreviewItem[] = [];

    for (const obligation of openObligations) {
        if (remainingPayment <= 0) break;

        const currentRemainingAmount = Math.max(0, obligation.remainingAmount || 0);
        const previewAllocatedAmount = Math.min(remainingPayment, currentRemainingAmount);
        if (previewAllocatedAmount <= 0) continue;

        allocationPlan.push({
            obligationId: obligation.id,
            orderId: obligation.orderId,
            caseId: obligation.caseId || null,
            patientName: obligation.patientName || null,
            triggerType: obligation.triggerType,
            dueDate: obligation.dueDate,
            triggerDate: obligation.triggerDate,
            netAmount: obligation.netAmount,
            alreadyAllocatedAmount: obligation.allocatedAmount,
            currentRemainingAmount,
            previewAllocatedAmount,
            previewRemainingAmountAfter: currentRemainingAmount - previewAllocatedAmount,
        });

        remainingPayment -= previewAllocatedAmount;
    }

    const totalAllocated = allocationPlan.reduce((sum, item) => sum + item.previewAllocatedAmount, 0);
    const unallocatedAmount = Math.max(0, params.amount - totalAllocated);
    const warnings: string[] = [];
    let creditPreviewAmount = 0;

    if (
        unallocatedAmount > 0
        && params.entityType === BILLING_ENTITY_TYPES.doctor
        && params.direction === OBLIGATION_DIRECTIONS.receivable
    ) {
        creditPreviewAmount = unallocatedAmount;
        warnings.push(DOCTOR_OVERPAYMENT_PREVIEW_WARNING);
    }

    if (
        unallocatedAmount > 0
        && params.entityType === BILLING_ENTITY_TYPES.externalLab
        && params.direction === OBLIGATION_DIRECTIONS.payable
    ) {
        warnings.push(SUPPLIER_OVERPAYMENT_PREVIEW_WARNING);
    }

    return {
        entityType: params.entityType,
        entityId: params.entityId,
        direction: params.direction,
        amount: params.amount,
        mode,
        transactionId: params.transactionId || null,
        allocationPlan,
        totalAllocated,
        unallocatedAmount,
        creditPreviewAmount,
        warnings,
    };
}
