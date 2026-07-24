import type { Order, Transaction } from '../services/db';
import {
    isProductionStatus,
    isIssueState,
    type ProductionStatus,
    type IssueState,
    type CaseLocation,
} from './workflow';
import { canChangeProductionStatus } from '../lib/workflowPermissions';

export const LEGACY_ORDER_STATUSES = {
    completed: 'Completed',
    delivered: 'Delivered',
    ready: 'Ready',
    tryIn: 'Try In',
    tryInApproved: 'Try In Approved',
    underProduction: 'Under Production',
    inProgress: 'In Progress',
    underDesign: 'Under Design',
    waitingDrApproval: 'Waiting Dr Approval',
    newCase: 'New Case',
    pending: 'Pending',
    pendingReview: 'Pending Review',
    returnedForAdjustments: 'Returned for Adjustments',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
} as const;

export const DELIVERY_ROUTES = {
    externalLabToDoctor: 'external_lab_to_doctor',
    externalLabToOurLabToDoctor: 'external_lab_to_our_lab_to_doctor',
    pickupByRep: 'pickup_by_rep',
    other: 'other',
} as const;

export type IssueStatus =
    | 'none'
    | 'remake_requested'
    | 'rejected'
    | 'cancelled';

export type MainStatus =
    | 'draft'
    | 'active'
    | 'delivered'
    | 'closed'
    | 'cancelled';

export type DeliveryRoute = typeof DELIVERY_ROUTES[keyof typeof DELIVERY_ROUTES];

export const DOCTOR_STATEMENT_INCLUDED_STATUSES = [
    'delivered',
    'completed',
    'cancelled',
    'rejected',
    'doctor rejected',
    'lab rejected',
    'returned for adjustments',
] as const;

type LifecycleOrder = Partial<Order> & {
    status?: string;
    actual_delivery_date?: string | null;
    delivery_date?: string | null;
    created_at?: string | null;
    delivery_type?: string;
    deliveryRoute?: string;
    delivery_route?: string;
    hasPendingIssue?: boolean;
    hasPendingFinancialRequest?: boolean;
    hasRequiredCostsRecorded?: boolean;
    paymentStatus?: string;
    productionStatus?: string | null;
    production_status?: string | null;
    designUrl?: string | null;
    design_url?: string | null;
    issueState?: string | null;
    issue_state?: string | null;
};

type CashRevenueCandidate = Partial<Transaction> & {
    allocatedAmount?: number;
    allocated_amount?: number;
    entity_type?: string;
    entity_id?: string;
};

export interface OrderFinancialState {
    order?: LifecycleOrder;
    paymentStatus?: 'unpaid' | 'partially_paid' | 'paid';
    hasPendingIssue?: boolean;
    hasPendingFinancialRequest?: boolean;
    hasRequiredCostsRecorded?: boolean;
}

export const normalizeStatus = (status?: string): string => (status || '').trim().toLowerCase();

export function getProductionStatus(order: LifecycleOrder): ProductionStatus {
    const col = order.productionStatus || order.production_status;
    if (col && isProductionStatus(col)) return col;

    // Fallback: derive from legacy status
    const status = normalizeStatus(order.status);
    const deliveryType = (order.deliveryType || order.delivery_type || '').toLowerCase();
    const isTryIn = deliveryType === 'tryin' || deliveryType === 'try_in';

    switch (status) {
        case 'completed':
        case 'delivered':
            return 'final_delivered';
        case 'try in approved':
            return 'finalization';
        case 'ready':
            return isTryIn ? 'try_in_ready' : 'final_ready';
        case 'try in':
            return 'try_in_ready';
        case 'under production':
        case 'in progress':
        case 'sent to external lab':
        case 'sent to lab':
            return 'in_production';
        case 'under design':
        case 'waiting dr approval':
            return 'designing';
        case 'new case':
        case 'pending':
        case 'pending review':
            return 'not_started';
        case 'returned for adjustments':
            return 'in_production';
        case 'doctor rejected':
        case 'lab rejected':
        case 'rejected':
            return 'not_started';
        case 'cancelled':
            return 'not_started';
        default:
            return 'not_started';
    }
}

export function getIssueStatus(order: LifecycleOrder): IssueStatus {
    switch (normalizeStatus(order.status)) {
        case 'returned for adjustments':
            return 'remake_requested';
        case 'doctor rejected':
        case 'lab rejected':
        case 'rejected':
            return 'rejected';
        case 'cancelled':
            return 'cancelled';
        default:
            return 'none';
    }
}

export function getMainStatus(order: LifecycleOrder): MainStatus {
    const prodStatus = getProductionStatus(order);
    const issueState = getEffectiveIssueState(order);

    if (prodStatus === 'final_delivered') return 'delivered';
    if (issueState === 'cancelled') return 'cancelled';
    if (prodStatus === 'not_started') return 'draft';

    if (order.status) {
        switch (normalizeStatus(order.status)) {
            case 'completed':
            case 'delivered':
                return 'delivered';
            case 'cancelled':
                return 'cancelled';
            case 'new case':
            case 'pending':
            case 'pending review':
                return 'draft';
            default:
                return 'active';
        }
    }

    return 'active';
}

export function getDeliveryRoute(order: LifecycleOrder): DeliveryRoute {
    const route = order.deliveryRoute || order.delivery_route;
    return Object.values(DELIVERY_ROUTES).includes(route as DeliveryRoute)
        ? route as DeliveryRoute
        : DELIVERY_ROUTES.externalLabToDoctor;
}

export function isTryInOrder(order: LifecycleOrder): boolean {
    const status = getProductionStatus(order);
    const deliveryType = (order.deliveryType || order.delivery_type || '').toLowerCase();
    return status === 'try_in_ready' || status === 'waiting_doctor' || status === 'finalization' || deliveryType === 'tryin' || deliveryType === 'try_in';
}

export function isTryInReady(order: LifecycleOrder): boolean {
    return getProductionStatus(order) === 'try_in_ready';
}

export function isFinalReady(order: LifecycleOrder): boolean {
    return getProductionStatus(order) === 'final_ready';
}

export function isReadyForExternalLabPayable(order: LifecycleOrder): boolean {
    return isFinalReady(order);
}

export function isExternalLabPayableEligible(order: LifecycleOrder): boolean {
    return isReadyForExternalLabPayable(order);
}

export function isDeliveredForDoctorReceivable(order: LifecycleOrder): boolean {
    const status = getProductionStatus(order);
    const issue = getEffectiveIssueState(order);
    return status === 'final_delivered' && !['cancelled', 'rejected', 'redo', 'returned', 'doctor_rejected', 'lab_rejected'].includes(issue);
}

export function isBillableToDoctor(order: LifecycleOrder): boolean {
    if (isDeliveredForDoctorReceivable(order)) return true;
    const issue = getEffectiveIssueState(order);
    if (issue === 'doctor_rejected' || issue === 'lab_rejected') {
        return !!order.rejectionDoctorDecision && (order.rejectedDoctorAmount ?? 0) > 0;
    }
    return false;
}

export function isDoctorStatementIncluded(order: LifecycleOrder): boolean {
    return DOCTOR_STATEMENT_INCLUDED_STATUSES.includes(
        normalizeStatus(order.status) as typeof DOCTOR_STATEMENT_INCLUDED_STATUSES[number]
    );
}

export function getDoctorReceivableAmount(order: LifecycleOrder): number {
    const issue = getEffectiveIssueState(order);
    if (issue === 'doctor_rejected' || issue === 'lab_rejected') {
        return order.rejectionDoctorDecision
            ? Math.max(0, order.rejectedDoctorAmount ?? 0)
            : 0;
    }
    return isDeliveredForDoctorReceivable(order) ? order.totalPrice || 0 : 0;
}

const dateOnly = (date?: string | null): string => (date || '').split('T')[0];

export function getOfficialStatementDate(order: LifecycleOrder): string {
    const actualDeliveryDate = order.actualDeliveryDate || order.actual_delivery_date;
    const deliveryDate = order.deliveryDate || order.delivery_date;
    const createdAt = order.createdAt || order.created_at;

    if (getProductionStatus(order) === 'final_delivered') {
        return dateOnly(actualDeliveryDate || deliveryDate || createdAt);
    }

    return dateOnly(deliveryDate || createdAt);
}

export function canRecognizeCashRevenue(transactionOrAllocation: CashRevenueCandidate): boolean {
    const entityType = transactionOrAllocation.entityType || transactionOrAllocation.entity_type;
    const amount = transactionOrAllocation.allocatedAmount
        ?? transactionOrAllocation.allocated_amount
        ?? transactionOrAllocation.amount
        ?? 0;

    return transactionOrAllocation.type === 'income' && entityType === 'doctor' && amount > 0;
}

export function isIssueBlockingClose(order: LifecycleOrder): boolean {
    return order.hasPendingIssue === true || getIssueStatus(order) === 'remake_requested' || getIssueStatus(order) === 'rejected';
}

export function canAutoCloseOrder(orderFinancialState: OrderFinancialState): boolean {
    const order = orderFinancialState.order || {};
    const paymentStatus = orderFinancialState.paymentStatus || order.paymentStatus;

    return isDeliveredForDoctorReceivable(order)
        && paymentStatus === 'paid'
        && !isIssueBlockingClose(order)
        && orderFinancialState.hasPendingIssue !== true
        && orderFinancialState.hasPendingFinancialRequest !== true
        && order.hasPendingFinancialRequest !== true
        && (orderFinancialState.hasRequiredCostsRecorded ?? order.hasRequiredCostsRecorded) === true;
}

export function canTransitionTo(order: LifecycleOrder, targetStatus: ProductionStatus): boolean {
    const current = getProductionStatus(order);
    const issueState = getEffectiveIssueState(order);
    return canChangeProductionStatus('lab', current, targetStatus, issueState, {
        workflowType: order.workflowType,
        deliveryType: order.deliveryType,
        designUrl: order.designUrl || order.design_url,
    });
}

export function getFinancialSummary(order: LifecycleOrder) {
    return {
        doctorReceivableEligible: isDeliveredForDoctorReceivable(order),
        externalLabPayableEligible: isExternalLabPayableEligible(order),
        cashRevenueEligible: false,
        isBillableToDoctor: isBillableToDoctor(order),
        isFinalReady: isFinalReady(order),
        isTryIn: isTryInOrder(order),
    };
}

// ─── WF-2: Column-first helpers ──────────────────────────────────────────────

/**
 * Column-first production status: uses orders.production_status if populated
 * and valid.
 */
export function getEffectiveProductionStatus(order: LifecycleOrder): ProductionStatus {
    return getProductionStatus(order);
}

/**
 * Column-first issue state.
 */
export function getEffectiveIssueState(order: LifecycleOrder): IssueState {
    const col = order.issueState || order.issue_state;
    if (col && isIssueState(col)) return col;

    // Fallback: derive from legacy status
    switch (normalizeStatus(order.status)) {
        case 'returned for adjustments':
            return 'returned';
        case 'doctor rejected':
        case 'rejected':
            return 'doctor_rejected';
        case 'lab rejected':
            return 'lab_rejected';
        case 'cancelled':
            return 'cancelled';
        default:
            return 'none';
    }
}

/**
 * Derive the physical case location from production_status + issue_state.
 * Pure function — no DB calls.
 */
export function getCaseLocation(
    productionStatus: ProductionStatus,
    issueState: IssueState,
    context?: { workflowType?: string | null; supplierId?: string | null }
): CaseLocation {
    if (issueState === 'on_hold') return 'on_hold';
    if (issueState === 'cancelled') return 'closed';
    if (issueState === 'returned' || issueState === 'doctor_rejected' || issueState === 'lab_rejected' || issueState === 'redo') return 'issue_review';

    switch (productionStatus) {
        case 'not_started': return 'pending_intake';
        case 'designing':
            return context?.workflowType === 'split' ? 'with_designer' : 'internal_design';
        case 'in_production':
            return context?.supplierId ? 'with_external_lab' : 'internal_production';
        case 'try_in_ready':
        case 'waiting_doctor':
            return 'with_doctor_waiting';
        case 'finalization': return 'internal_finalization';
        case 'final_ready': return 'internal_ready_final';
        case 'final_delivered': return 'with_doctor_final';
        default: return 'pending_intake';
    }
}
