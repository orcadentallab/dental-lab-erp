// Workflow / field-level permission constants (WF-1).
//
// Constants only — no canEditX() / canChangeX() functions yet (those land in
// WF-2). Both this file and the SQL trigger / RPC reference
// docs/orders-field-permissions.md §4 as the canonical matrix.

import type { Order } from '../services/db';
import type { ProductionStatus, IssueState } from '../constants/workflow';

// ─── Roles ───────────────────────────────────────────────────────────────────
export const WORKFLOW_ROLES = ['admin', 'lab', 'accountant', 'designer', 'representative', 'doctor'] as const;
export type WorkflowRole = typeof WORKFLOW_ROLES[number];

// ─── Representative audit-gated allow-list (WF-1) ────────────────────────────
// These are the ONLY fields a representative may change, and ONLY through the
// audited RPC `rep_update_order_fields_with_audit`. items / teeth deferred to WF-1b.
export const REP_AUDITED_ALLOW_LIST = [
    'patient_name',
    'stl_url',
    'images_url',
    'delivery_date',
    'is_urgent',
    'priority',
    'supplier_id',
    'designer_id',
] as const;

export type RepAuditedField = typeof REP_AUDITED_ALLOW_LIST[number];

export function isRepAuditedField(field: string): field is RepAuditedField {
    return (REP_AUDITED_ALLOW_LIST as readonly string[]).includes(field);
}

// camelCase mirror used by the TS-side wrapper (`Order` interface keys).
export const REP_AUDITED_ALLOW_LIST_CAMEL = [
    'patientName',
    'stlUrl',
    'imagesUrl',
    'deliveryDate',
    'isUrgent',
    'priority',
    'supplierId',
    'designerId',
] as const satisfies readonly (keyof Order)[];

export type RepAuditedFieldCamel = typeof REP_AUDITED_ALLOW_LIST_CAMEL[number];

// snake_case ↔ camelCase mapping for the RPC payload conversion.
export const REP_FIELD_TO_DB: Record<RepAuditedFieldCamel, RepAuditedField> = {
    patientName: 'patient_name',
    stlUrl: 'stl_url',
    imagesUrl: 'images_url',
    deliveryDate: 'delivery_date',
    isUrgent: 'is_urgent',
    priority: 'priority',
    supplierId: 'supplier_id',
    designerId: 'designer_id',
};

// ─── Hard deny-list (every role except admin) ────────────────────────────────
// The DB trigger enforces this list for representatives even when the audit flag
// is set. Mirrored here for UI / future predicate helpers.
export const REP_HARD_DENY_LIST = [
    'id', 'case_id', 'created_at', 'updated_at',
    'is_redo', 'original_order_id', 'status_history',
    'is_archived', 'feedback',
    'status', 'production_status', 'issue_state', 'actual_delivery_date',
    'design_status', 'technician_status', 'external_lab_status', 'external_lab_notes',
    'workflow_type', 'delivery_type', 'needs_design_review',
    'total_price', 'cost', 'manual_cost', 'design_price', 'discount', 'rejected_lab_cost',
    'is_registered',
    'doctor_id', 'representative_id',
    'design_url',
    'shade',
    'items',  // deferred to WF-1b
] as const;

// ─── Lab issue_state restrictions (enforced by trigger; mirrored for UI) ─────
export const LAB_BLOCKED_ISSUE_STATES: readonly IssueState[] = ['rejected', 'cancelled'];
export const ADMIN_ONLY_ISSUE_STATES: readonly IssueState[] = ['rejected', 'cancelled'];

// ─── State guards used by the rep RPC ────────────────────────────────────────
// (Documented here for the future TS predicate layer in WF-2; the DB RPC is the
// authoritative enforcement seat.)
export interface RepStateGuardContext {
    productionStatus: ProductionStatus;
    issueState: IssueState;
    workflowType?: string | null;
}

export const REP_FIELD_STATE_GUARDS: Record<RepAuditedField, (ctx: RepStateGuardContext) => boolean> = {
    patient_name: ctx => ctx.productionStatus !== 'final_delivered' && ctx.issueState === 'none',
    stl_url: ctx => ctx.productionStatus !== 'final_delivered' && ctx.issueState === 'none',
    images_url: ctx => ctx.productionStatus !== 'final_delivered',
    delivery_date: ctx => ctx.productionStatus !== 'final_delivered' && ctx.issueState === 'none',
    priority: ctx => ctx.productionStatus !== 'final_delivered' && ctx.issueState === 'none',
    is_urgent: () => true,
    supplier_id: ctx =>
        ctx.productionStatus !== 'final_ready' &&
        ctx.productionStatus !== 'final_delivered' &&
        ctx.issueState === 'none',
    designer_id: ctx =>
        ctx.productionStatus !== 'finalization' &&
        ctx.productionStatus !== 'final_ready' &&
        ctx.productionStatus !== 'final_delivered' &&
        ctx.issueState === 'none' &&
        ctx.workflowType === 'split',
};
