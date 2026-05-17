import {
    ORDER_EVENT_TYPES,
    isOrderEventApprovalStatus,
    isOrderEventSeverity,
    isOrderEventType,
    isSensitiveOrderEventType,
    type OrderEventApprovalStatus,
    type OrderEventSeverity,
    type OrderEventType,
} from '../../constants/orderEvents';
import { ValidationError } from '../../lib/errorHandler';
import type { OrderEvent } from '../db';

type OrderEventRow = {
    id: string;
    order_id: string;
    event_type: string;
    old_value: string | null;
    new_value: string | null;
    changed_by: string | null;
    actor_role: string | null;
    changed_at: string;
    reason: string | null;
    notes: string | null;
    severity: OrderEventSeverity;
    responsibility_party: string | null;
    approval_status: OrderEventApprovalStatus;
    approved_by: string | null;
    approved_at: string | null;
    financial_impact: number | null;
    related_transaction_id: string | null;
    related_adjustment_id: string | null;
    related_allocation_id: string | null;
    related_issue_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
};

export interface OrderEventInput {
    orderId: string;
    eventType: OrderEventType;
    oldValue?: string | null;
    newValue?: string | null;
    changedBy?: string | null;
    actorRole?: string | null;
    changedAt?: string;
    reason?: string | null;
    notes?: string | null;
    severity?: OrderEventSeverity;
    responsibilityParty?: string | null;
    approvalStatus?: OrderEventApprovalStatus;
    approvedBy?: string | null;
    approvedAt?: string | null;
    financialImpact?: number | null;
    relatedTransactionId?: string | null;
    relatedAdjustmentId?: string | null;
    relatedAllocationId?: string | null;
    relatedIssueId?: string | null;
    metadata?: Record<string, unknown>;
}

export interface ValidatedOrderEventInput extends OrderEventInput {
    severity: OrderEventSeverity;
    approvalStatus: OrderEventApprovalStatus;
}

export type DeliveryDateResponsibilityParty = 'doctor' | 'internal' | 'external_lab' | 'designer' | 'unknown';

export interface DeliveryDateChangedInput {
    orderId: string;
    oldDeliveryDate: string;
    newDeliveryDate: string;
    changedBy?: string | null;
    actorRole?: string | null;
    reason?: string | null;
    reasonCode?: string | null;
    responsibilityParty?: DeliveryDateResponsibilityParty;
    notes?: string | null;
    source?: string | null;
}

const isUuid = (value?: string | null) =>
    typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const nullableUuid = (value?: string | null) => isUuid(value) ? value : null;

async function getSupabaseClient() {
    const { supabase } = await import('../../lib/supabase');
    return supabase;
}

export function validateOrderEventInput(input: OrderEventInput): ValidatedOrderEventInput {
    if (!input.orderId) {
        throw new ValidationError('معرف الطلب مطلوب لتسجيل الحدث');
    }

    if (!isOrderEventType(input.eventType)) {
        throw new ValidationError('نوع حدث الطلب غير صحيح');
    }

    const severity = input.severity || 'info';
    if (!isOrderEventSeverity(severity)) {
        throw new ValidationError('درجة خطورة حدث الطلب غير صحيحة');
    }

    const approvalStatus = input.approvalStatus || 'none';
    if (!isOrderEventApprovalStatus(approvalStatus)) {
        throw new ValidationError('حالة اعتماد حدث الطلب غير صحيحة');
    }

    if (isSensitiveOrderEventType(input.eventType) && input.actorRole && input.actorRole !== 'admin') {
        throw new ValidationError('هذا الحدث الحساس متاح للمدير فقط');
    }

    return {
        ...input,
        severity,
        approvalStatus,
    };
}

export function orderEventToDb(input: OrderEventInput) {
    const event = validateOrderEventInput(input);

    return {
        order_id: event.orderId,
        event_type: event.eventType,
        old_value: event.oldValue || null,
        new_value: event.newValue || null,
        changed_by: nullableUuid(event.changedBy),
        actor_role: event.actorRole || null,
        changed_at: event.changedAt || new Date().toISOString(),
        reason: event.reason || null,
        notes: event.notes || null,
        severity: event.severity,
        responsibility_party: event.responsibilityParty || null,
        approval_status: event.approvalStatus,
        approved_by: nullableUuid(event.approvedBy),
        approved_at: event.approvedAt || null,
        financial_impact: event.financialImpact ?? null,
        related_transaction_id: event.relatedTransactionId || null,
        related_adjustment_id: event.relatedAdjustmentId || null,
        related_allocation_id: event.relatedAllocationId || null,
        related_issue_id: event.relatedIssueId || null,
        metadata: event.metadata || {},
    };
}

export function dbToOrderEvent(row: OrderEventRow): OrderEvent {
    return {
        id: row.id,
        orderId: row.order_id,
        eventType: row.event_type as OrderEventType,
        oldValue: row.old_value,
        newValue: row.new_value,
        changedBy: row.changed_by,
        actorRole: row.actor_role,
        changedAt: row.changed_at,
        reason: row.reason,
        notes: row.notes,
        severity: row.severity,
        responsibilityParty: row.responsibility_party,
        approvalStatus: row.approval_status,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        financialImpact: row.financial_impact,
        relatedTransactionId: row.related_transaction_id,
        relatedAdjustmentId: row.related_adjustment_id,
        relatedAllocationId: row.related_allocation_id,
        relatedIssueId: row.related_issue_id,
        metadata: row.metadata || {},
        createdAt: row.created_at,
    };
}

export function sortOrderEventsAscending(events: OrderEvent[]): OrderEvent[] {
    return [...events].sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
}

export async function createOrderEvent(input: OrderEventInput): Promise<OrderEvent | null> {
    const supabase = await getSupabaseClient();
    const dbEvent = orderEventToDb(input);

    const { data, error } = await supabase
        .from('order_events')
        .insert(dbEvent)
        .select('*')
        .single();

    if (error) {
        console.error('Failed to create order event:', error);
        return null;
    }

    return data ? dbToOrderEvent(data as OrderEventRow) : null;
}

export function getDeliveryDateChangeSeverity(
    oldDeliveryDate: string,
    newDeliveryDate: string,
    responsibilityParty: DeliveryDateResponsibilityParty = 'unknown'
): OrderEventSeverity {
    return responsibilityParty === 'internal' && newDeliveryDate > oldDeliveryDate
        ? 'warning'
        : 'info';
}

export async function logDeliveryDateChanged(input: DeliveryDateChangedInput): Promise<OrderEvent | null> {
    const responsibilityParty = input.responsibilityParty || 'unknown';

    return createOrderEvent({
        orderId: input.orderId,
        eventType: ORDER_EVENT_TYPES.deliveryDateChanged,
        oldValue: input.oldDeliveryDate,
        newValue: input.newDeliveryDate,
        changedBy: input.changedBy || null,
        actorRole: input.actorRole || null,
        reason: input.reason || null,
        notes: input.notes || null,
        responsibilityParty,
        severity: getDeliveryDateChangeSeverity(input.oldDeliveryDate, input.newDeliveryDate, responsibilityParty),
        metadata: {
            oldDeliveryDate: input.oldDeliveryDate,
            newDeliveryDate: input.newDeliveryDate,
            reasonCode: input.reasonCode || null,
            responsibleParty: responsibilityParty,
            source: input.source || 'update_order',
            shadowMode: false,
        },
    });
}

export async function getOrderTimeline(orderId: string): Promise<OrderEvent[]> {
    if (!orderId) {
        throw new ValidationError('معرف الطلب مطلوب لعرض خط الأحداث');
    }

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
        .from('order_events')
        .select('*')
        .eq('order_id', orderId)
        .order('changed_at', { ascending: true });

    if (error) {
        console.error('Failed to fetch order timeline:', error);
        return [];
    }

    return ((data || []) as OrderEventRow[]).map(dbToOrderEvent);
}

export function getStatusChangeEventType(newStatus: string): OrderEventType {
    switch (newStatus) {
        case 'Try In':
            return ORDER_EVENT_TYPES.tryInStarted;
        case 'Try In Approved':
            return ORDER_EVENT_TYPES.tryInApproved;
        case 'Ready':
            return ORDER_EVENT_TYPES.orderReady;
        case 'Delivered':
            return ORDER_EVENT_TYPES.orderDelivered;
        default:
            return ORDER_EVENT_TYPES.productionStatusChanged;
    }
}
