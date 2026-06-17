// WF-1.5 Shadow Validation Report (read-only).
//
// Compares the new shadow columns (production_status, issue_state) against the
// legacy `orders.status` + delivery_type and against existing financial
// obligations to flag suspicious mappings and consistency issues introduced by
// the migration 086 backfill.
//
// This module performs NO mutations. Output is consumed by
// `scripts/workflow-audit.ts` and presented as CSV for admin review before
// WF-2 begins.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionStatus, IssueState } from '../../constants/workflow';

export interface WorkflowAuditRow {
    orderId: string;
    caseId: string | null;
    legacyStatus: string | null;
    deliveryType: string | null;
    productionStatus: ProductionStatus | null;
    issueState: IssueState | null;
    workflowPath: 'final_only' | 'try_in';
    derivedCaseLocation: string;
    actualDeliveryDate: string | null;
    hasActiveDoctorReceivable: boolean;
    hasActiveExternalLabPayable: boolean;
    financialConsistencyFlag: 'ok' | 'missing_doctor_receivable' | 'stale_doctor_receivable' | 'missing_lab_payable' | 'stale_lab_payable';
    suspiciousMappingFlags: string[];
    statusHistoryUsed: boolean;
    repAuditedEditReadiness: boolean;
    needsManualReview: boolean;
    notes: string;
}

interface OrderAuditRecord {
    id: string;
    case_id: string | null;
    status: string | null;
    delivery_type: string | null;
    production_status: ProductionStatus | null;
    issue_state: IssueState | null;
    actual_delivery_date: string | null;
    supplier_id: string | null;
    cost: number | null;
    status_history: Array<{ status?: string; enteredAt?: string }> | null;
}

interface ObligationAuditRecord {
    order_id: string;
    trigger_type: string;
    status: string;
}

function deriveCaseLocation(prod: ProductionStatus | null, issue: IssueState | null): string {
    if (issue === 'cancelled') return 'closed';
    if (issue === 'on_hold') return 'on_hold';
    if (issue === 'returned' || issue === 'doctor_rejected' || issue === 'lab_rejected' || issue === 'redo') return 'issue_review';
    switch (prod) {
        case 'not_started':      return 'pending_intake';
        case 'designing':        return 'internal_design';
        case 'in_production':    return 'internal_production';
        case 'try_in_ready':     return 'internal_ready_try_in';
        case 'waiting_doctor':   return 'with_doctor_waiting';
        case 'finalization':     return 'internal_finalization';
        case 'final_ready':      return 'internal_ready_final';
        case 'final_delivered':  return 'with_doctor_final';
        default:                 return 'unknown';
    }
}

function computeSuspiciousFlags(rec: OrderAuditRecord): string[] {
    const flags: string[] = [];
    if (rec.status === 'Delivered' && rec.delivery_type === 'TryIn') flags.push('delivered_but_tryin');
    if (rec.status === 'Ready' && rec.delivery_type === 'TryIn')     flags.push('ready_tryin');
    if (rec.status === 'Try In') {
        const len = Array.isArray(rec.status_history) ? rec.status_history.length : 0;
        if (len <= 1) flags.push('tryin_no_history');
    }
    if (rec.status === 'Returned for Adjustments') flags.push('legacy_returned');
    if (rec.status === 'Rejected')                  flags.push('legacy_rejected');
    if (rec.status === 'Cancelled')                 flags.push('legacy_cancelled');
    if (rec.delivery_type === null)                  flags.push('null_delivery_type');
    if (rec.production_status === 'final_delivered' && !rec.actual_delivery_date) {
        flags.push('delivered_missing_actual_date');
    }
    if (rec.production_status !== 'final_delivered' && rec.actual_delivery_date) {
        flags.push('nondelivered_with_actual_date');
    }
    return flags;
}

function computeFinancialFlag(
    rec: OrderAuditRecord,
    hasDoctorReceivable: boolean,
    hasLabPayable: boolean
): WorkflowAuditRow['financialConsistencyFlag'] {
    const isFinalDelivered = rec.production_status === 'final_delivered' && rec.issue_state === 'none';
    const isFinalReadyOrLater =
        (rec.production_status === 'final_ready' || rec.production_status === 'final_delivered') &&
        rec.issue_state === 'none';

    if (isFinalDelivered && !hasDoctorReceivable) return 'missing_doctor_receivable';
    if (!isFinalDelivered && hasDoctorReceivable) return 'stale_doctor_receivable';

    const supplierEligible = !!rec.supplier_id && (rec.cost ?? 0) > 0;
    if (isFinalReadyOrLater && supplierEligible && !hasLabPayable) return 'missing_lab_payable';
    if (!isFinalReadyOrLater && hasLabPayable) return 'stale_lab_payable';

    return 'ok';
}

/**
 * Build the WF-1.5 audit rows for ALL orders. Reads via two queries (orders +
 * obligations) to avoid join blow-up for archived data. Streams in pages of
 * 1000 to handle large tables.
 */
export async function buildWorkflowAuditRows(supabase: SupabaseClient): Promise<WorkflowAuditRow[]> {
    const pageSize = 1000;
    let from = 0;
    const allOrders: OrderAuditRecord[] = [];

    // 1. Page through orders.
    while (true) {
        const { data, error } = await supabase
            .from('orders')
            .select('id, case_id, status, delivery_type, production_status, issue_state, actual_delivery_date, supplier_id, cost, status_history')
            .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allOrders.push(...(data as unknown as OrderAuditRecord[]));
        if (data.length < pageSize) break;
        from += pageSize;
    }

    if (allOrders.length === 0) return [];

    // 2. Fetch active financial obligations in chunks of 500 ids.
    const orderIds = allOrders.map(o => o.id);
    const obligationsByOrder = new Map<string, ObligationAuditRecord[]>();

    for (let i = 0; i < orderIds.length; i += 500) {
        const chunk = orderIds.slice(i, i + 500);
        const { data, error } = await supabase
            .from('financial_obligations')
            .select('order_id, trigger_type, status')
            .in('order_id', chunk)
            .neq('status', 'voided');
        if (error) throw error;
        for (const row of (data || []) as ObligationAuditRecord[]) {
            const arr = obligationsByOrder.get(row.order_id) || [];
            arr.push(row);
            obligationsByOrder.set(row.order_id, arr);
        }
    }

    // 3. Build audit rows.
    const rows: WorkflowAuditRow[] = allOrders.map(rec => {
        const obligations = obligationsByOrder.get(rec.id) || [];
        const hasDoctorReceivable = obligations.some(o => o.trigger_type === 'doctor_delivered');
        const hasLabPayable = obligations.some(o => o.trigger_type === 'external_lab_ready');

        const productionStatus = rec.production_status ?? null;
        const issueState = rec.issue_state ?? null;
        const flags = computeSuspiciousFlags(rec);
        const financialFlag = computeFinancialFlag(rec, hasDoctorReceivable, hasLabPayable);

        const isTerminal = ['Returned for Adjustments', 'Doctor Rejected', 'Lab Rejected', 'Rejected', 'Cancelled'].includes(rec.status || '');
        const statusHistoryUsed = isTerminal && Array.isArray(rec.status_history) && rec.status_history.length > 0;

        const workflowPath: 'final_only' | 'try_in' = rec.delivery_type === 'TryIn' ? 'try_in' : 'final_only';

        const repAuditedEditReadiness =
            productionStatus !== 'final_delivered' && issueState === 'none';

        const needsManualReview =
            flags.length > 0 ||
            financialFlag !== 'ok' ||
            (isTerminal && !statusHistoryUsed);

        return {
            orderId: rec.id,
            caseId: rec.case_id,
            legacyStatus: rec.status,
            deliveryType: rec.delivery_type,
            productionStatus,
            issueState,
            workflowPath,
            derivedCaseLocation: deriveCaseLocation(productionStatus, issueState),
            actualDeliveryDate: rec.actual_delivery_date,
            hasActiveDoctorReceivable: hasDoctorReceivable,
            hasActiveExternalLabPayable: hasLabPayable,
            financialConsistencyFlag: financialFlag,
            suspiciousMappingFlags: flags,
            statusHistoryUsed,
            repAuditedEditReadiness,
            needsManualReview,
            notes: '',
        };
    });

    return rows;
}

export interface WorkflowAuditSummary {
    totalRows: number;
    productionStatusCounts: Record<string, number>;
    issueStateCounts: Record<string, number>;
    suspiciousFlagCounts: Record<string, number>;
    financialFlagCounts: Record<string, number>;
    needsManualReviewCount: number;
    repAuditedEditReadinessCount: number;
}

export function summarizeAuditRows(rows: WorkflowAuditRow[]): WorkflowAuditSummary {
    const productionStatusCounts: Record<string, number> = {};
    const issueStateCounts: Record<string, number> = {};
    const suspiciousFlagCounts: Record<string, number> = {};
    const financialFlagCounts: Record<string, number> = {};
    let needsManualReviewCount = 0;
    let repAuditedEditReadinessCount = 0;

    for (const r of rows) {
        productionStatusCounts[r.productionStatus ?? 'null'] = (productionStatusCounts[r.productionStatus ?? 'null'] || 0) + 1;
        issueStateCounts[r.issueState ?? 'null'] = (issueStateCounts[r.issueState ?? 'null'] || 0) + 1;
        for (const f of r.suspiciousMappingFlags) {
            suspiciousFlagCounts[f] = (suspiciousFlagCounts[f] || 0) + 1;
        }
        financialFlagCounts[r.financialConsistencyFlag] = (financialFlagCounts[r.financialConsistencyFlag] || 0) + 1;
        if (r.needsManualReview) needsManualReviewCount++;
        if (r.repAuditedEditReadiness) repAuditedEditReadinessCount++;
    }

    return {
        totalRows: rows.length,
        productionStatusCounts,
        issueStateCounts,
        suspiciousFlagCounts,
        financialFlagCounts,
        needsManualReviewCount,
        repAuditedEditReadinessCount,
    };
}

export function auditRowsToCSV(rows: WorkflowAuditRow[]): string {
    const header = [
        'order_id','case_id','legacy_status','delivery_type','workflow_path',
        'production_status','issue_state','derived_case_location',
        'actual_delivery_date','has_active_doctor_receivable','has_active_external_lab_payable',
        'financial_consistency_flag','suspicious_mapping_flags','status_history_used',
        'rep_audited_edit_readiness','needs_manual_review','notes',
    ];
    const escape = (v: unknown): string => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    };
    const lines = [header.join(',')];
    for (const r of rows) {
        lines.push([
            r.orderId, r.caseId, r.legacyStatus, r.deliveryType, r.workflowPath,
            r.productionStatus, r.issueState, r.derivedCaseLocation,
            r.actualDeliveryDate, r.hasActiveDoctorReceivable, r.hasActiveExternalLabPayable,
            r.financialConsistencyFlag, r.suspiciousMappingFlags.join('|'), r.statusHistoryUsed,
            r.repAuditedEditReadiness, r.needsManualReview, r.notes,
        ].map(escape).join(','));
    }
    return lines.join('\n');
}
