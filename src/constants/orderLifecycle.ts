import type { Order, Transaction } from '../services/db';

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

export type ProductionStatus =
    | 'not_started'
    | 'designing'
    | 'sent_to_lab'
    | 'in_production'
    | 'try_in'
    | 'try_in_approved'
    | 'ready'
    | 'delivered';

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
    switch (normalizeStatus(order.status)) {
        case 'completed':
        case 'delivered':
            return 'delivered';
        case 'ready':
            return 'ready';
        case 'try in':
            return 'try_in';
        case 'try in approved':
            return 'try_in_approved';
        case 'under production':
        case 'in progress':
            return 'in_production';
        case 'sent to external lab':
        case 'sent to lab':
            return 'sent_to_lab';
        case 'returned for adjustments':
        case 'rejected':
            return 'in_production';
        case 'under design':
        case 'waiting dr approval':
            return 'designing';
        case 'new case':
        case 'pending':
        case 'pending review':
        case 'cancelled':
        default:
            return 'not_started';
    }
}

export function getIssueStatus(order: LifecycleOrder): IssueStatus {
    switch (normalizeStatus(order.status)) {
        case 'returned for adjustments':
            return 'remake_requested';
        case 'rejected':
            return 'rejected';
        case 'cancelled':
            return 'cancelled';
        default:
            return 'none';
    }
}

export function getMainStatus(order: LifecycleOrder): MainStatus {
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

export function getDeliveryRoute(order: LifecycleOrder): DeliveryRoute {
    const route = order.deliveryRoute || order.delivery_route;
    return Object.values(DELIVERY_ROUTES).includes(route as DeliveryRoute)
        ? route as DeliveryRoute
        : DELIVERY_ROUTES.externalLabToDoctor;
}

export function isTryInOrder(order: LifecycleOrder): boolean {
    const status = getProductionStatus(order);
    const deliveryType = (order.deliveryType || order.delivery_type || '').toLowerCase();
    return status === 'try_in' || status === 'try_in_approved' || deliveryType === 'tryin' || deliveryType === 'try_in';
}

export function isTryInReady(order: LifecycleOrder): boolean {
    return getProductionStatus(order) === 'ready' && isTryInOrder(order);
}

export function isFinalReady(order: LifecycleOrder): boolean {
    return getProductionStatus(order) === 'ready' && !isTryInReady(order);
}

export function isReadyForExternalLabPayable(order: LifecycleOrder): boolean {
    return isFinalReady(order);
}

export function isExternalLabPayableEligible(order: LifecycleOrder): boolean {
    return isReadyForExternalLabPayable(order);
}

export function isDeliveredForDoctorReceivable(order: LifecycleOrder): boolean {
    const status = getProductionStatus(order);
    return status === 'delivered' && getIssueStatus(order) !== 'cancelled' && getIssueStatus(order) !== 'rejected';
}

export function isBillableToDoctor(order: LifecycleOrder): boolean {
    return isDeliveredForDoctorReceivable(order);
}

export function isDoctorStatementIncluded(order: LifecycleOrder): boolean {
    return DOCTOR_STATEMENT_INCLUDED_STATUSES.includes(
        normalizeStatus(order.status) as typeof DOCTOR_STATEMENT_INCLUDED_STATUSES[number]
    );
}

export function getDoctorReceivableAmount(order: LifecycleOrder): number {
    return isBillableToDoctor(order) ? order.totalPrice || 0 : 0;
}

const dateOnly = (date?: string | null): string => (date || '').split('T')[0];

export function getOfficialStatementDate(order: LifecycleOrder): string {
    const actualDeliveryDate = order.actualDeliveryDate || order.actual_delivery_date;
    const deliveryDate = order.deliveryDate || order.delivery_date;
    const createdAt = order.createdAt || order.created_at;

    if (getProductionStatus(order) === 'delivered') {
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

    if (getMainStatus(order) === 'closed') return false;
    if (current === targetStatus) return true;
    if (targetStatus === 'delivered') return current === 'ready';
    if (targetStatus === 'ready') return current === 'in_production' || current === 'try_in_approved';
    if (targetStatus === 'try_in_approved') return current === 'try_in';
    if (targetStatus === 'try_in') return current === 'in_production';
    if (targetStatus === 'in_production') return current === 'sent_to_lab' || current === 'try_in_approved';
    if (targetStatus === 'sent_to_lab') return current === 'not_started' || current === 'designing';
    if (targetStatus === 'designing') return current === 'not_started';

    return false;
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
