import { BILLING_ENTITY_TYPES } from '../../constants/billingSettings';
import {
    OBLIGATION_DIRECTIONS,
    OBLIGATION_SOURCES,
    OBLIGATION_STATUSES,
    OBLIGATION_TRIGGER_TYPES,
    type ObligationTriggerType,
} from '../../constants/financialObligations';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';
import {
    previewHistoricalObligationsBackfill,
    type HistoricalObligationPreviewRow,
    type HistoricalObligationsPreviewEntityType,
    type HistoricalObligationsPreviewParams,
    type HistoricalObligationsPreviewReason,
    type HistoricalObligationsPreviewRowType,
} from './historicalObligationsPreview';
import {
    calculateObligationDueDate,
    createFinancialObligation,
    findExistingObligation,
    type FinancialObligationInput,
} from './financialObligations';

type WritableHistoricalReason =
    | 'missing_doctor_receivable'
    | 'missing_external_lab_payable'
    | 'missing_external_lab_issue_settlement';

export interface HistoricalObligationsBackfillBatchParams {
    entityType?: HistoricalObligationsPreviewEntityType;
    rowType?: HistoricalObligationsPreviewRowType;
    reason?: 'all' | WritableHistoricalReason;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    dryRun?: boolean;
    actorRole?: string | null;
    createdBy?: string | null;
}

export interface HistoricalObligationsBackfillActionRow {
    orderId: string;
    caseId: string;
    patientName: string;
    reason: HistoricalObligationsPreviewReason;
    action: 'would_create' | 'created' | 'skipped_duplicate' | 'warning' | 'error';
    obligationId?: string;
    amount?: number;
    entityType?: 'doctor' | 'external_lab' | 'designer' | null;
    entityId?: string | null;
    triggerType?: ObligationTriggerType;
    error?: string;
}

export interface HistoricalObligationsBackfillBatchResult {
    processed: number;
    createdDoctorReceivables: { count: number; total: number };
    createdExternalLabPayables: { count: number; total: number };
    createdIssueSettlementPayables: { count: number; total: number };
    skippedDuplicate: number;
    warnings: number;
    errors: HistoricalObligationsBackfillActionRow[];
    hasMore: boolean;
    nextPage: number | null;
    rows: HistoricalObligationsBackfillActionRow[];
}

const WRITABLE_REASONS = new Set<HistoricalObligationsPreviewReason>([
    'missing_doctor_receivable',
    'missing_external_lab_payable',
    'missing_external_lab_issue_settlement',
]);

function isWritableReason(reason: HistoricalObligationsPreviewReason): reason is WritableHistoricalReason {
    return WRITABLE_REASONS.has(reason);
}

function emptyTotals() {
    return {
        createdDoctorReceivables: { count: 0, total: 0 },
        createdExternalLabPayables: { count: 0, total: 0 },
        createdIssueSettlementPayables: { count: 0, total: 0 },
    };
}

function summarizeCreated(
    result: HistoricalObligationsBackfillBatchResult,
    row: HistoricalObligationPreviewRow
): void {
    if (row.reason === 'missing_doctor_receivable') {
        result.createdDoctorReceivables.count += 1;
        result.createdDoctorReceivables.total += row.amount;
    } else if (row.reason === 'missing_external_lab_payable') {
        result.createdExternalLabPayables.count += 1;
        result.createdExternalLabPayables.total += row.amount;
    } else if (row.reason === 'missing_external_lab_issue_settlement') {
        result.createdIssueSettlementPayables.count += 1;
        result.createdIssueSettlementPayables.total += row.amount;
    }
}

function actionBase(row: HistoricalObligationPreviewRow): Omit<HistoricalObligationsBackfillActionRow, 'action'> {
    return {
        orderId: row.orderId,
        caseId: row.caseId,
        patientName: row.patientName,
        reason: row.reason,
        amount: row.amount,
        entityType: row.entityType,
        entityId: row.entityType === 'doctor' ? row.doctorId : row.supplierId,
    };
}

function buildHistoricalObligationInput(
    row: HistoricalObligationPreviewRow,
    createdBy?: string | null
): FinancialObligationInput {
    if (!row.entityType) throw new ValidationError('لا يمكن إنشاء استحقاق تاريخي من صف تحذير');

    const common = {
        orderId: row.orderId,
        triggerStatus: row.status,
        triggerDate: row.date,
        grossAmount: row.amount,
        adjustmentAmount: 0,
        allocatedAmount: 0,
        status: OBLIGATION_STATUSES.unpaid,
        source: OBLIGATION_SOURCES.order,
        createdBy: createdBy || null,
    };

    if (row.reason === 'missing_doctor_receivable') {
        if (!row.doctorId) throw new ValidationError('لا يمكن إنشاء مستحق دكتور بدون معرف الدكتور');
        return {
            ...common,
            entityType: BILLING_ENTITY_TYPES.doctor,
            entityId: row.doctorId,
            direction: OBLIGATION_DIRECTIONS.receivable,
            triggerType: OBLIGATION_TRIGGER_TYPES.doctorDelivered,
            dueDate: '',
            metadata: {
                backfill: true,
                backfillType: 'historical_doctor_receivable',
                caseId: row.caseId,
                patientName: row.patientName,
                status: row.status,
                dateBasis: row.dateBasis,
                shadowMode: true,
                trackingOnly: true,
            },
        };
    }

    if (row.reason === 'missing_external_lab_payable') {
        if (!row.supplierId) throw new ValidationError('لا يمكن إنشاء مستحق معمل بدون معرف المعمل');
        return {
            ...common,
            entityType: BILLING_ENTITY_TYPES.externalLab,
            entityId: row.supplierId,
            direction: OBLIGATION_DIRECTIONS.payable,
            triggerType: OBLIGATION_TRIGGER_TYPES.externalLabReady,
            dueDate: '',
            metadata: {
                backfill: true,
                backfillType: 'historical_external_lab_payable',
                cost: row.cost ?? row.amount,
                manualCost: row.manualCost ?? null,
                defaultCost: row.defaultCost ?? null,
                costSource: row.costSource || 'unknown',
                caseId: row.caseId,
                patientName: row.patientName,
                status: row.status,
                deliveryType: row.deliveryType || null,
                dateBasis: row.dateBasis,
                impliedFinalReady: ['Delivered', 'Completed'].includes(row.status),
                normalExternalLabPayable: true,
                shadowMode: true,
                trackingOnly: true,
            },
        };
    }

    if (row.reason === 'missing_external_lab_issue_settlement') {
        if (!row.supplierId) throw new ValidationError('لا يمكن إنشاء تسوية معمل بدون معرف المعمل');
        return {
            ...common,
            entityType: BILLING_ENTITY_TYPES.externalLab,
            entityId: row.supplierId,
            direction: OBLIGATION_DIRECTIONS.payable,
            triggerType: OBLIGATION_TRIGGER_TYPES.externalLabIssueSettlement,
            dueDate: '',
            metadata: {
                backfill: true,
                backfillType: 'historical_external_lab_issue_settlement',
                issueBased: true,
                adminEnteredAmount: true,
                sourceField: 'rejectedLabCost',
                rejectedLabCost: row.amount,
                caseId: row.caseId,
                patientName: row.patientName,
                status: row.status,
                deliveryType: row.deliveryType || null,
                dateBasis: row.dateBasis,
                shadowMode: true,
                trackingOnly: true,
            },
        };
    }

    throw new ValidationError('نوع صف الباكفيل التاريخي غير مدعوم للكتابة');
}

function matchesReasonFilter(row: HistoricalObligationPreviewRow, reason?: HistoricalObligationsBackfillBatchParams['reason']): boolean {
    return !reason || reason === 'all' || row.reason === reason;
}

async function duplicateExists(input: FinancialObligationInput): Promise<boolean> {
    const existing = await findExistingObligation({
        orderId: input.orderId,
        entityType: input.entityType,
        entityId: input.entityId,
        direction: input.direction,
        triggerType: input.triggerType,
        source: input.source,
    });
    return Boolean(existing);
}

export async function createHistoricalObligationsBackfillBatch(
    params: HistoricalObligationsBackfillBatchParams = {}
): Promise<HistoricalObligationsBackfillBatchResult> {
    const dryRun = params.dryRun !== false;
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(params.pageSize || 50, 100));

    if (!dryRun && params.actorRole !== 'admin') {
        throw new ValidationError('لا يمكن تنفيذ الباكفيل التاريخي إلا بواسطة مدير النظام');
    }

    const previewParams: HistoricalObligationsPreviewParams = {
        entityType: params.entityType || 'all',
        rowType: params.rowType || 'all',
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        search: params.search,
        page,
        pageSize,
    };

    const preview = await previewHistoricalObligationsBackfill(previewParams);
    const result: HistoricalObligationsBackfillBatchResult = {
        processed: 0,
        ...emptyTotals(),
        skippedDuplicate: 0,
        warnings: 0,
        errors: [],
        hasMore: preview.rows.length >= pageSize,
        nextPage: preview.rows.length >= pageSize ? page + 1 : null,
        rows: [],
    };

    for (const row of preview.rows) {
        if (row.rowType === 'missing_data_warning') {
            result.warnings += 1;
            result.rows.push({ ...actionBase(row), action: 'warning' });
            continue;
        }

        if (!isWritableReason(row.reason) || !matchesReasonFilter(row, params.reason)) {
            continue;
        }

        result.processed += 1;
        const input = buildHistoricalObligationInput(row, params.createdBy || null);
        const dueDate = await calculateObligationDueDate(input);
        input.dueDate = dueDate;

        if (dryRun) {
            result.rows.push({
                ...actionBase(row),
                action: 'would_create',
                entityType: input.entityType,
                entityId: input.entityId,
                triggerType: input.triggerType,
            });
            summarizeCreated(result, row);
            continue;
        }

        try {
            if (await duplicateExists(input)) {
                result.skippedDuplicate += 1;
                result.rows.push({
                    ...actionBase(row),
                    action: 'skipped_duplicate',
                    entityType: input.entityType,
                    entityId: input.entityId,
                    triggerType: input.triggerType,
                });
                continue;
            }

            const obligation = await createFinancialObligation(input);
            result.rows.push({
                ...actionBase(row),
                action: 'created',
                obligationId: obligation.id,
                entityType: obligation.entityType,
                entityId: obligation.entityId,
                triggerType: obligation.triggerType,
            });
            summarizeCreated(result, row);
        } catch (error) {
            const handled = ErrorHandler.handle(error, 'createHistoricalObligationsBackfillBatch.create');
            const errorRow: HistoricalObligationsBackfillActionRow = {
                ...actionBase(row),
                action: 'error',
                error: handled.message,
            };
            result.errors.push(errorRow);
            result.rows.push(errorRow);
        }
    }

    return result;
}
