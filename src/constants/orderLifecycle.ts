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
    isDeleted?: boolean | null;
    is_deleted?: boolean | null;
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
    // A redo closes the original case, but it can still carry an approved
    // doctor responsibility (for example, when the doctor bears the full
    // remake cost). Treat that settlement exactly like a rejected-case
    // settlement; only the replacement order represents the new production.
    if (issue === 'doctor_rejected' || issue === 'lab_rejected' || issue === 'redo') {
        return !!order.rejectionDoctorDecision && (order.rejectedDoctorAmount ?? 0) > 0;
    }
    return false;
}

export function isDoctorStatementIncluded(order: LifecycleOrder): boolean {
    if (order.isDeleted || order.is_deleted) return false;
    return DOCTOR_STATEMENT_INCLUDED_STATUSES.includes(
        normalizeStatus(order.status) as typeof DOCTOR_STATEMENT_INCLUDED_STATUSES[number]
    );
}

export function getDoctorReceivableAmount(order: LifecycleOrder): number {
    const issue = getEffectiveIssueState(order);
    if (issue === 'doctor_rejected' || issue === 'lab_rejected' || issue === 'redo') {
        return order.rejectionDoctorDecision
            ? Math.max(0, order.rejectedDoctorAmount ?? 0)
            : 0;
    }
    return isDeliveredForDoctorReceivable(order) ? order.totalPrice || 0 : 0;
}

/**
 * Production cost of an order, on the same basis the P&L uses.
 *
 * The cost twin of getDoctorReceivableAmount, and it exists for the same
 * reason: two screens each rebuilding this expression drifted apart from
 * get_analytics_summary and from each other.
 *
 * Cancelled and lab-rejected cases were never worked on, so they cost
 * nothing. For a doctor rejection the case WAS produced, so a cost can
 * exist -- but only the settled rejection amounts count, never orders.cost.
 * That column holds the estimate captured when the order was created and is
 * not cleared when the case ends, so falling back to it (`rejectedLabCost
 * ?? cost`) charged the lab for work its own ledger says was never billed:
 * 24 rejected cases with no settled lab cost and zero live supplier or
 * designer obligations, carrying 34,340 EGP of stale estimate between them.
 *
 * Everything else is orders.cost. That already equals the RPC's
 * supplier + designer split for every workflow: a split order stores
 * milling + design in cost, and the RPC subtracts design_price from the
 * supplier side only to add it back on the designer side.
 */
export function getLabCostAmount(order: LifecycleOrder): number {
    const status = normalizeStatus(order.status);
    const issue = getEffectiveIssueState(order);

    if (status === 'cancelled' || issue === 'cancelled') return 0;
    if (status === 'lab rejected' || issue === 'lab_rejected') return 0;

    const isDoctorRejected =
        status === 'doctor rejected' || status === 'rejected' || issue === 'doctor_rejected';

    if (isDoctorRejected) {
        return Math.max(0, (order.rejectedLabCost ?? 0) + (order.rejectedDesignerCost ?? 0));
    }

    return order.cost || 0;
}

/**
 * Whether the order actually CLOSED in its statement period.
 *
 * Everything on the doctor statement is settled except one status: an order
 * sitting in "Returned for Adjustments" went back to the bench and will be
 * delivered again. It stays visible on the statement, but counting it as a
 * closed case would book it twice -- once here at zero, and again in the
 * period it is finally delivered in. It belongs to work in progress until
 * then. Mirrors SECTION A1 of get_analytics_summary_privileged_20260801.
 */
export function isClosedCaseInPeriod(order: LifecycleOrder): boolean {
    if (!isDoctorStatementIncluded(order)) return false;
    return normalizeStatus(order.status) !== 'returned for adjustments';
}

/**
 * Orders that were never produced/worked on and must not enter into
 * productive unit counts, work volume, or price/cost average calculations.
 *
 * Cancelled orders and Lab Rejected orders were terminated before
 * manufacturing. Including their units with 0 revenue / 0 cost dilutes
 * the lab's true average selling price and average purchase cost per unit,
 * creating fictitious discounts.
 */
export function isNonProductiveOrder(order: LifecycleOrder): boolean {
    const status = normalizeStatus(order.status);
    const issue = getEffectiveIssueState(order);
    return status === 'cancelled' || issue === 'cancelled' || status === 'lab rejected' || issue === 'lab_rejected';
}

/**
 * A case that was handed to the doctor but carries no price at all.
 *
 * Its units are real work, but pricing them at zero drags the average selling
 * price per unit down and reads as a discount the lab never gave. So the case
 * still counts as a delivered case; only the per-unit averages skip it.
 */
export function isZeroValueDelivery(order: LifecycleOrder): boolean {
    if (isNonProductiveOrder(order)) return false;
    const status = normalizeStatus(order.status);
    if (status !== 'delivered' && status !== 'completed') return false;
    return Math.max(0, order.totalPrice || 0) === 0;
}

/** Whether the order's units belong in unit counts and per-unit averages. */
export function contributesProductiveUnits(order: LifecycleOrder): boolean {
    return !isNonProductiveOrder(order) && !isZeroValueDelivery(order);
}

export function getProductiveItemUnitCount(order: LifecycleOrder, item: { teethNumbers?: unknown } | null | undefined): number {
    if (!contributesProductiveUnits(order)) return 0;
    return Array.isArray(item?.teethNumbers) ? item.teethNumbers.length : 1;
}

export function getOrderProductiveUnits(order: LifecycleOrder): number {
    if (!contributesProductiveUnits(order)) return 0;
    const items = (order.items || []) as Array<{ teethNumbers?: unknown }>;
    if (items.length === 0) return 0;
    return items.reduce((sum, it) => sum + (Array.isArray(it?.teethNumbers) ? it.teethNumbers.length : 1), 0);
}

/**
 * Amount shown when the user explicitly asks to include unfinished orders.
 * This is a projected order value for active work, but terminal issue states
 * must keep their approved accounting amount instead of reverting to zero.
 */
export function getDoctorOrderDisplayAmount(order: LifecycleOrder): number {
    const normalizedStatus = normalizeStatus(order.status);

    if (['doctor rejected', 'rejected', 'lab rejected'].includes(normalizedStatus)) {
        return getDoctorReceivableAmount(order);
    }

    if (['cancelled', 'returned for adjustments'].includes(normalizedStatus)) {
        return 0;
    }

    return Math.max(0, order.totalPrice || 0);
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
