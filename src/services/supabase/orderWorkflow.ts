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
import {
    REP_AUDITED_ALLOW_LIST_CAMEL,
    REP_FIELD_TO_DB,
    type RepAuditedFieldCamel,
} from '../../lib/workflowPermissions';
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

export interface RepEditChanges extends Partial<Pick<Order,
    'patientName' | 'stlUrl' | 'imagesUrl' | 'deliveryDate' |
    'isUrgent' | 'priority' | 'supplierId' | 'designerId' |
    'instructions' | 'items' | 'totalPrice' | 'cost' | 'designPrice'
>> {}

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
    const { getOrder } = await import('./orders');
    return getOrder(orderId);
}

// ─── Future workflow operations (WF-2..WF-4 stubs) ───────────────────────────

/**
 * WF-2/WF-3: Change `production_status` through the same audited pathway.
 * Stubbed in WF-1. Will write `production_status_changed` events and call a
 * sibling RPC `change_production_status`.
 */
export async function changeProductionStatus(
    _orderId: string,
    _newStatus: string,
    _reasonCode: string,
    _reasonNote?: string | null,
): Promise<Order | null> {
    throw new NotImplementedError('changeProductionStatus');
}

/**
 * WF-2/WF-3: Change `issue_state` (returned/rejected/cancelled/on_hold/none).
 * Will void/restore relevant financial obligations via the existing helpers in
 * `orders.ts` after WF-5 alignment.
 */
export async function changeIssueState(
    _orderId: string,
    _newIssueState: string,
    _reasonCode: string,
    _reasonNote?: string | null,
    _responsibilityParty?: string,
): Promise<Order | null> {
    throw new NotImplementedError('changeIssueState');
}

/**
 * WF-2: Generic assignment-change wrapper (supplier_id, designer_id) for
 * admin/lab callers, with audit. Reps use repUpdateOrderWithAudit instead.
 */
export async function updateAssignmentWithReason(
    _orderId: string,
    _changes: { supplierId?: string | null; designerId?: string | null },
    _reasonCode: string,
    _reasonNote?: string | null,
): Promise<Order | null> {
    throw new NotImplementedError('updateAssignmentWithReason');
}

/**
 * WF-2: Generic urgency-change wrapper for admin/lab callers, with audit.
 */
export async function updateUrgencyWithReason(
    _orderId: string,
    _isUrgent: boolean,
    _reasonCode: string,
    _reasonNote?: string | null,
): Promise<Order | null> {
    throw new NotImplementedError('updateUrgencyWithReason');
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

    const { error } = await supabase.rpc('admin_review_order_edit', {
        p_event_id: eventId,
        p_action: action,
        p_admin_notes: adminNotes ?? null,
    });

    if (error) {
        throw ErrorHandler.handle(error, 'adminReviewOrderEdit');
    }
}
