import { supabase } from '../../lib/supabase';
import {
    previewFinancialReconciliation,
    type FinancialReconciliationPreviewRow,
    type FinancialReconciliationPreviewResult,
} from './financialReconciliationPreview';

export type FinancialSnapshotStatus = 'draft' | 'approved' | 'corrective';

export interface FinancialSnapshotPayload {
    generatedAt: string;
    formulaVersion: 'canonical-v1';
    periodStart: string;
    periodEnd: string;
    closing: {
        basis: 'cumulative-through-period-end';
        summary: FinancialReconciliationPreviewResult['summary'];
        rows: FinancialReconciliationPreviewRow[];
    };
    periodActivity: {
        basis: 'activity-within-period';
        summary: FinancialReconciliationPreviewResult['summary'];
        rows: FinancialReconciliationPreviewRow[];
    };
}

export interface FinancialSnapshotIssueSummary {
    critical: Array<{
        entityType: FinancialReconciliationPreviewRow['entityType'];
        entityId: string;
        entityName: string;
        difference: number;
        flags: FinancialReconciliationPreviewRow['flags'];
    }>;
    warnings: Array<{
        entityType: FinancialReconciliationPreviewRow['entityType'];
        entityId: string;
        entityName: string;
        flags: FinancialReconciliationPreviewRow['flags'];
    }>;
}

export interface FinancialReportSnapshot {
    id: string;
    periodStart: string;
    periodEnd: string;
    label: string;
    status: FinancialSnapshotStatus;
    formulaVersion: string;
    reportPayload: FinancialSnapshotPayload;
    issueSummary: FinancialSnapshotIssueSummary;
    criticalIssueCount: number;
    warningCount: number;
    payloadChecksum: string;
    parentSnapshotId?: string | null;
    approvalReason?: string | null;
    createdBy: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export const ACTIONABLE_FINANCIAL_WARNING_FLAGS = [
    'payments_without_obligations',
    'data_missing',
    'account_closing_or_dispute_settlement_needed',
] as const satisfies readonly FinancialReconciliationPreviewRow['flags'][number][];

const actionableFinancialWarningFlags = new Set<string>(ACTIONABLE_FINANCIAL_WARNING_FLAGS);

export function getActionableFinancialWarningFlags(
    flags: FinancialReconciliationPreviewRow['flags']
): FinancialReconciliationPreviewRow['flags'] {
    return flags.filter(flag => actionableFinancialWarningFlags.has(flag));
}

type SnapshotRow = {
    id: string;
    period_start: string;
    period_end: string;
    label: string;
    status: FinancialSnapshotStatus;
    formula_version: string;
    report_payload: FinancialSnapshotPayload;
    issue_summary: FinancialSnapshotIssueSummary;
    critical_issue_count: number;
    warning_count: number;
    payload_checksum: string;
    parent_snapshot_id: string | null;
    approval_reason: string | null;
    created_by: string;
    approved_by: string | null;
    approved_at: string | null;
    created_at: string;
    updated_at: string;
};

const mapSnapshot = (row: SnapshotRow): FinancialReportSnapshot => ({
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    label: row.label,
    status: row.status,
    formulaVersion: row.formula_version,
    reportPayload: row.report_payload,
    issueSummary: row.issue_summary,
    criticalIssueCount: row.critical_issue_count,
    warningCount: row.warning_count,
    payloadChecksum: row.payload_checksum,
    parentSnapshotId: row.parent_snapshot_id,
    approvalReason: row.approval_reason,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

export function classifyFinancialSnapshotIssues(
    rows: FinancialReconciliationPreviewRow[]
): FinancialSnapshotIssueSummary {
    const critical = rows
        .filter(row => Math.abs(row.difference) >= 0.01)
        .map(row => ({
            entityType: row.entityType,
            entityId: row.entityId,
            entityName: row.entityName,
            difference: row.difference,
            flags: row.flags,
        }));

    const warnings = rows
        .filter(row => (
            Math.abs(row.difference) < 0.01
            && getActionableFinancialWarningFlags(row.flags).length > 0
        ))
        .map(row => ({
            entityType: row.entityType,
            entityId: row.entityId,
            entityName: row.entityName,
            flags: row.flags,
        }));

    return { critical, warnings };
}

export async function getFullFinancialReconciliationPreview(
    periodStart: string | undefined,
    periodEnd: string
): Promise<FinancialReconciliationPreviewResult> {
    const pageSize = 100;
    let page = 1;
    const rows: FinancialReconciliationPreviewRow[] = [];
    let latestSummary: FinancialReconciliationPreviewResult['summary'] = {
        doctorCount: 0,
        supplierCount: 0,
        designerCount: 0,
        totalOfficialBalance: 0,
        totalObligationBasedBalance: 0,
        totalDifference: 0,
        entitiesWithDifference: 0,
    };

    while (true) {
        const result = await previewFinancialReconciliation({
            entityType: 'all',
            dateFrom: periodStart,
            dateTo: periodEnd,
            page,
            pageSize,
        });
        rows.push(...result.rows);
        latestSummary = result.summary;
        if (result.rows.length < pageSize) break;
        page += 1;
    }

    return {
        rows,
        summary: latestSummary,
        page: 1,
        pageSize: rows.length,
    };
}

export async function buildFinancialSnapshotPayload(
    periodStart: string,
    periodEnd: string
): Promise<{
    payload: FinancialSnapshotPayload;
    issues: FinancialSnapshotIssueSummary;
}> {
    const [closingPreview, periodActivityPreview] = await Promise.all([
        getFullFinancialReconciliationPreview(undefined, periodEnd),
        getFullFinancialReconciliationPreview(periodStart, periodEnd),
    ]);
    const payload: FinancialSnapshotPayload = {
        generatedAt: new Date().toISOString(),
        formulaVersion: 'canonical-v1',
        periodStart,
        periodEnd,
        closing: {
            basis: 'cumulative-through-period-end',
            summary: closingPreview.summary,
            rows: closingPreview.rows,
        },
        periodActivity: {
            basis: 'activity-within-period',
            summary: periodActivityPreview.summary,
            rows: periodActivityPreview.rows,
        },
    };

    return {
        payload,
        issues: classifyFinancialSnapshotIssues(closingPreview.rows),
    };
}

export async function listFinancialSnapshots(): Promise<FinancialReportSnapshot[]> {
    const { data, error } = await supabase
        .from('financial_report_snapshots')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return ((data ?? []) as unknown as SnapshotRow[]).map(mapSnapshot);
}

export async function createFinancialSnapshot(input: {
    periodStart: string;
    periodEnd: string;
    label: string;
    payload: FinancialSnapshotPayload;
    issues: FinancialSnapshotIssueSummary;
}): Promise<FinancialReportSnapshot> {
    const { data, error } = await supabase.rpc('create_financial_report_snapshot', {
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
        p_label: input.label,
        p_report_payload: input.payload,
        p_issue_summary: input.issues,
        p_critical_issue_count: input.issues.critical.length,
        p_warning_count: input.issues.warnings.length,
    });

    if (error) throw error;
    return mapSnapshot(data as unknown as SnapshotRow);
}

export async function approveFinancialSnapshot(
    snapshotId: string,
    reason?: string
): Promise<FinancialReportSnapshot> {
    const { data, error } = await supabase.rpc('approve_financial_report_snapshot', {
        p_snapshot_id: snapshotId,
        p_reason: reason?.trim() || null,
    });

    if (error) throw error;
    return mapSnapshot(data as unknown as SnapshotRow);
}

export async function addFinancialSnapshotNote(
    snapshotId: string,
    note: string
): Promise<void> {
    const { error } = await supabase.rpc('add_financial_snapshot_note', {
        p_snapshot_id: snapshotId,
        p_note: note,
    });
    if (error) throw error;
}
