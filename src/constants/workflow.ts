// Workflow constants for the unified order workflow layer (WF-1).
//
// These values mirror the new `orders.production_status` and `orders.issue_state`
// columns introduced in migration 086. They are SHADOW fields in WF-1 — finance
// helpers and the existing `orders.status` enum remain authoritative.
//
// Source of truth for the policy: docs/orders-field-permissions.md.

export const PRODUCTION_STATUSES = [
    'not_started',
    'designing',
    'in_production',
    'try_in_ready',
    'waiting_doctor',
    'finalization',
    'final_ready',
    'final_delivered',
] as const;

export type ProductionStatus = typeof PRODUCTION_STATUSES[number];

export const ISSUE_STATES = [
    'none',
    'returned',
    'doctor_rejected', // Doctor returned case — rejectedLabCost applies
    'lab_rejected',    // Lab internal rejection — zero financial impact
    'cancelled',
    'on_hold',
    'redo',
] as const;

export type IssueState = typeof ISSUE_STATES[number];

// Arabic labels for the timeline / future UI. Kept colocated with the constant
// so additions to the enum cannot drift out of sync.
export const PRODUCTION_STATUS_LABELS_AR: Record<ProductionStatus, string> = {
    not_started: 'لم يبدأ',
    designing: 'قيد التصميم',
    in_production: 'قيد التنفيذ',
    try_in_ready: 'Try-In',
    waiting_doctor: 'في انتظار موافقة الطبيب',
    finalization: 'تنفيذ الفاينال',
    final_ready: 'جاهز نهائي',
    final_delivered: 'تم التسليم النهائي',
};

export const ISSUE_STATE_LABELS_AR: Record<IssueState, string> = {
    none: '—',
    returned: 'مرتجع للتعديل',
    doctor_rejected: 'مرتجع طبيب',  // Doctor returned — rejectedLabCost applies
    lab_rejected: 'رفض معمل',       // Lab rejected internally — zero cost
    cancelled: 'ملغي',
    on_hold: 'موقوف مؤقتاً',
    redo: 'إعادة إنتاج',
};

// Derived case locations (computed by future helpers; constant kept here so the
// timeline UI and the audit report can label rows consistently).
export const CASE_LOCATIONS = [
    'pending_intake',
    'with_designer',
    'internal_design',
    'with_external_lab',
    'internal_production',
    'internal_ready_try_in',
    'with_doctor_waiting',
    'internal_finalization',
    'internal_ready_final',
    'with_doctor_final',
    'issue_review',
    'on_hold',
    'closed',
] as const;

export type CaseLocation = typeof CASE_LOCATIONS[number];

export function isProductionStatus(value: string): value is ProductionStatus {
    return (PRODUCTION_STATUSES as readonly string[]).includes(value);
}

export function isIssueState(value: string): value is IssueState {
    return (ISSUE_STATES as readonly string[]).includes(value);
}

// Sources used in order_events.metadata.source.
// Reused by future workflow transitions, not just representative edits.
export const ORDER_EVENT_SOURCES = [
    'representative_edit',
    'workflow_transition',
    'admin_correction',
    'lab_operation',
] as const;

export type OrderEventSource = typeof ORDER_EVENT_SOURCES[number];

// Feature flag name (Postgres GUC, default 'off'). Mirrored here so the audit
// report and any future readiness UI can display its expected value.
export const WORKFLOW_STRICT_REP_FLAG = 'app.workflow_strict_rep' as const;

// Tx-local flag set inside the audited RPC. Trigger checks it.
export const REP_AUDIT_IN_PROGRESS_FLAG = 'app.rep_audit_in_progress' as const;
