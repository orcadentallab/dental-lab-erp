export const ORDER_EVENT_TYPES = {
    orderCreated: 'order_created',
    productionStatusChanged: 'production_status_changed',
    tryInStarted: 'try_in_started',
    tryInApproved: 'try_in_approved',
    tryInAdjustmentRequested: 'try_in_adjustment_requested',
    orderReady: 'order_ready',
    orderDelivered: 'order_delivered',
    deliveryReverted: 'delivery_reverted',
    deliveryRouteChanged: 'delivery_route_changed',
    deliveryDateChanged: 'delivery_date_changed',
    waitingOnDoctorStarted: 'waiting_on_doctor_started',
    waitingOnDoctorEnded: 'waiting_on_doctor_ended',
    newScanRequested: 'new_scan_requested',
    newScanReceived: 'new_scan_received',
    tryInSent: 'try_in_sent',
    issueReported: 'issue_reported',
    remakeRequested: 'remake_requested',
    rejectionRequested: 'rejection_requested',
    financialAdjustmentRequested: 'financial_adjustment_requested',
    financialAdjustmentApproved: 'financial_adjustment_approved',
    paymentAllocated: 'payment_allocated',
    manualAllocationOverride: 'manual_allocation_override',
    orderClosed: 'order_closed',
    orderReopened: 'order_reopened',
    // ─── WF-1 unified workflow layer (dormant — emitted only by
    //     rep_update_order_fields_with_audit RPC and future workflow ops) ───
    patientNameChanged: 'patient_name_changed',
    stlUrlChanged: 'stl_url_changed',
    imagesUrlChanged: 'images_url_changed',
    urgencyChanged: 'urgency_changed',
    priorityChanged: 'priority_changed',
    supplierChanged: 'supplier_changed',
    designerChanged: 'designer_changed',
    issueStateChanged: 'issue_state_changed',
    caseReturned: 'case_returned',
    caseRejected: 'case_rejected',
    caseCancelled: 'case_cancelled',
    caseHeld: 'case_held',
    caseResumed: 'case_resumed',
    finalReady: 'final_ready',
    finalDelivered: 'final_delivered',
    finalizationStarted: 'finalization_started',
    tryInReady: 'try_in_ready',
    orderFieldChanged: 'order_field_changed',
} as const;

export type OrderEventType = typeof ORDER_EVENT_TYPES[keyof typeof ORDER_EVENT_TYPES];

export const ORDER_EVENT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type OrderEventSeverity = typeof ORDER_EVENT_SEVERITIES[number];

export const ORDER_EVENT_APPROVAL_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type OrderEventApprovalStatus = typeof ORDER_EVENT_APPROVAL_STATUSES[number];

export const SENSITIVE_ORDER_EVENT_TYPES = [
    ORDER_EVENT_TYPES.financialAdjustmentApproved,
    ORDER_EVENT_TYPES.paymentAllocated,
    ORDER_EVENT_TYPES.manualAllocationOverride,
    ORDER_EVENT_TYPES.orderReopened,
] as const satisfies readonly OrderEventType[];

export type SensitiveOrderEventType = typeof SENSITIVE_ORDER_EVENT_TYPES[number];

export function isOrderEventType(value: string): value is OrderEventType {
    return Object.values(ORDER_EVENT_TYPES).includes(value as OrderEventType);
}

export function isOrderEventSeverity(value: string): value is OrderEventSeverity {
    return ORDER_EVENT_SEVERITIES.includes(value as OrderEventSeverity);
}

export function isOrderEventApprovalStatus(value: string): value is OrderEventApprovalStatus {
    return ORDER_EVENT_APPROVAL_STATUSES.includes(value as OrderEventApprovalStatus);
}

export function isSensitiveOrderEventType(eventType: OrderEventType): eventType is SensitiveOrderEventType {
    return SENSITIVE_ORDER_EVENT_TYPES.includes(eventType as SensitiveOrderEventType);
}
