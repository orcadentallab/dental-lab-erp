import {
    getDoctorReceivableAmount,
    getOfficialStatementDate,
    getProductionStatus,
    isFinalReady,
    isTryInReady,
} from '../../constants/orderLifecycle';
import {
    getLabCostMetadata,
    OBLIGATION_DIRECTIONS,
    OBLIGATION_SOURCES,
    OBLIGATION_STATUSES,
    OBLIGATION_TRIGGER_TYPES,
    type LabCostSource,
} from '../../constants/financialObligations';
import { BILLING_ENTITY_TYPES } from '../../constants/billingSettings';
import { ErrorHandler } from '../../lib/errorHandler';
import type { Order } from '../db';

export type HistoricalObligationsPreviewEntityType = 'all' | 'doctor' | 'external_lab';
export type HistoricalObligationsPreviewRowType = 'all' | 'missing_obligation' | 'missing_data_warning';
export type HistoricalObligationsPreviewReason =
    | 'missing_doctor_receivable'
    | 'missing_external_lab_payable'
    | 'missing_external_lab_issue_settlement'
    | 'doctor_receivable_missing_doctor'
    | 'doctor_receivable_zero_or_missing_amount'
    | 'external_lab_payable_missing_supplier'
    | 'external_lab_payable_zero_or_missing_cost'
    | 'try_in_ready_excluded'
    | 'issue_settlement_missing_admin_amount'
    | 'issue_settlement_missing_supplier'
    | 'issue_status_excluded';

export interface HistoricalObligationsPreviewParams {
    entityType?: HistoricalObligationsPreviewEntityType;
    rowType?: HistoricalObligationsPreviewRowType;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}

export interface HistoricalObligationPreviewRow {
    rowType: Exclude<HistoricalObligationsPreviewRowType, 'all'>;
    entityType: Exclude<HistoricalObligationsPreviewEntityType, 'all'> | null;
    reason: HistoricalObligationsPreviewReason;
    orderId: string;
    caseId: string;
    patientName: string;
    status: string;
    deliveryType?: string | null;
    doctorId?: string | null;
    doctorName?: string | null;
    supplierId?: string | null;
    supplierName?: string | null;
    amount: number;
    date: string;
    dateBasis: 'actualDeliveryDate' | 'deliveryDate' | 'createdAt';
    cost?: number | null;
    manualCost?: number | null;
    defaultCost?: number | null;
    costSource?: LabCostSource;
}

export interface HistoricalObligationsPreviewResult {
    rows: HistoricalObligationPreviewRow[];
    counts: {
        missingDoctorReceivables: number;
        missingExternalLabPayables: number;
        missingIssueSettlementPayables: number;
        warnings: number;
        total: number;
    };
    page: number;
    pageSize: number;
    limitation: string;
}

type HistoricalPreviewOrderRow = {
    id: string;
    case_id: string;
    patient_name: string | null;
    doctor_id: string | null;
    supplier_id: string | null;
    status: string;
    delivery_type: string | null;
    total_price: number | null;
    cost: number | null;
    manual_cost: number | null;
    delivery_date: string | null;
    actual_delivery_date: string | null;
    rejected_lab_cost: number | null;
    created_at: string;
};

type ExistingObligationRow = {
    order_id: string;
    entity_type: 'doctor' | 'external_lab' | 'designer';
    entity_id: string;
    direction: 'receivable' | 'payable';
    trigger_type: string;
    source: string;
    status: string;
};

const PREVIEW_CANDIDATE_STATUSES = [
    'Delivered',
    'Completed',
    'Ready',
    'Rejected',
    'Cancelled',
    'Returned for Adjustments',
];

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function getSupabaseClient() {
    const { supabase } = await import('../../lib/supabase');
    return supabase;
}

function toPreviewOrder(row: HistoricalPreviewOrderRow): Partial<Order> & { status: string } {
    return {
        id: row.id,
        caseId: row.case_id,
        patientName: row.patient_name || '',
        doctorId: row.doctor_id || '',
        supplierId: row.supplier_id || undefined,
        status: row.status as Order['status'],
        deliveryType: (row.delivery_type || undefined) as Order['deliveryType'],
        totalPrice: row.total_price || 0,
        cost: row.cost || 0,
        manualCost: row.manual_cost ?? null,
        deliveryDate: row.delivery_date || '',
        actualDeliveryDate: row.actual_delivery_date || undefined,
        rejectedLabCost: row.rejected_lab_cost || undefined,
        createdAt: row.created_at,
    };
}

function getDateWithBasis(
    order: Partial<Order>,
    options: { allowActualDeliveryDate?: boolean } = { allowActualDeliveryDate: true }
): { date: string; dateBasis: HistoricalObligationPreviewRow['dateBasis'] } {
    if (options.allowActualDeliveryDate !== false && order.actualDeliveryDate) {
        return { date: order.actualDeliveryDate.split('T')[0], dateBasis: 'actualDeliveryDate' };
    }
    if (order.deliveryDate) {
        return { date: order.deliveryDate.split('T')[0], dateBasis: 'deliveryDate' };
    }
    return { date: (order.createdAt || new Date().toISOString()).split('T')[0], dateBasis: 'createdAt' };
}

function hasActiveObligation(
    obligations: ExistingObligationRow[],
    input: {
        orderId: string;
        entityType: 'doctor' | 'external_lab';
        entityId?: string | null;
        direction: 'receivable' | 'payable';
        triggerType: string;
    }
): boolean {
    if (!input.entityId) return false;

    return obligations.some(obligation =>
        obligation.order_id === input.orderId
        && obligation.entity_type === input.entityType
        && obligation.entity_id === input.entityId
        && obligation.direction === input.direction
        && obligation.trigger_type === input.triggerType
        && obligation.source === OBLIGATION_SOURCES.order
        && obligation.status !== OBLIGATION_STATUSES.void
    );
}

function baseRow(
    order: Partial<Order>,
    names: { doctorName?: string | null; supplierName?: string | null },
    date: { date: string; dateBasis: HistoricalObligationPreviewRow['dateBasis'] }
) {
    return {
        orderId: order.id || '',
        caseId: order.caseId || '',
        patientName: order.patientName || '',
        status: order.status || '',
        deliveryType: order.deliveryType || null,
        doctorId: order.doctorId || null,
        doctorName: names.doctorName || null,
        supplierId: order.supplierId || null,
        supplierName: names.supplierName || null,
        date: date.date,
        dateBasis: date.dateBasis,
    };
}

export function classifyHistoricalOrderForObligationPreview(
    order: Partial<Order>,
    existingObligations: ExistingObligationRow[],
    names: { doctorName?: string | null; supplierName?: string | null } = {},
    salariedDesignerIds?: Set<string>
): HistoricalObligationPreviewRow[] {
    const rows: HistoricalObligationPreviewRow[] = [];
    const productionStatus = getProductionStatus(order);
    const isDelivered = productionStatus === 'final_delivered';
    const isReady = productionStatus === 'final_ready' || productionStatus === 'try_in_ready';
    const operationalDate = getDateWithBasis(order, { allowActualDeliveryDate: isDelivered });
    const base = baseRow(order, names, operationalDate);
    const isIssueStatus = ['Rejected', 'Cancelled', 'Returned for Adjustments'].includes(order.status || '');

    if (isIssueStatus) {
        const rejectedLabCost = order.rejectedLabCost || 0;
        const issueDate = getDateWithBasis(order, { allowActualDeliveryDate: false });
        const issueBase = baseRow(order, names, issueDate);

        if (!order.supplierId && rejectedLabCost > 0) {
            rows.push({
                ...issueBase,
                rowType: 'missing_data_warning',
                entityType: 'external_lab',
                reason: 'issue_settlement_missing_supplier',
                amount: rejectedLabCost,
            });
        } else if (order.supplierId && rejectedLabCost > 0) {
            if (!hasActiveObligation(existingObligations, {
                orderId: order.id || '',
                entityType: BILLING_ENTITY_TYPES.externalLab,
                entityId: order.supplierId,
                direction: OBLIGATION_DIRECTIONS.payable,
                triggerType: OBLIGATION_TRIGGER_TYPES.externalLabIssueSettlement,
            })) {
                rows.push({
                    ...issueBase,
                    rowType: 'missing_obligation',
                    entityType: 'external_lab',
                    reason: 'missing_external_lab_issue_settlement',
                    amount: rejectedLabCost,
                });
            }
        } else {
            rows.push({
                ...issueBase,
                rowType: 'missing_data_warning',
                entityType: null,
                reason: order.supplierId ? 'issue_settlement_missing_admin_amount' : 'issue_status_excluded',
                amount: 0,
            });
        }
        return rows;
    }

    if (isDelivered) {
        const statementDate = getDateWithBasis(order);
        const statementBase = baseRow(order, names, statementDate);
        const receivableAmount = getDoctorReceivableAmount(order);
        if (!order.doctorId) {
            rows.push({
                ...statementBase,
                rowType: 'missing_data_warning',
                entityType: 'doctor',
                reason: 'doctor_receivable_missing_doctor',
                amount: 0,
            });
        } else if (receivableAmount <= 0) {
            rows.push({
                ...statementBase,
                rowType: 'missing_data_warning',
                entityType: 'doctor',
                reason: 'doctor_receivable_zero_or_missing_amount',
                amount: 0,
            });
        } else if (!hasActiveObligation(existingObligations, {
            orderId: order.id || '',
            entityType: BILLING_ENTITY_TYPES.doctor,
            entityId: order.doctorId,
            direction: OBLIGATION_DIRECTIONS.receivable,
            triggerType: OBLIGATION_TRIGGER_TYPES.doctorDelivered,
        })) {
            rows.push({
                ...statementBase,
                rowType: 'missing_obligation',
                entityType: 'doctor',
                reason: 'missing_doctor_receivable',
                amount: receivableAmount,
                date: getOfficialStatementDate(order),
                dateBasis: statementDate.dateBasis,
            });
        }
    }

    if (isReady && isTryInReady(order)) {
        rows.push({
            ...base,
            rowType: 'missing_data_warning',
            entityType: 'external_lab',
            reason: 'try_in_ready_excluded',
            amount: 0,
        });
        return rows;
    }

    const labEligible = isFinalReady(order) || isDelivered;
    if (labEligible) {
        const labDate = getDateWithBasis(order, { allowActualDeliveryDate: isDelivered });
        const labBase = baseRow(order, names, labDate);
        const isSalariedDesigner = Boolean(order.designerId && salariedDesignerIds?.has(order.designerId));
        const labCostMetadata = getLabCostMetadata(order, isSalariedDesigner);
        if (!order.supplierId) {
            rows.push({
                ...labBase,
                rowType: 'missing_data_warning',
                entityType: 'external_lab',
                reason: 'external_lab_payable_missing_supplier',
                amount: 0,
            });
        } else if ((order.cost || 0) <= 0) {
            rows.push({
                ...labBase,
                rowType: 'missing_data_warning',
                entityType: 'external_lab',
                reason: 'external_lab_payable_zero_or_missing_cost',
                amount: 0,
            });
        } else if (!hasActiveObligation(existingObligations, {
            orderId: order.id || '',
            entityType: BILLING_ENTITY_TYPES.externalLab,
            entityId: order.supplierId,
            direction: OBLIGATION_DIRECTIONS.payable,
            triggerType: OBLIGATION_TRIGGER_TYPES.externalLabReady,
        })) {
            rows.push({
                ...labBase,
                rowType: 'missing_obligation',
                entityType: 'external_lab',
                reason: 'missing_external_lab_payable',
                amount: labCostMetadata.cost,
                ...labCostMetadata,
            });
        }
    }

    return rows;
}

function filterPreviewRows(
    rows: HistoricalObligationPreviewRow[],
    params: HistoricalObligationsPreviewParams
): HistoricalObligationPreviewRow[] {
    return rows.filter(row => {
        if (params.entityType && params.entityType !== 'all' && row.entityType !== params.entityType) return false;
        if (params.rowType && params.rowType !== 'all' && row.rowType !== params.rowType) return false;
        if (params.dateFrom && row.date < params.dateFrom) return false;
        if (params.dateTo && row.date > params.dateTo) return false;
        return true;
    });
}

function countRows(rows: HistoricalObligationPreviewRow[]): HistoricalObligationsPreviewResult['counts'] {
    return {
        missingDoctorReceivables: rows.filter(row => row.reason === 'missing_doctor_receivable').length,
        missingExternalLabPayables: rows.filter(row => row.reason === 'missing_external_lab_payable').length,
        missingIssueSettlementPayables: rows.filter(row => row.reason === 'missing_external_lab_issue_settlement').length,
        warnings: rows.filter(row => row.rowType === 'missing_data_warning').length,
        total: rows.length,
    };
}

async function resolveNames(
    doctorIds: string[],
    supplierIds: string[]
): Promise<{ doctorNames: Map<string, string>; supplierNames: Map<string, string> }> {
    const supabase = await getSupabaseClient();
    const doctorNames = new Map<string, string>();
    const supplierNames = new Map<string, string>();

    if (doctorIds.length > 0) {
        const { data, error } = await supabase
            .from('doctors')
            .select('id, name')
            .in('id', doctorIds);

        if (error) throw ErrorHandler.handle(error, 'previewHistoricalObligationsBackfill.doctorNames');
        (data || []).forEach(row => doctorNames.set(row.id, row.name));
    }

    if (supplierIds.length > 0) {
        const { data, error } = await supabase
            .from('suppliers')
            .select('id, name')
            .in('id', supplierIds);

        if (error) throw ErrorHandler.handle(error, 'previewHistoricalObligationsBackfill.supplierNames');
        (data || []).forEach(row => supplierNames.set(row.id, row.name));
    }

    return { doctorNames, supplierNames };
}

export async function previewHistoricalObligationsBackfill(
    params: HistoricalObligationsPreviewParams = {}
): Promise<HistoricalObligationsPreviewResult> {
    const supabase = await getSupabaseClient();
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(params.pageSize || 50, 100));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
        .from('orders')
        .select('id, case_id, patient_name, doctor_id, supplier_id, status, delivery_type, total_price, cost, manual_cost, delivery_date, actual_delivery_date, rejected_lab_cost, created_at')
        .in('status', PREVIEW_CANDIDATE_STATUSES)
        .order('created_at', { ascending: false })
        .range(from, to);

    const search = params.search?.trim();
    if (search) {
        const escapedSearch = search.replace(/[%(),]/g, '');
        const filters = [
            `case_id.ilike.%${escapedSearch}%`,
            `patient_name.ilike.%${escapedSearch}%`,
        ];
        if (isUuid(search)) filters.push(`id.eq.${search}`);
        query = query.or(filters.join(','));
    }

    const { data: orderRows, error: ordersError } = await query;
    if (ordersError) throw ErrorHandler.handle(ordersError, 'previewHistoricalObligationsBackfill.orders');

    const orders = ((orderRows || []) as HistoricalPreviewOrderRow[]).map(toPreviewOrder);
    const orderIds = orders.map(order => order.id).filter(Boolean) as string[];
    const doctorIds = Array.from(new Set(orders.map(order => order.doctorId).filter(Boolean) as string[]));
    const supplierIds = Array.from(new Set(orders.map(order => order.supplierId).filter(Boolean) as string[]));

    let existingObligations: ExistingObligationRow[] = [];
    if (orderIds.length > 0) {
        const { data: obligationRows, error: obligationsError } = await supabase
            .from('financial_obligations')
            .select('order_id, entity_type, entity_id, direction, trigger_type, source, status')
            .in('order_id', orderIds)
            .neq('status', OBLIGATION_STATUSES.void);

        if (obligationsError) throw ErrorHandler.handle(obligationsError, 'previewHistoricalObligationsBackfill.obligations');
        existingObligations = (obligationRows || []) as ExistingObligationRow[];
    }

    const designerIds = Array.from(new Set(orders.map(order => order.designerId).filter(Boolean) as string[]));
    const salariedDesignerIds = new Set<string>();
    if (designerIds.length > 0) {
        const { data: userData } = await supabase
            .from('users')
            .select('id, custom_permissions')
            .in('id', designerIds);
        (userData || []).forEach(u => {
            if (u.custom_permissions?.['designer_fixed_salary']) {
                salariedDesignerIds.add(u.id);
            }
        });
    }

    const { doctorNames, supplierNames } = await resolveNames(doctorIds, supplierIds);
    const classifiedRows = orders.flatMap(order => classifyHistoricalOrderForObligationPreview(
        order,
        existingObligations,
        {
            doctorName: order.doctorId ? doctorNames.get(order.doctorId) || null : null,
            supplierName: order.supplierId ? supplierNames.get(order.supplierId) || null : null,
        },
        salariedDesignerIds
    ));
    const rows = filterPreviewRows(classifiedRows, params);

    return {
        rows,
        counts: countRows(rows),
        page,
        pageSize,
        limitation: 'Counts are based on the current fetched candidate orders page. Accurate global counts may require a future RPC before applying any historical backfill.',
    };
}
