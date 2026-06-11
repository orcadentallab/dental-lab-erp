import type { Order } from '../services/db';
import {
    BILLING_ENTITY_TYPES,
    type BillingEntityType,
    type EntityBillingSettings,
} from './billingSettings';
import {
    getProductionStatus,
    getEffectiveIssueState,
    isDeliveredForDoctorReceivable,
    isFinalReady,
    isTryInReady,
} from './orderLifecycle';

export const OBLIGATION_DIRECTIONS = {
    receivable: 'receivable',
    payable: 'payable',
} as const;

export type ObligationDirection = typeof OBLIGATION_DIRECTIONS[keyof typeof OBLIGATION_DIRECTIONS];

export const OBLIGATION_TRIGGER_TYPES = {
    doctorDelivered: 'doctor_delivered',
    externalLabReady: 'external_lab_ready',
    externalLabIssueSettlement: 'external_lab_issue_settlement',
    designerApproved: 'designer_approved',
    manualAdjustment: 'manual_adjustment',
} as const;

export type ObligationTriggerType = typeof OBLIGATION_TRIGGER_TYPES[keyof typeof OBLIGATION_TRIGGER_TYPES];

export const OBLIGATION_STATUSES = {
    unpaid: 'unpaid',
    partiallyPaid: 'partially_paid',
    paid: 'paid',
    void: 'void',
    writtenOff: 'written_off',
} as const;

export type ObligationStatus = typeof OBLIGATION_STATUSES[keyof typeof OBLIGATION_STATUSES];

export const OBLIGATION_SOURCES = {
    order: 'order',
    remake: 'remake',
    adjustment: 'adjustment',
    backfill: 'backfill',
} as const;

export type ObligationSource = typeof OBLIGATION_SOURCES[keyof typeof OBLIGATION_SOURCES];

export const FINANCIAL_OBLIGATIONS_FLAGS = {
    trackingEnabled: true,
    reportingEnabled: false,
} as const;

export const DOCTOR_RECEIVABLE_OBLIGATION_FAILURE_MESSAGE =
    'Order delivered, but doctor receivable obligation could not be created.';

export const EXTERNAL_LAB_PAYABLE_OBLIGATION_FAILURE_MESSAGE =
    'Order marked Ready, but external lab payable obligation could not be created.';

export const EXTERNAL_LAB_PAYABLE_VOID_FAILURE_MESSAGE =
    'Order left Final Ready/Delivered workflow, but shadow external lab payable obligation could not be voided.';

export interface FinancialObligationCandidate {
    orderId: string;
    entityType: BillingEntityType;
    entityId: string;
    direction: ObligationDirection;
    triggerType: ObligationTriggerType;
    triggerStatus?: string | null;
    triggerDate: string;
    dueDate?: string;
    grossAmount: number;
    adjustmentAmount?: number;
    source: ObligationSource;
    notes?: string | null;
    metadata?: Record<string, unknown>;
}

type CandidateOrder = Partial<Order> & {
    status?: string;
    delivery_type?: string;
    actual_delivery_date?: string;
    created_at?: string;
    defaultCost?: number | null;
    productionStatus?: string;
    production_status?: string;
    issueState?: string;
    issue_state?: string;
};

export type LabCostSource = 'manual' | 'default' | 'legacy_manual_inferred' | 'unknown';

export function getLabCostMetadata(order: CandidateOrder, isSalariedDesigner = false): {
    cost: number;
    manualCost: number | null;
    defaultCost: number | null;
    costSource: LabCostSource;
} {
    const rawCost = order.cost || 0;
    const manualCost = order.manualCost ?? null;
    const defaultCost = order.defaultCost ?? null;

    if (manualCost !== null) {
        return { cost: manualCost, manualCost, defaultCost, costSource: 'manual' };
    }

    if (order.workflowType === 'split') {
        const designPrice = order.designPrice || 0;
        // For salaried designers, the design price is never included in order.cost (which represents the milling cost only).
        // For per-piece designers, the design price is included in order.cost.
        const isDesignPriceIncluded = !isSalariedDesigner;
        const effectiveDesignPrice = isDesignPriceIncluded ? designPrice : 0;
        const labCost = Math.max(0, rawCost - effectiveDesignPrice);
        return {
            cost: labCost,
            manualCost,
            defaultCost,
            costSource: 'default',
        };
    }

    if (defaultCost !== null) {
        return {
            cost: rawCost,
            manualCost,
            defaultCost,
            costSource: rawCost === defaultCost ? 'default' : 'legacy_manual_inferred',
        };
    }

    return { cost: rawCost, manualCost, defaultCost, costSource: 'unknown' };
}

export function getOrderTriggerDate(order: CandidateOrder): string {
    const date = order.actualDeliveryDate
        || order.actual_delivery_date
        || order.deliveryDate
        || order.createdAt
        || order.created_at;

    return (date || new Date().toISOString()).split('T')[0];
}

export function buildDoctorReceivableCandidate(order: CandidateOrder): FinancialObligationCandidate | null {
    if (!order.id || !order.doctorId || !isDeliveredForDoctorReceivable(order)) {
        return null;
    }

    return {
        orderId: order.id,
        entityType: BILLING_ENTITY_TYPES.doctor,
        entityId: order.doctorId,
        direction: OBLIGATION_DIRECTIONS.receivable,
        triggerType: OBLIGATION_TRIGGER_TYPES.doctorDelivered,
        triggerStatus: order.status || null,
        triggerDate: getOrderTriggerDate(order),
        grossAmount: order.totalPrice || 0,
        adjustmentAmount: 0,
        source: OBLIGATION_SOURCES.order,
        metadata: {
            caseId: order.caseId || null,
            productionStatus: getProductionStatus(order),
            totalPrice: order.totalPrice || 0,
        },
    };
}

export function buildExternalLabPayableCandidate(
    order: CandidateOrder,
    options: { impliedFinalReady?: boolean; triggerDate?: string } = {},
    isSalariedDesigner = false
): FinancialObligationCandidate | null {
    const isEligibleFinalReady = isFinalReady(order) || options.impliedFinalReady === true;
    const labCostMetadata = getLabCostMetadata(order, isSalariedDesigner);

    if (!order.id || !order.supplierId || !isEligibleFinalReady || labCostMetadata.cost <= 0) {
        return null;
    }

    return {
        orderId: order.id,
        entityType: BILLING_ENTITY_TYPES.externalLab,
        entityId: order.supplierId,
        direction: OBLIGATION_DIRECTIONS.payable,
        triggerType: OBLIGATION_TRIGGER_TYPES.externalLabReady,
        triggerStatus: order.status || null,
        triggerDate: options.triggerDate || getOrderTriggerDate(order),
        grossAmount: labCostMetadata.cost,
        adjustmentAmount: 0,
        source: OBLIGATION_SOURCES.order,
        metadata: {
            caseId: order.caseId || null,
            productionStatus: getProductionStatus(order),
            ...labCostMetadata,
            deliveryType: order.deliveryType || order.delivery_type || null,
            impliedFinalReady: options.impliedFinalReady === true,
        },
    };
}

export function buildDesignerPayableCandidate(
    order?: CandidateOrder,
    options: { triggerDate?: string } = {},
    isSalariedDesigner = false
): FinancialObligationCandidate | null {
    if (
        !order
        || !order.id
        || !order.designerId
        || order.workflowType !== 'split'
        || order.designStatus !== 'completed'
    ) {
        return null;
    }

    const designPrice = isSalariedDesigner ? 0 : (order.designPrice ?? 0);
    if (!isSalariedDesigner && designPrice <= 0) return null;

    return {
        orderId: order.id,
        entityType: BILLING_ENTITY_TYPES.designer,
        entityId: order.designerId,
        direction: OBLIGATION_DIRECTIONS.payable,
        triggerType: OBLIGATION_TRIGGER_TYPES.designerApproved,
        triggerStatus: order.designStatus ?? null,
        triggerDate: options.triggerDate || getOrderTriggerDate(order),
        grossAmount: designPrice,
        adjustmentAmount: 0,
        source: OBLIGATION_SOURCES.order,
        metadata: {
            caseId: order.caseId || null,
            designPrice: order.designPrice ?? 0,
            workflowType: order.workflowType,
            isSalariedDesigner,
        },
    };
}

export function shouldCreateDoctorReceivableObligationForStatusChange(
    previousStatus: string | undefined,
    newStatus: string | undefined
): boolean {
    return previousStatus !== newStatus && newStatus === 'Delivered';
}

export function shouldCreateExternalLabPayableObligationForStatusChange(
    previousOrder: CandidateOrder,
    updatedOrder: CandidateOrder
): { shouldCreate: boolean; impliedFinalReady: boolean } {
    const becameFinalReady = !isFinalReady(previousOrder) && isFinalReady(updatedOrder);
    const directDeliveredImpliesFinalReady =
        getProductionStatus(updatedOrder) === 'final_delivered'
        && !isFinalReady(previousOrder)
        && !isTryInReady(previousOrder);

    return {
        shouldCreate: becameFinalReady || directDeliveredImpliesFinalReady,
        impliedFinalReady: directDeliveredImpliesFinalReady,
    };
}

/**
 * Returns true when the order has just entered designStatus='completed' for the
 * first time – the trigger point for a designer payable obligation.
 */
export function shouldCreateDesignerPayableObligationForDesignStatusChange(
    previousOrder: CandidateOrder,
    updatedOrder: CandidateOrder
): boolean {
    return (
        updatedOrder.workflowType === 'split'
        && !!updatedOrder.designerId
        && (updatedOrder.designPrice ?? 0) > 0
        && previousOrder.designStatus !== 'completed'
        && updatedOrder.designStatus === 'completed'
    );
}

/**
 * Returns true when a previously-completed designer payable must be voided
 * because the design was reverted (e.g. returned for adjustments).
 */
export function shouldVoidDesignerPayableObligationForDesignStatusChange(
    previousOrder: CandidateOrder,
    updatedOrder: CandidateOrder
): boolean {
    return (
        previousOrder.designStatus === 'completed'
        && updatedOrder.designStatus !== 'completed'
        && updatedOrder.designStatus !== undefined
    );
}

export function shouldVoidExternalLabReadyObligationForStatusChange(
    previousOrder: CandidateOrder,
    updatedOrder: CandidateOrder
): boolean {
    const issueState = getEffectiveIssueState(updatedOrder);
    if (['returned', 'rejected', 'cancelled', 'on_hold', 'redo'].includes(issueState)) {
        return false;
    }

    const previouslyNormalFinalReadyEligible =
        isFinalReady(previousOrder) || getProductionStatus(previousOrder) === 'final_delivered';
    const stillNormalFinalReadyEligible =
        isFinalReady(updatedOrder) || getProductionStatus(updatedOrder) === 'final_delivered';

    return previouslyNormalFinalReadyEligible && !stillNormalFinalReadyEligible;
}

export function shouldVoidDoctorReceivableForStatusOrIssueChange(
    previousOrder: CandidateOrder,
    updatedOrder: CandidateOrder
): boolean {
    const updatedIssueState = getEffectiveIssueState(updatedOrder);
    if (['returned', 'on_hold'].includes(updatedIssueState)) {
        return false;
    }

    const previousProductionStatus = getProductionStatus(previousOrder);
    const updatedProductionStatus = getProductionStatus(updatedOrder);
    const previousIssueState = getEffectiveIssueState(previousOrder);
    const previouslyFinalDelivered =
        getProductionStatus(previousOrder) === 'final_delivered'
        || previousProductionStatus === 'final_delivered';
    const stillFinalDelivered =
        isDeliveredForDoctorReceivable(updatedOrder)
        && updatedProductionStatus !== 'not_started'
        && !['rejected', 'cancelled', 'redo'].includes(updatedIssueState);
    const enteredIssueState =
        previousIssueState !== updatedIssueState
        && ['rejected', 'cancelled', 'redo'].includes(updatedIssueState);

    return previouslyFinalDelivered && (!stillFinalDelivered || enteredIssueState);
}

export function calculateNetAmount(grossAmount: number, adjustmentAmount = 0): number {
    return grossAmount + adjustmentAmount;
}

export function validateFinancialObligationAmounts(input: {
    grossAmount: number;
    adjustmentAmount?: number;
    allocatedAmount?: number;
}): void {
    const grossAmount = input.grossAmount;
    const adjustmentAmount = input.adjustmentAmount ?? 0;
    const allocatedAmount = input.allocatedAmount ?? 0;
    const netAmount = calculateNetAmount(grossAmount, adjustmentAmount);

    if (grossAmount < 0) throw new Error('Gross amount must be non-negative');
    if (allocatedAmount < 0) throw new Error('Allocated amount must be non-negative');
    if (netAmount < 0) throw new Error('Net amount must be non-negative');
    if (allocatedAmount > netAmount) throw new Error('Allocated amount cannot exceed net amount');
}

export function applyDueDateToCandidate(
    candidate: FinancialObligationCandidate,
    settings: EntityBillingSettings,
    dueDate: string
): FinancialObligationCandidate {
    return {
        ...candidate,
        dueDate,
        metadata: {
            ...candidate.metadata,
            billingMode: settings.billingMode,
            billingDay: settings.billingDay ?? null,
            perOrderDueDays: settings.perOrderDueDays,
        },
    };
}
