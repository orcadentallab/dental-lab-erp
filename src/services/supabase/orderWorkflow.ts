// Unified order workflow service (WF-1).
//
// This file is the SINGLE entry point for controlled, audit-gated mutations to
// orders. Today only `repUpdateOrderWithAudit` is live; the other functions are
// stubbed/typed so future phases (WF-2..WF-4) can wire production_status,
// issue_state, and assignment changes through the same pattern without
// restructuring.
//
// Shape contract for every workflow operation (in TS and in SQL):
//   1. validate caller role
//   2. validate reason code (when applicable)
//   3. lock OLD row (FOR UPDATE in SQL)
//   4. validate field allow-list / target value
//   5. validate state guards
//   6. write order_events (one row per logical change)
//   7. apply UPDATE atomically
//
// Source of truth for policy: docs/orders-field-permissions.md.

import { supabase } from '../../lib/supabase';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';
import type { Order } from '../db';
import { ensureAbsoluteUrl } from '../../lib/urlUtils';
import {
    REP_AUDITED_ALLOW_LIST_CAMEL,
    REP_FIELD_TO_DB,
    type RepAuditedFieldCamel,
    type WorkflowRole,
    canChangeProductionStatus,
    canChangeIssueState,
    canEditOrderField,
} from '../../lib/workflowPermissions';
import { ORDER_EVENT_TYPES } from '../../constants/orderEvents';
import type { ProductionStatus, IssueState } from '../../constants/workflow';
import { getProductionStatus, getEffectiveIssueState } from '../../constants/orderLifecycle';
import {
    isOrderEditReasonCode,
    reasonRequiresNote,
} from '../../constants/orderEditReasons';

// ─── Types ───────────────────────────────────────────────────────────────────

export class NotImplementedError extends Error {
    constructor(operation: string) {
        super(`${operation} is not yet implemented (WF-2+ scope).`);
        this.name = 'NotImplementedError';
    }
}

export type RepEditChanges = Partial<Pick<Order,
    'patientName' | 'stlUrl' | 'imagesUrl' | 'deliveryDate' |
    'isUrgent' | 'priority' | 'supplierId' | 'designerId' |
    'instructions' | 'items' | 'totalPrice' | 'cost' | 'designPrice'
>>;

// ─── repUpdateOrderWithAudit (LIVE) ──────────────────────────────────────────

/**
 * Audit-gated representative edit pathway.
 *
 * Calls the SECURITY DEFINER RPC `rep_update_order_fields_with_audit`. The RPC
 * is the security boundary — this TS wrapper only does input shape validation
 * and snake_case conversion. All authoritative checks (role, allow-list, state
 * guards, reason validation, audit row insertion) happen in SQL.
 *
 * The matching DB-side trigger `orders_role_field_guard` is gated behind the
 * `app.workflow_strict_rep` feature flag; when off (WF-1 default), reps can
 * still update directly via `db.updateOrder` and the strict path is dormant.
 */
export async function repUpdateOrderWithAudit(
    orderId: string,
    changes: Partial<Order>,
    reasonCode: string,
    reasonNote?: string | null
): Promise<Order | null> {
    if (!orderId || typeof orderId !== 'string') {
         throw new ValidationError('orderId is required');
     }

     // Clean URL fields before processing changes
     if (changes.stlUrl !== undefined && changes.stlUrl !== null) {
         const trimmed = changes.stlUrl.trim();
         changes.stlUrl = trimmed ? ensureAbsoluteUrl(trimmed) : null as unknown as string;
     }
     if (changes.imagesUrl !== undefined && changes.imagesUrl !== null) {
         const trimmed = changes.imagesUrl.trim();
         changes.imagesUrl = trimmed ? ensureAbsoluteUrl(trimmed) : null as unknown as string;
     }
     if (changes.designUrl !== undefined && changes.designUrl !== null) {
         const trimmed = changes.designUrl.trim();
         changes.designUrl = trimmed ? ensureAbsoluteUrl(trimmed) : null as unknown as string;
     }

     // Reason validation (mirrored in DB; client-side is just for fast feedback).
    if (!reasonCode || !isOrderEditReasonCode(reasonCode)) {
        throw new ValidationError(`Invalid or missing reason_code: ${reasonCode}`);
    }
    if (reasonRequiresNote(reasonCode) && !reasonNote?.trim()) {
        throw new ValidationError("reason_note is required when reason_code='other'");
    }

    // Filter to allow-list and convert camelCase → snake_case for the RPC payload.
    const dbChanges: Record<string, unknown> = {};
    const droppedKeys: string[] = [];

    for (const key of Object.keys(changes) as (keyof Order)[]) {
        if ((REP_AUDITED_ALLOW_LIST_CAMEL as readonly string[]).includes(key)) {
            const dbKey = REP_FIELD_TO_DB[key as RepAuditedFieldCamel];
            const value = changes[key];
            // Pass-through; let the DB enforce types and CHECK constraints.
            dbChanges[dbKey] = value === undefined ? null : value;
        } else {
            droppedKeys.push(key);
        }
    }

    if (droppedKeys.length > 0) {
        // Hard reject — surfaces caller bugs early. The DB would also reject.
        throw new ValidationError(
            `Field(s) not in audited rep allow-list: ${droppedKeys.join(', ')}`
        );
    }

    if (Object.keys(dbChanges).length === 0) {
        throw new ValidationError('No changes provided');
    }

    const { getOrder } = await import('./orders');
    const previousOrder = await getOrder(orderId);

    const { data, error } = await supabase.rpc('rep_update_order_fields_with_audit', {
        p_order_id: orderId,
        p_changes: dbChanges,
        p_reason_code: reasonCode,
        p_reason_note: reasonNote ?? null,
    });

    if (error) {
        throw ErrorHandler.handle(error, 'repUpdateOrderWithAudit');
    }

    // The RPC returns the order id; re-fetch the full row to return a normal Order
    // (preserves existing call patterns).
    if (!data) return null;
    
    const updatedOrder = await getOrder(orderId);

    if (previousOrder && updatedOrder) {
        const { runFinancialCorrectionsAfterOrderUpdate } = await import('./orders');
        let callerUserId: string | null = null;
        try {
            const caller = await getCallerRoleAndId();
            callerUserId = caller.userId;
        } catch (e) {
            console.warn('Failed to resolve caller user ID for financial corrections auditing', e);
        }
        await runFinancialCorrectionsAfterOrderUpdate(
            previousOrder,
            updatedOrder,
            callerUserId,
            reasonCode,
            reasonNote ?? null
        );
    }

    return updatedOrder;
}

// ─── Future workflow operations (WF-2..WF-4 stubs) ───────────────────────────

// Helper function to resolve the current caller role and ID
async function getCallerRoleAndId(): Promise<{ role: WorkflowRole; userId: string }> {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
        throw new ValidationError('المستخدم غير مسجل دخول');
    }

    const { data: profile, error } = await supabase
        .from('users')
        .select('role, id')
        .eq('auth_id', authUser.id)
        .single();

    if (error || !profile) {
        throw new ValidationError('فشل العثور على ملف تعريف المستخدم');
    }

    return {
        role: profile.role as WorkflowRole,
        userId: profile.id,
    };
}

// Map production status to its corresponding legacy status string
export function mapProductionStatusToLegacy(status: ProductionStatus): string {
    switch (status) {
        case 'not_started': return 'New Case';
        case 'designing': return 'Under Design';
        case 'in_production': return 'Under Production';
        case 'try_in_ready': return 'Try In';
        case 'waiting_doctor': return 'Waiting Dr Approval';
        case 'finalization': return 'Try In Approved';
        case 'final_ready': return 'Ready';
        case 'final_delivered': return 'Delivered';
        default: return 'New Case';
    }
}

// Map issue state to its corresponding legacy status string
export function mapIssueStateToLegacy(newIssueState: IssueState, currentLegacyStatus: string): string {
    switch (newIssueState) {
        case 'returned':        return 'Returned for Adjustments';
        case 'doctor_rejected': return 'Doctor Rejected';  // Doctor returned case; rejectedLabCost applies
        case 'lab_rejected':    return 'Lab Rejected';      // Lab internal rejection; zero financial impact
        case 'cancelled':       return 'Cancelled';
        case 'on_hold':         return currentLegacyStatus; // Keep current status
        case 'none':            return 'Under Production';  // Resuming
        default:                return currentLegacyStatus;
    }
}

function getStatusChangeEventType(newStatus: ProductionStatus): string {
    switch (newStatus) {
        case 'try_in_ready':
            return ORDER_EVENT_TYPES.tryInReady;
        case 'finalization':
            return ORDER_EVENT_TYPES.finalizationStarted;
        case 'final_ready':
            return ORDER_EVENT_TYPES.finalReady;
        case 'final_delivered':
            return ORDER_EVENT_TYPES.finalDelivered;
        default:
            return ORDER_EVENT_TYPES.productionStatusChanged;
    }
}

function getIssueEventDetails(newIssueState: IssueState): { eventType: string; severity: 'info' | 'warning' | 'critical' } {
    switch (newIssueState) {
        case 'returned':
            return { eventType: ORDER_EVENT_TYPES.caseReturned, severity: 'warning' };
        case 'doctor_rejected':
        case 'lab_rejected':
            return { eventType: ORDER_EVENT_TYPES.caseRejected, severity: 'critical' };
        case 'cancelled':
            return { eventType: ORDER_EVENT_TYPES.caseCancelled, severity: 'critical' };
        case 'on_hold':
            return { eventType: ORDER_EVENT_TYPES.caseHeld, severity: 'warning' };
        case 'none':
            return { eventType: ORDER_EVENT_TYPES.caseResumed, severity: 'info' };
        default:
            return { eventType: ORDER_EVENT_TYPES.issueStateChanged, severity: 'info' };
    }
}

/**
 * WF-2/WF-3: Change `production_status` through the same audited pathway.
 */
export async function changeProductionStatus(
    orderId: string,
    newStatus: string,
    reasonCode: string,
    reasonNote?: string | null,
): Promise<Order | null> {
    if (!orderId || typeof orderId !== 'string') {
        throw new ValidationError('orderId is required');
    }
    if (!newStatus) {
        throw new ValidationError('newStatus is required');
    }

    const { role: userRole, userId } = await getCallerRoleAndId();

    const { getOrder } = await import('./orders');
    const order = await getOrder(orderId);
    if (!order) {
        throw new ValidationError('الطلب غير موجود');
    }

    const currentStatus = getProductionStatus(order);
    const currentIssueState = getEffectiveIssueState(order);

    const isValid = canChangeProductionStatus(
        userRole,
        currentStatus,
        newStatus as ProductionStatus,
        currentIssueState,
        {
            workflowType: order.workflowType,
            deliveryType: order.deliveryType,
            designUrl: order.designUrl,
            status: order.status,
        }
    );

    if (!isValid) {
        throw new ValidationError('العملية غير مسموحة بناءً على حالة الطلب وصلاحياتك');
    }

    const targetLegacyStatus = mapProductionStatusToLegacy(newStatus as ProductionStatus) as Order['status'];
    const { updateOrder } = await import('./orders');
    const updatedOrder = await updateOrder(orderId, {
        productionStatus: newStatus as ProductionStatus,
        status: targetLegacyStatus,
    }, {
        userId,
        actorRole: userRole,
    });

    if (updatedOrder) {
        const eventType = getStatusChangeEventType(newStatus as ProductionStatus);
        await addOrderEvent({
            orderId,
            eventType,
            oldValue: currentStatus,
            newValue: newStatus,
            reason: reasonCode,
            notes: reasonNote,
            actorUserId: userId,
            actorRole: userRole,
        });
    }

    return updatedOrder;
}

/**
 * WF-2/WF-3: Change `issue_state` (returned/rejected/cancelled/on_hold/none).
 */
export async function changeIssueState(
    orderId: string,
    newIssueState: string,
    reasonCode: string,
    reasonNote?: string | null,
    responsibilityParty?: string,
): Promise<Order | null> {
    if (!orderId || typeof orderId !== 'string') {
        throw new ValidationError('orderId is required');
    }
    if (!newIssueState) {
        throw new ValidationError('newIssueState is required');
    }

    const { role: userRole, userId } = await getCallerRoleAndId();

    const { getOrder } = await import('./orders');
    const order = await getOrder(orderId);
    if (!order) {
        throw new ValidationError('الطلب غير موجود');
    }

    const currentIssueState = getEffectiveIssueState(order);

    const isValid = canChangeIssueState(
        userRole,
        currentIssueState,
        newIssueState as IssueState
    );

    if (!isValid) {
        throw new ValidationError('العملية غير مسموحة بناءً على حالة الطلب وصلاحياتك');
    }

    let targetLegacyStatus = order.status;
    let targetProductionStatus = getProductionStatus(order);

    if (newIssueState === 'returned') {
        targetLegacyStatus = 'Returned for Adjustments';
        targetProductionStatus = 'in_production';
    } else if (newIssueState === 'doctor_rejected') {
        // Doctor returned case — same financial behavior as old 'Rejected'
        targetLegacyStatus = 'Doctor Rejected';
        targetProductionStatus = 'not_started';
    } else if (newIssueState === 'lab_rejected') {
        // Lab internal rejection — zero financial impact, same as Cancelled
        targetLegacyStatus = 'Lab Rejected';
        targetProductionStatus = 'not_started';
    } else if (newIssueState === 'cancelled') {
        targetLegacyStatus = 'Cancelled';
    } else if (newIssueState === 'on_hold') {
        // Keep current status
    } else if (newIssueState === 'none') {
        if (currentIssueState !== 'none') {
            targetLegacyStatus = 'Under Production';
            targetProductionStatus = 'in_production';
        }
    } else if (newIssueState === 'redo') {
        targetLegacyStatus = 'New Case';
    }

    const { updateOrder } = await import('./orders');
    const updatedOrder = await updateOrder(orderId, {
        issueState: newIssueState as IssueState,
        status: targetLegacyStatus,
        productionStatus: targetProductionStatus,
    }, {
        userId,
        actorRole: userRole,
    });

    if (updatedOrder) {
        const { eventType, severity } = getIssueEventDetails(newIssueState as IssueState);
        await addOrderEvent({
            orderId,
            eventType,
            oldValue: currentIssueState,
            newValue: newIssueState,
            reason: reasonCode,
            notes: reasonNote,
            actorUserId: userId,
            actorRole: userRole,
            severity,
            responsibilityParty: responsibilityParty || null,
        });
    }

    return updatedOrder;
}

/**
 * WF-2: Generic assignment-change wrapper (supplier_id, designer_id) for
 * admin/lab callers, with audit. Reps use repUpdateOrderWithAudit instead.
 */
export async function updateAssignmentWithReason(
    orderId: string,
    changes: { supplierId?: string | null; designerId?: string | null },
    reasonCode: string,
    reasonNote?: string | null,
): Promise<Order | null> {
    if (!orderId || typeof orderId !== 'string') {
        throw new ValidationError('orderId is required');
    }

    const { role: userRole, userId } = await getCallerRoleAndId();

    const { getOrder } = await import('./orders');
    const order = await getOrder(orderId);
    if (!order) {
        throw new ValidationError('الطلب غير موجود');
    }

    const currentStatus = getProductionStatus(order);
    const currentIssueState = getEffectiveIssueState(order);

    const updates: Omit<Partial<Order>, 'supplierId' | 'designerId'> & { supplierId?: string | null; designerId?: string | null } = {};
    if (changes.supplierId !== undefined) {
        if (!canEditOrderField(userRole, 'supplier_id', currentStatus, currentIssueState, order.workflowType)) {
            throw new ValidationError('غير مصرح لك بتحديث المورد لهذه الحالة');
        }
        updates.supplierId = changes.supplierId;
    }
    if (changes.designerId !== undefined) {
        if (!canEditOrderField(userRole, 'designer_id', currentStatus, currentIssueState, order.workflowType)) {
            throw new ValidationError('غير مصرح لك بتحديث المصمم لهذه الحالة');
        }
        updates.designerId = changes.designerId;
    }

    if (Object.keys(updates).length === 0) {
        throw new ValidationError('No changes provided');
    }

    const { updateOrder } = await import('./orders');
    const updatedOrder = await updateOrder(orderId, updates as unknown as Partial<Order>, {
        userId,
        actorRole: userRole,
    });

    if (updatedOrder) {
        if (changes.supplierId !== undefined) {
            await addOrderEvent({
                orderId,
                eventType: ORDER_EVENT_TYPES.supplierChanged,
                oldValue: order.supplierId || null,
                newValue: changes.supplierId || null,
                reason: reasonCode,
                notes: reasonNote,
                actorUserId: userId,
                actorRole: userRole,
            });
        }
        if (changes.designerId !== undefined) {
            await addOrderEvent({
                orderId,
                eventType: ORDER_EVENT_TYPES.designerChanged,
                oldValue: order.designerId || null,
                newValue: changes.designerId || null,
                reason: reasonCode,
                notes: reasonNote,
                actorUserId: userId,
                actorRole: userRole,
            });
        }
    }

    return updatedOrder;
}

/**
 * WF-2: Generic urgency-change wrapper for admin/lab callers, with audit.
 */
export async function updateUrgencyWithReason(
    orderId: string,
    isUrgent: boolean,
    reasonCode: string,
    reasonNote?: string | null,
): Promise<Order | null> {
    if (!orderId || typeof orderId !== 'string') {
        throw new ValidationError('orderId is required');
    }

    const { role: userRole, userId } = await getCallerRoleAndId();

    const { getOrder } = await import('./orders');
    const order = await getOrder(orderId);
    if (!order) {
        throw new ValidationError('الطلب غير موجود');
    }

    const currentStatus = getProductionStatus(order);
    const currentIssueState = getEffectiveIssueState(order);

    if (!canEditOrderField(userRole, 'is_urgent', currentStatus, currentIssueState, order.workflowType)) {
        throw new ValidationError('غير مصرح لك بتحديث درجة الاستعجال لهذه الحالة');
    }

    const { updateOrder } = await import('./orders');
    const updatedOrder = await updateOrder(orderId, {
        isUrgent,
    }, {
        userId,
        actorRole: userRole,
    });

    if (updatedOrder) {
        await addOrderEvent({
            orderId,
            eventType: ORDER_EVENT_TYPES.urgencyChanged,
            oldValue: order.isUrgent ? 'true' : 'false',
            newValue: isUrgent ? 'true' : 'false',
            reason: reasonCode,
            notes: reasonNote,
            actorUserId: userId,
            actorRole: userRole,
        });
    }

    return updatedOrder;
}

// ─── Low-level helper: write an order_events row ─────────────────────────────

/**
 * Direct INSERT helper for `order_events`. Used today only by the RPC body
 * (which writes events server-side). Exposed in TS for WF-3 onward when the
 * unified service will emit non-RPC events (e.g., from workflow transition
 * helpers that also call other side-effecting code).
 */
export async function addOrderEvent(input: {
    orderId: string;
    eventType: string;
    oldValue?: string | null;
    newValue?: string | null;
    reason?: string | null;
    notes?: string | null;
    severity?: 'info' | 'warning' | 'critical';
    metadata?: Record<string, unknown>;
    actorUserId?: string | null;
    actorRole?: string | null;
    responsibilityParty?: string | null;
}): Promise<void> {
    const { error } = await supabase.from('order_events').insert({
        order_id: input.orderId,
        event_type: input.eventType,
        old_value: input.oldValue ?? null,
        new_value: input.newValue ?? null,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        severity: input.severity ?? 'info',
        metadata: input.metadata ?? {},
        changed_by: input.actorUserId ?? null,
        actor_role: input.actorRole ?? null,
        responsibility_party: input.responsibilityParty ?? null,
    });

    if (error) {
        throw ErrorHandler.handle(error, 'addOrderEvent');
    }
}

/**
 * Admin review endpoint for representative order edit proposals.
 * Calls the `admin_review_order_edit` RPC.
 */
export async function adminReviewOrderEdit(
    eventId: string,
    action: 'approve' | 'reject',
    adminNotes?: string | null
): Promise<void> {
    if (!eventId || typeof eventId !== 'string') {
        throw new ValidationError('eventId is required');
    }
    if (!action || !['approve', 'reject'].includes(action)) {
        throw new ValidationError('Invalid action');
    }

    let previousOrder: Order | null = null;
    let orderId: string | null = null;
    let proposedReasonCode: string | null = null;
    let proposedReasonNote: string | null = null;

    const { getOrder, runFinancialCorrectionsAfterOrderUpdate } = await import('./orders');

    if (action === 'approve') {
        // Fetch proposal details and current order state before applying changes
        const { data: eventRow, error: eventError } = await supabase
            .from('order_events')
            .select('order_id, reason, notes')
            .eq('id', eventId)
            .eq('approval_status', 'pending')
            .maybeSingle();

        if (eventError) {
            console.error('Failed to fetch pending proposal event for financial correction sync', eventError);
        }

        if (eventRow) {
            orderId = eventRow.order_id;
            proposedReasonCode = eventRow.reason;
            proposedReasonNote = eventRow.notes;
            if (orderId) {
                previousOrder = await getOrder(orderId);
            }
        }
    }

    const { error } = await supabase.rpc('admin_review_order_edit', {
        p_event_id: eventId,
        p_action: action,
        p_admin_notes: adminNotes ?? null,
    });

    if (error) {
        throw ErrorHandler.handle(error, 'adminReviewOrderEdit');
    }

    // If approved and we have the previous order state, run financial corrections
    if (action === 'approve' && orderId && previousOrder) {
        const updatedOrder = await getOrder(orderId);
        if (updatedOrder) {
            let adminUserId: string | null = null;
            try {
                const caller = await getCallerRoleAndId();
                adminUserId = caller.userId;
            } catch (e) {
                console.warn('Failed to resolve admin user ID for financial corrections auditing', e);
            }

            const combinedNote = proposedReasonNote || '';
            const finalNote = combinedNote + (adminNotes ? ` (ملاحظة المسؤول: ${adminNotes})` : '');

            await runFinancialCorrectionsAfterOrderUpdate(
                previousOrder,
                updatedOrder,
                adminUserId,
                proposedReasonCode,
                finalNote || null
            );
        }
    }
}
