import { getDoctorReceivableAmount, getOfficialStatementDate, isDoctorStatementIncluded } from '../../constants/orderLifecycle';
import { ErrorHandler } from '../../lib/errorHandler';
import type { Adjustment } from '../financeService';
import type { Order } from '../db';
import { getLabCostMetadata } from '../../constants/financialObligations';

export type FinancialReconciliationEntityType = 'all' | 'doctor' | 'external_lab';

export type FinancialReconciliationFlag =
    | 'difference_zero'
    | 'difference_nonzero'
    | 'missing_transactions'
    | 'obligations_without_transactions'
    | 'payments_without_obligations'
    | 'issue_settlement_present'
    | 'possible_date_range_mismatch'
    | 'data_missing'
    | 'account_closing_or_dispute_settlement_needed'
    | 'stale_doctor_receivable_after_rejection'
    | 'doctor_payment_missing'
    | 'obligations_include_item_not_in_official_logic';

export interface FinancialReconciliationPreviewParams {
    entityType?: FinancialReconciliationEntityType;
    search?: string;
    page?: number;
    pageSize?: number;
    dateFrom?: string;
    dateTo?: string;
}

export interface FinancialReconciliationPreviewRow {
    entityType: 'doctor' | 'external_lab';
    entityId: string;
    entityName: string;
    officialBalance: number;
    obligationTotal: number;
    transactionPaymentTotal: number;
    obligationBasedBalance: number;
    difference: number;
    flags: FinancialReconciliationFlag[];
    notes: string[];
    totalDoctorReceivableObligations?: number;
    totalExternalLabReadyPayables?: number;
    totalExternalLabIssueSettlementPayables?: number;
}

export interface FinancialReconciliationPreviewResult {
    rows: FinancialReconciliationPreviewRow[];
    summary: {
        doctorCount: number;
        supplierCount: number;
        totalOfficialBalance: number;
        totalObligationBasedBalance: number;
        totalDifference: number;
        entitiesWithDifference: number;
    };
    page: number;
    pageSize: number;
}

type DoctorRow = {
    id: string;
    name: string;
    parent_id: string | null;
    is_center: boolean | null;
};

type SupplierRow = {
    id: string;
    name: string;
};

type OrderRow = {
    id: string;
    doctor_id: string | null;
    supplier_id: string | null;
    designer_id: string | null;
    status: string;
    total_price: number | null;
    cost: number | null;
    design_price: number | null;
    manual_cost: number | null;
    workflow_type: string | null;
    delivery_date: string | null;
    actual_delivery_date: string | null;
    created_at: string;
    is_archived: boolean | null;
    rejected_lab_cost: number | null;
};

type TransactionRow = {
    id: string;
    type: 'income' | 'expense';
    amount: number;
    date: string;
    category: string | null;
    description: string | null;
    entity_id: string | null;
    entity_type: 'doctor' | 'supplier' | 'general' | 'designer' | 'representative' | null;
};

type ObligationRow = {
    order_id: string;
    entity_type: 'doctor' | 'external_lab' | 'designer';
    entity_id: string;
    direction: 'receivable' | 'payable';
    trigger_type: string;
    net_amount: number;
    trigger_date: string;
    status: string;
};

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function getSupabaseClient() {
    const { supabase } = await import('../../lib/supabase');
    return supabase;
}

const dateOnly = (value?: string | null) => (value || '').split('T')[0];

function isInRange(date: string, params: FinancialReconciliationPreviewParams): boolean {
    const day = dateOnly(date);
    if (!day) return false;
    if (params.dateFrom && day < params.dateFrom) return false;
    if (params.dateTo && day > params.dateTo) return false;
    return true;
}

function addTo(map: Map<string, number>, key: string | null | undefined, amount: number): void {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + (amount || 0));
}

function getDoctorSummaryId(doctorId: string, parentByDoctorId: Map<string, string>): string {
    return parentByDoctorId.get(doctorId) || doctorId;
}

function toLifecycleOrder(row: OrderRow) {
    return {
        id: row.id,
        doctorId: row.doctor_id || '',
        supplierId: row.supplier_id || undefined,
        designerId: row.designer_id || undefined,
        status: row.status as Order['status'],
        totalPrice: row.total_price || 0,
        cost: row.cost || 0,
        designPrice: row.design_price || undefined,
        manualCost: row.manual_cost ?? null,
        workflowType: row.workflow_type as 'full' | 'split' | undefined,
        deliveryDate: row.delivery_date || '',
        actualDeliveryDate: row.actual_delivery_date || undefined,
        createdAt: row.created_at,
        isArchived: row.is_archived || false,
        rejectedLabCost: row.rejected_lab_cost ?? undefined,
    };
}

function getOperationalOrderDate(order: ReturnType<typeof toLifecycleOrder>) {
    return dateOnly(order.deliveryDate || order.createdAt);
}

function isVisibleInAccountStatement(order: ReturnType<typeof toLifecycleOrder>) {
    if (!order.isArchived) return true;
    // Doctor Rejected has the same financial visibility as old 'Rejected' (rejectedLabCost)
    // Lab Rejected is zero-cost, same as Cancelled
    return ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled'].includes(order.status || '');
}

function getSupplierOfficialOrderAmount(order: ReturnType<typeof toLifecycleOrder>, salariedDesignerIds: Set<string>): number | null {
    // Doctor Rejected: same behavior as old 'Rejected' — rejectedLabCost applies if present
    const isDoctorRejected = order.status === 'Doctor Rejected';
    const hasRejectionCost = isDoctorRejected && typeof order.rejectedLabCost === 'number';
    const isRelevant = (order.status !== 'Doctor Rejected' || hasRejectionCost)
        && ((order.status || '').toLowerCase() === 'delivered'
            || (order.status || '').toLowerCase() === 'cancelled'
            || (order.status || '').toLowerCase() === 'lab rejected'  // zero cost
            || hasRejectionCost);

    if (!isRelevant) return null;

    const isSalaried = order.designerId ? salariedDesignerIds.has(order.designerId) : false;
    let cost = getLabCostMetadata(order, isSalaried).cost;
    // Zero cost statuses
    if (order.status === 'Cancelled' || order.status === 'Lab Rejected') cost = 0;
    else if (isDoctorRejected) {
        cost = hasRejectionCost ? order.rejectedLabCost || 0 : 0;
    }
    return cost;
}

function buildFlags(input: {
    difference: number;
    obligationTotal: number;
    transactionPaymentTotal: number;
    issueSettlementTotal?: number;
    hasDateRange: boolean;
    entityName?: string;
    entityType?: 'doctor' | 'external_lab';
    obligationBasedBalance?: number;
    hasSettlementTransaction?: boolean;
    hasStaleDoctorReceivable?: boolean;
}): { flags: FinancialReconciliationFlag[]; notes: string[] } {
    const flags: FinancialReconciliationFlag[] = [];
    const notes: string[] = [];

    if (Math.abs(input.difference) < 0.01) flags.push('difference_zero');
    else flags.push('difference_nonzero');

    if (input.transactionPaymentTotal === 0) flags.push('missing_transactions');
    if (input.obligationTotal > 0 && input.transactionPaymentTotal === 0) flags.push('obligations_without_transactions');
    if (input.transactionPaymentTotal > 0 && input.obligationTotal === 0) flags.push('payments_without_obligations');
    if ((input.issueSettlementTotal || 0) > 0) flags.push('issue_settlement_present');
    if (input.hasDateRange) flags.push('possible_date_range_mismatch');
    if (!input.entityName) flags.push('data_missing');
    if (input.entityType === 'external_lab' && (input.hasSettlementTransaction || (input.obligationBasedBalance || 0) < 0)) {
        flags.push('account_closing_or_dispute_settlement_needed');
        notes.push('Supplier payments exceed normal open obligation balance or include account-closing/dispute wording; review through future settlement workflow, not automatic allocation.');
    }
    if (input.hasStaleDoctorReceivable) {
        flags.push('stale_doctor_receivable_after_rejection');
        flags.push('obligations_include_item_not_in_official_logic');
        notes.push('Active doctor_delivered obligation exists for an order that current official logic does not bill.');
    }
    if (input.entityType === 'doctor' && input.obligationTotal > 0 && input.transactionPaymentTotal === 0 && !input.hasStaleDoctorReceivable) {
        flags.push('doctor_payment_missing');
    }

    if (input.hasDateRange) notes.push('Date range filters can expose timing differences between official account dates and obligation trigger dates.');
    if ((input.issueSettlementTotal || 0) > 0) notes.push('External lab issue settlement obligations are included in the obligation-based payable preview.');

    return { flags, notes };
}

function summarize(rows: FinancialReconciliationPreviewRow[]): FinancialReconciliationPreviewResult['summary'] {
    return {
        doctorCount: rows.filter(row => row.entityType === 'doctor').length,
        supplierCount: rows.filter(row => row.entityType === 'external_lab').length,
        totalOfficialBalance: rows.reduce((sum, row) => sum + row.officialBalance, 0),
        totalObligationBasedBalance: rows.reduce((sum, row) => sum + row.obligationBasedBalance, 0),
        totalDifference: rows.reduce((sum, row) => sum + row.difference, 0),
        entitiesWithDifference: rows.filter(row => Math.abs(row.difference) >= 0.01).length,
    };
}

export async function previewFinancialReconciliation(
    params: FinancialReconciliationPreviewParams = {}
): Promise<FinancialReconciliationPreviewResult> {
    const supabase = await getSupabaseClient();
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(params.pageSize || 50, 100));
    const search = params.search?.trim();
    const hasDateRange = Boolean(params.dateFrom || params.dateTo);

    const [
        doctorsResult,
        suppliersResult,
        ordersResult,
        transactionsResult,
        obligationsResult,
        adjustmentsResult,
        usersResult,
    ] = await Promise.all([
        supabase.from('doctors').select('id, name, parent_id, is_center'),
        supabase.from('suppliers').select('id, name'),
        supabase.from('orders').select('id, doctor_id, supplier_id, designer_id, status, total_price, cost, design_price, manual_cost, workflow_type, delivery_date, actual_delivery_date, created_at, is_archived, rejected_lab_cost'),
        supabase.from('transactions').select('id, type, amount, date, category, description, entity_id, entity_type'),
        supabase.from('financial_obligations').select('order_id, entity_type, entity_id, direction, trigger_type, net_amount, trigger_date, status').neq('status', 'void'),
        supabase.from('adjustments').select('entity_type, entity_id, amount, type, date'),
        supabase.from('users').select('id, custom_permissions'),
    ]);

    if (doctorsResult.error) throw ErrorHandler.handle(doctorsResult.error, 'previewFinancialReconciliation.doctors');
    if (suppliersResult.error) throw ErrorHandler.handle(suppliersResult.error, 'previewFinancialReconciliation.suppliers');
    if (ordersResult.error) throw ErrorHandler.handle(ordersResult.error, 'previewFinancialReconciliation.orders');
    if (transactionsResult.error) throw ErrorHandler.handle(transactionsResult.error, 'previewFinancialReconciliation.transactions');
    if (obligationsResult.error) throw ErrorHandler.handle(obligationsResult.error, 'previewFinancialReconciliation.obligations');
    if (adjustmentsResult.error) throw ErrorHandler.handle(adjustmentsResult.error, 'previewFinancialReconciliation.adjustments');
    if (usersResult.error) throw ErrorHandler.handle(usersResult.error, 'previewFinancialReconciliation.users');

    const doctors = (doctorsResult.data || []) as DoctorRow[];
    const suppliers = (suppliersResult.data || []) as SupplierRow[];
    const orders = ((ordersResult.data || []) as OrderRow[]).map(toLifecycleOrder);
    const transactions = (transactionsResult.data || []) as TransactionRow[];
    const obligations = (obligationsResult.data || []) as ObligationRow[];
    const adjustments = (adjustmentsResult.data || []) as Adjustment[];

    const salariedDesignerIds = new Set(
        (usersResult.data || [])
            .filter(u => u.custom_permissions && u.custom_permissions['designer_fixed_salary'])
            .map(u => u.id)
    );

    const parentByDoctorId = new Map(doctors.map(doctor => [doctor.id, doctor.parent_id || doctor.id]));
    const doctorNames = new Map(doctors.map(doctor => [doctor.id, doctor.name]));
    const supplierNames = new Map(suppliers.map(supplier => [supplier.id, supplier.name]));

    const officialDoctorDebits = new Map<string, number>();
    const officialDoctorCredits = new Map<string, number>();
    const officialSupplierCredits = new Map<string, number>();
    const officialSupplierDebits = new Map<string, number>();

    for (const order of orders) {
        if (!isVisibleInAccountStatement(order)) continue;

        if (order.doctorId) {
            const statementDate = getOfficialStatementDate(order);
            if (isInRange(statementDate, params) && isDoctorStatementIncluded(order)) {
                addTo(officialDoctorDebits, getDoctorSummaryId(order.doctorId, parentByDoctorId), getDoctorReceivableAmount(order));
            }
        }

        if (order.supplierId) {
            const supplierDate = getOperationalOrderDate(order);
            if (isInRange(supplierDate, params)) {
                const amount = getSupplierOfficialOrderAmount(order, salariedDesignerIds);
                if (amount !== null) addTo(officialSupplierCredits, order.supplierId, amount);
            }
        }
    }

    for (const transaction of transactions) {
        if (!isInRange(transaction.date, params)) continue;

        if ((transaction.entity_type === 'doctor' || !transaction.entity_type) && transaction.entity_id && transaction.type === 'income') {
            addTo(officialDoctorCredits, getDoctorSummaryId(transaction.entity_id, parentByDoctorId), transaction.amount || 0);
        } else if ((transaction.entity_type === 'supplier' || !transaction.entity_type) && transaction.entity_id && transaction.type === 'expense') {
            addTo(officialSupplierDebits, transaction.entity_id, transaction.amount || 0);
        }
    }

    for (const adjustment of adjustments) {
        if (!isInRange(adjustment.date, params)) continue;

        if (adjustment.entity_type === 'doctor') {
            const entityId = getDoctorSummaryId(adjustment.entity_id, parentByDoctorId);
            if (adjustment.type === 'charge') addTo(officialDoctorDebits, entityId, adjustment.amount);
            else addTo(officialDoctorCredits, entityId, adjustment.amount);
        } else if (adjustment.entity_type === 'supplier') {
            if (adjustment.type === 'charge') addTo(officialSupplierDebits, adjustment.entity_id, adjustment.amount);
            else addTo(officialSupplierCredits, adjustment.entity_id, adjustment.amount);
        }
    }

    const obligationDoctorReceivables = new Map<string, number>();
    const obligationSupplierReadyPayables = new Map<string, number>();
    const obligationSupplierIssuePayables = new Map<string, number>();
    const staleDoctorReceivableByEntity = new Map<string, number>();
    const supplierSettlementTransactionByEntity = new Map<string, boolean>();
    const orderById = new Map(orders.map(order => [order.id, order]));

    for (const transaction of transactions) {
        if (transaction.entity_id && (transaction.entity_type === 'supplier' || !transaction.entity_type)) {
            const settlementText = `${transaction.category || ''} ${transaction.description || ''}`.toLowerCase();
            if (
                settlementText.includes('تقفيل')
                || settlementText.includes('فرق')
                || settlementText.includes('settlement')
                || settlementText.includes('closing')
                || settlementText.includes('dispute')
                || settlementText.includes('write-off')
                || settlementText.includes('writeoff')
            ) {
                supplierSettlementTransactionByEntity.set(transaction.entity_id, true);
            }
        }
    }

    for (const obligation of obligations) {
        if (!isInRange(obligation.trigger_date, params)) continue;

        if (obligation.entity_type === 'doctor' && obligation.direction === 'receivable' && obligation.trigger_type === 'doctor_delivered') {
            const summaryId = getDoctorSummaryId(obligation.entity_id, parentByDoctorId);
            const order = orderById.get(obligation.order_id);
            addTo(obligationDoctorReceivables, summaryId, obligation.net_amount || 0);
            if (order && getDoctorReceivableAmount(order) <= 0) {
                addTo(staleDoctorReceivableByEntity, summaryId, obligation.net_amount || 0);
            }
        } else if (obligation.entity_type === 'external_lab' && obligation.direction === 'payable' && obligation.trigger_type === 'external_lab_ready') {
            addTo(obligationSupplierReadyPayables, obligation.entity_id, obligation.net_amount || 0);
        } else if (obligation.entity_type === 'external_lab' && obligation.direction === 'payable' && obligation.trigger_type === 'external_lab_issue_settlement') {
            addTo(obligationSupplierIssuePayables, obligation.entity_id, obligation.net_amount || 0);
        }
    }

    const rows: FinancialReconciliationPreviewRow[] = [];

    if (params.entityType !== 'external_lab') {
        const doctorEntityIds = new Set<string>([
            ...doctors.filter(doctor => !doctor.parent_id).map(doctor => doctor.id),
            ...officialDoctorDebits.keys(),
            ...officialDoctorCredits.keys(),
            ...obligationDoctorReceivables.keys(),
        ]);

        for (const entityId of doctorEntityIds) {
            const officialBalance = (officialDoctorDebits.get(entityId) || 0) - (officialDoctorCredits.get(entityId) || 0);
            const obligationTotal = obligationDoctorReceivables.get(entityId) || 0;
            const transactionPaymentTotal = officialDoctorCredits.get(entityId) || 0;
            const obligationBasedBalance = obligationTotal - transactionPaymentTotal;
            const difference = obligationBasedBalance - officialBalance;
            const { flags, notes } = buildFlags({
                difference,
                obligationTotal,
                transactionPaymentTotal,
                hasDateRange,
                entityType: 'doctor',
                entityName: doctorNames.get(entityId),
                hasStaleDoctorReceivable: (staleDoctorReceivableByEntity.get(entityId) || 0) > 0,
            });

            rows.push({
                entityType: 'doctor',
                entityId,
                entityName: doctorNames.get(entityId) || entityId,
                officialBalance,
                obligationTotal,
                transactionPaymentTotal,
                obligationBasedBalance,
                difference,
                flags,
                notes,
                totalDoctorReceivableObligations: obligationTotal,
            });
        }
    }

    if (params.entityType !== 'doctor') {
        const supplierEntityIds = new Set<string>([
            ...suppliers.map(supplier => supplier.id),
            ...officialSupplierCredits.keys(),
            ...officialSupplierDebits.keys(),
            ...obligationSupplierReadyPayables.keys(),
            ...obligationSupplierIssuePayables.keys(),
        ]);

        for (const entityId of supplierEntityIds) {
            const officialBalance = (officialSupplierCredits.get(entityId) || 0) - (officialSupplierDebits.get(entityId) || 0);
            const readyTotal = obligationSupplierReadyPayables.get(entityId) || 0;
            const issueTotal = obligationSupplierIssuePayables.get(entityId) || 0;
            const obligationTotal = readyTotal + issueTotal;
            const transactionPaymentTotal = officialSupplierDebits.get(entityId) || 0;
            const obligationBasedBalance = obligationTotal - transactionPaymentTotal;
            const difference = obligationBasedBalance - officialBalance;
            const { flags, notes } = buildFlags({
                difference,
                obligationTotal,
                transactionPaymentTotal,
                issueSettlementTotal: issueTotal,
                hasDateRange,
                entityType: 'external_lab',
                obligationBasedBalance,
                hasSettlementTransaction: supplierSettlementTransactionByEntity.get(entityId) === true,
                entityName: supplierNames.get(entityId),
            });

            rows.push({
                entityType: 'external_lab',
                entityId,
                entityName: supplierNames.get(entityId) || entityId,
                officialBalance,
                obligationTotal,
                transactionPaymentTotal,
                obligationBasedBalance,
                difference,
                flags,
                notes,
                totalExternalLabReadyPayables: readyTotal,
                totalExternalLabIssueSettlementPayables: issueTotal,
            });
        }
    }

    const filteredRows = rows
        .filter(row => {
            if (!search) return true;
            const normalizedSearch = search.toLowerCase();
            return row.entityName.toLowerCase().includes(normalizedSearch)
                || row.entityId.toLowerCase().includes(normalizedSearch)
                || (isUuid(search) && row.entityId === search)
                || row.entityId === EMPTY_UUID;
        })
        .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.entityName.localeCompare(b.entityName));

    const from = (page - 1) * pageSize;
    const pagedRows = filteredRows.slice(from, from + pageSize);

    return {
        rows: pagedRows,
        summary: summarize(pagedRows),
        page,
        pageSize,
    };
}
