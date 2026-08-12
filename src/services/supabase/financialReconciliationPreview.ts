import { getDoctorReceivableAmount, getOfficialStatementDate, isDoctorStatementIncluded } from '../../constants/orderLifecycle';
import { ErrorHandler } from '../../lib/errorHandler';
import type { Adjustment } from '../financeService';
import type { Order } from '../db';
import { getLabCostMetadata } from '../../constants/financialObligations';
import { isVisibleInAccountStatement as isVisibleInAccountStatementHelper, isDoctorRejectedStatus, isLabRejectedStatus } from '../../lib/orderStatusHelpers';
import { isDateInOpenRange } from '../../utils/dateRange';

export type FinancialReconciliationEntityType = 'all' | 'doctor' | 'external_lab' | 'designer';

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
    entityType: 'doctor' | 'external_lab' | 'designer';
    entityId: string;
    entityName: string;
    officialBalance: number;
    obligationTotal: number;
    transactionPaymentTotal: number;
    adjustmentDebitTotal: number;
    adjustmentCreditTotal: number;
    obligationBasedBalance: number;
    difference: number;
    flags: FinancialReconciliationFlag[];
    notes: string[];
    totalDoctorReceivableObligations?: number;
    totalExternalLabReadyPayables?: number;
    totalExternalLabIssueSettlementPayables?: number;
    orderDifferences: FinancialReconciliationOrderDifference[];
}

export interface FinancialReconciliationOrderDifference {
    orderId: string;
    caseId: string;
    status: string;
    officialAmount: number;
    activeObligationAmount: number;
    voidObligationAmount: number;
    difference: number;
    classification: 'missing_obligation' | 'orphan_obligation' | 'amount_mismatch' | 'date_range_mismatch';
    triggerTypes: string[];
    triggerDates: string[];
    activeComponents: Array<{
        triggerType: string;
        source: string;
        amount: number;
        date: string;
    }>;
    voidComponents: Array<{
        triggerType: string;
        source: string;
        amount: number;
        date: string;
    }>;
}

export function calculateCanonicalAccountBalance(input: {
    accountNature: 'debit' | 'credit';
    obligationDebitTotal: number;
    obligationCreditTotal: number;
    adjustmentDebitTotal: number;
    adjustmentCreditTotal: number;
    cashDebitTotal: number;
    cashCreditTotal: number;
}): number {
    const totalDebit = input.obligationDebitTotal
        + input.adjustmentDebitTotal
        + input.cashDebitTotal;
    const totalCredit = input.obligationCreditTotal
        + input.adjustmentCreditTotal
        + input.cashCreditTotal;

    return input.accountNature === 'debit'
        ? totalDebit - totalCredit
        : totalCredit - totalDebit;
}

export interface FinancialReconciliationPreviewResult {
    rows: FinancialReconciliationPreviewRow[];
    summary: {
        doctorCount: number;
        supplierCount: number;
        designerCount: number;
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
    case_id: string | null;
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
    is_deleted: boolean | null;
    rejected_lab_cost: number | null;
    rejected_designer_cost: number | null;
    rejection_doctor_decision: 'decide_later' | 'full_price' | 'zero' | 'custom_amount' | null;
    rejected_doctor_amount: number | null;
    rejection_financial_review_status: 'pending' | 'resolved' | null;
    production_status: Order['productionStatus'] | null;
    issue_state: Order['issueState'] | null;
    design_status: string | null;
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
    source: string;
};

type DesignerUserRow = {
    id: string;
    name: string | null;
    username: string | null;
    role: string;
    custom_permissions: Record<string, unknown> | null;
};

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function getSupabaseClient() {
    const { supabase } = await import('../../lib/supabase');
    return supabase;
}

const dateOnly = (value?: string | null) => (value || '').split('T')[0];

function isInRange(date: string, params: FinancialReconciliationPreviewParams): boolean {
    return isDateInOpenRange(date, { start: params.dateFrom, end: params.dateTo });
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
        caseId: row.case_id || row.id,
        doctorId: row.doctor_id || '',
        supplierId: row.supplier_id || undefined,
        designerId: row.designer_id || undefined,
        status: row.status as Order['status'],
        totalPrice: row.total_price || 0,
        cost: row.cost || 0,
        designPrice: row.design_price || undefined,
        designStatus: (row.design_status || undefined) as Order['designStatus'],
        manualCost: row.manual_cost ?? null,
        workflowType: row.workflow_type as 'full' | 'split' | undefined,
        deliveryDate: row.delivery_date || '',
        actualDeliveryDate: row.actual_delivery_date || undefined,
        createdAt: row.created_at,
        isArchived: row.is_archived || false,
        isDeleted: row.is_deleted || false,
        rejectedLabCost: row.rejected_lab_cost ?? undefined,
        rejectedDesignerCost: row.rejected_designer_cost ?? undefined,
        rejectionDoctorDecision: row.rejection_doctor_decision ?? undefined,
        rejectedDoctorAmount: row.rejected_doctor_amount ?? undefined,
        rejectionFinancialReviewStatus: row.rejection_financial_review_status ?? undefined,
        productionStatus: row.production_status ?? undefined,
        issueState: row.issue_state ?? undefined,
    };
}

function getOperationalOrderDate(order: ReturnType<typeof toLifecycleOrder>) {
    return dateOnly(order.deliveryDate || order.createdAt);
}

function isVisibleInAccountStatement(order: ReturnType<typeof toLifecycleOrder>) {
    return isVisibleInAccountStatementHelper(order);
}

function getSupplierOfficialOrderAmount(order: ReturnType<typeof toLifecycleOrder>, salariedDesignerIds: Set<string>): number | null {
    // Doctor Rejected: same behavior as old 'Rejected' — rejectedLabCost applies if present
    const isDoctorRejected = isDoctorRejectedStatus(order.status);
    const hasRejectionCost = isDoctorRejected && typeof order.rejectedLabCost === 'number';
    const isRelevant = (!isDoctorRejected || hasRejectionCost)
        && ((order.status || '').toLowerCase() === 'delivered'
            || (order.status || '').toLowerCase() === 'cancelled'
            || isLabRejectedStatus(order.status)
            || hasRejectionCost);

    if (!isRelevant) return null;

    const isSalaried = order.designerId ? salariedDesignerIds.has(order.designerId) : false;
    let cost = getLabCostMetadata(order, isSalaried).cost;
    // Zero cost statuses
    if (order.status === 'Cancelled' || isLabRejectedStatus(order.status)) cost = 0;
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
    entityType?: 'doctor' | 'external_lab' | 'designer';
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
    if (input.entityType === 'external_lab' && (input.obligationBasedBalance || 0) < -0.01) {
        flags.push('account_closing_or_dispute_settlement_needed');
        notes.push('Supplier payments exceed the settled obligation balance; review through the settlement workflow, not automatic allocation.');
    } else if (input.entityType === 'external_lab' && input.hasSettlementTransaction) {
        notes.push('The supplier account contains a documented account-closing or dispute settlement that already reconciles to the official balance.');
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
        designerCount: rows.filter(row => row.entityType === 'designer').length,
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

    const fetchAllRows = async <T = unknown>(table: string, selectFields: string): Promise<T[]> => {
        let allData: T[] = [];
        let from = 0;
        const limit = 1000;
        let hasMore = true;
        while (hasMore) {
            const { data, error } = await supabase.from(table).select(selectFields).range(from, from + limit - 1);
            if (error) throw error;
            allData = allData.concat((data || []) as unknown as T[]);
            if (!data || data.length < limit) {
                hasMore = false;
            } else {
                from += limit;
            }
        }
        return allData;
    };

    let doctors: DoctorRow[] = [];
    let suppliers: SupplierRow[] = [];
    let orders: ReturnType<typeof toLifecycleOrder>[] = [];
    let transactions: TransactionRow[] = [];
    let allObligations: ObligationRow[] = [];
    let obligations: ObligationRow[] = [];
    let adjustments: Adjustment[] = [];
    let salariedDesignerIds = new Set<string>();
    let designerUsers: DesignerUserRow[] = [];
    let allUsers: DesignerUserRow[] = [];

    try {
        const [
            doctorsResult,
            suppliersResult,
            ordersData,
            transactionsData,
            obligationsData,
            adjustmentsData,
            usersResult,
        ] = await Promise.all([
            supabase.from('doctors').select('id, name, parent_id, is_center'),
            supabase.from('suppliers').select('id, name'),
            fetchAllRows<OrderRow>('orders', 'id, case_id, doctor_id, supplier_id, designer_id, status, total_price, cost, design_price, manual_cost, workflow_type, design_status, delivery_date, actual_delivery_date, created_at, is_archived, is_deleted, rejected_lab_cost, rejected_designer_cost, rejection_doctor_decision, rejected_doctor_amount, rejection_financial_review_status, production_status, issue_state'),
            fetchAllRows<TransactionRow>('transactions', 'id, type, amount, date, category, description, entity_id, entity_type'),
            fetchAllRows<ObligationRow>('financial_obligations', 'order_id, entity_type, entity_id, direction, trigger_type, net_amount, trigger_date, status, source'),
            fetchAllRows<Adjustment>('adjustments', 'entity_type, entity_id, amount, type, date'),
            supabase.from('users').select('id, name, username, role, custom_permissions'),
        ]);

        if (doctorsResult.error) throw ErrorHandler.handle(doctorsResult.error, 'previewFinancialReconciliation.doctors');
        if (suppliersResult.error) throw ErrorHandler.handle(suppliersResult.error, 'previewFinancialReconciliation.suppliers');
        if (usersResult.error) throw ErrorHandler.handle(usersResult.error, 'previewFinancialReconciliation.users');

        doctors = (doctorsResult.data || []) as DoctorRow[];
        suppliers = (suppliersResult.data || []) as SupplierRow[];
        orders = (ordersData as OrderRow[]).map(toLifecycleOrder);
        transactions = transactionsData as TransactionRow[];
        allObligations = obligationsData as ObligationRow[];
        obligations = allObligations.filter(o => o.status !== 'void');
        adjustments = adjustmentsData as Adjustment[];
        const userRows = (usersResult.data || []) as unknown as DesignerUserRow[];
        allUsers = userRows;
        designerUsers = userRows.filter(user => user.role === 'designer');
        salariedDesignerIds = new Set(
            userRows
                .filter(user => user.custom_permissions?.designer_fixed_salary === true)
                .map(user => user.id)
        );
    } catch (err) {
        throw ErrorHandler.handle(err, 'previewFinancialReconciliation.fetch');
    }

    const parentByDoctorId = new Map(doctors.map(doctor => [doctor.id, doctor.parent_id || doctor.id]));
    const doctorNames = new Map(doctors.map(doctor => [doctor.id, doctor.name]));
    const supplierNames = new Map(suppliers.map(supplier => [supplier.id, supplier.name]));
    const designerNames = new Map(
        allUsers.map(user => [user.id, user.name || user.username || user.id])
    );

    const officialDoctorDebits = new Map<string, number>();
    const officialDoctorCredits = new Map<string, number>();
    const officialSupplierCredits = new Map<string, number>();
    const officialSupplierDebits = new Map<string, number>();
    const officialDesignerCredits = new Map<string, number>();
    const officialDesignerDebits = new Map<string, number>();
    const doctorCashCredits = new Map<string, number>();
    const supplierCashDebits = new Map<string, number>();
    const designerCashDebits = new Map<string, number>();
    const adjustmentDebits = new Map<string, number>();
    const adjustmentCredits = new Map<string, number>();
    const officialOrderAmounts = new Map<string, number>();
    const orderMetadata = new Map(orders.map(order => [order.id, {
        caseId: order.caseId,
        status: order.status,
    }]));
    const orderComponentKey = (
        entityType: 'doctor' | 'external_lab' | 'designer',
        entityId: string,
        orderId: string
    ) => `${entityType}:${entityId}:${orderId}`;

    for (const order of orders) {
        if (isVisibleInAccountStatement(order)) {
            if (order.doctorId) {
                const statementDate = getOfficialStatementDate(order);
                if (isInRange(statementDate, params) && isDoctorStatementIncluded(order)) {
                    const entityId = getDoctorSummaryId(order.doctorId, parentByDoctorId);
                    const amount = getDoctorReceivableAmount(order);
                    addTo(officialDoctorDebits, entityId, amount);
                    addTo(officialOrderAmounts, orderComponentKey('doctor', entityId, order.id), amount);
                }
            }

            if (order.supplierId) {
                const supplierDate = getOperationalOrderDate(order);
                if (isInRange(supplierDate, params)) {
                    const amount = getSupplierOfficialOrderAmount(order, salariedDesignerIds);
                    if (amount !== null) {
                        addTo(officialSupplierCredits, order.supplierId, amount);
                        addTo(officialOrderAmounts, orderComponentKey('external_lab', order.supplierId, order.id), amount);
                    }
                }
            }
        }

        if (
            order.designerId
            && order.workflowType === 'split'
            && !salariedDesignerIds.has(order.designerId)
        ) {
            const designerDate = getOperationalOrderDate(order);
            if (isInRange(designerDate, params)) {
                const isRejected = isDoctorRejectedStatus(order.status) || isLabRejectedStatus(order.status);
                const isRelevant = order.designStatus === 'completed'
                    || isRejected
                    || order.status === 'Cancelled';
                if (isRelevant) {
                    let amount = order.designPrice || 0;
                    if (order.status === 'Cancelled' || isLabRejectedStatus(order.status)) amount = 0;
                    else if (isDoctorRejectedStatus(order.status)) {
                        amount = order.rejectedDesignerCost ?? 0;
                    }
                    addTo(officialDesignerCredits, order.designerId, amount);
                    addTo(officialOrderAmounts, orderComponentKey('designer', order.designerId, order.id), amount);
                }
            }
        }
    }

    for (const transaction of transactions) {
        if (!isInRange(transaction.date, params)) continue;

        if ((transaction.entity_type === 'doctor' || !transaction.entity_type) && transaction.entity_id && transaction.type === 'income') {
            const entityId = getDoctorSummaryId(transaction.entity_id, parentByDoctorId);
            addTo(officialDoctorCredits, entityId, transaction.amount || 0);
            addTo(doctorCashCredits, entityId, transaction.amount || 0);
        } else if ((transaction.entity_type === 'supplier' || !transaction.entity_type) && transaction.entity_id && transaction.type === 'expense') {
            addTo(officialSupplierDebits, transaction.entity_id, transaction.amount || 0);
            addTo(supplierCashDebits, transaction.entity_id, transaction.amount || 0);
        } else if (transaction.entity_type === 'designer' && transaction.entity_id && transaction.type === 'expense') {
            addTo(officialDesignerDebits, transaction.entity_id, transaction.amount || 0);
            addTo(designerCashDebits, transaction.entity_id, transaction.amount || 0);
        }
    }

    for (const adjustment of adjustments) {
        if (!isInRange(adjustment.date, params)) continue;

        if (adjustment.entity_type === 'doctor') {
            const entityId = getDoctorSummaryId(adjustment.entity_id, parentByDoctorId);
            if (adjustment.type === 'charge') {
                addTo(officialDoctorDebits, entityId, adjustment.amount);
                addTo(adjustmentDebits, `doctor:${entityId}`, adjustment.amount);
            } else {
                addTo(officialDoctorCredits, entityId, adjustment.amount);
                addTo(adjustmentCredits, `doctor:${entityId}`, adjustment.amount);
            }
        } else if (adjustment.entity_type === 'supplier') {
            if (adjustment.type === 'charge') {
                addTo(officialSupplierDebits, adjustment.entity_id, adjustment.amount);
                addTo(adjustmentDebits, `external_lab:${adjustment.entity_id}`, adjustment.amount);
            } else {
                addTo(officialSupplierCredits, adjustment.entity_id, adjustment.amount);
                addTo(adjustmentCredits, `external_lab:${adjustment.entity_id}`, adjustment.amount);
            }
        } else if (adjustment.entity_type === 'designer') {
            if (adjustment.type === 'charge') {
                addTo(officialDesignerDebits, adjustment.entity_id, adjustment.amount);
                addTo(adjustmentDebits, `designer:${adjustment.entity_id}`, adjustment.amount);
            } else {
                addTo(officialDesignerCredits, adjustment.entity_id, adjustment.amount);
                addTo(adjustmentCredits, `designer:${adjustment.entity_id}`, adjustment.amount);
            }
        }
    }

    const obligationDoctorReceivables = new Map<string, number>();
    const obligationSupplierReadyPayables = new Map<string, number>();
    const obligationSupplierIssuePayables = new Map<string, number>();
    const obligationDesignerPayables = new Map<string, number>();
    const activeObligationOrderAmounts = new Map<string, number>();
    const voidObligationOrderAmounts = new Map<string, number>();
    const obligationMetadata = new Map<string, { triggerTypes: Set<string>; triggerDates: Set<string> }>();
    const activeObligationComponents = new Map<string, FinancialReconciliationOrderDifference['activeComponents']>();
    const voidObligationComponents = new Map<string, FinancialReconciliationOrderDifference['voidComponents']>();
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
        const componentKey = orderComponentKey(
            obligation.entity_type,
            obligation.entity_type === 'doctor'
                ? getDoctorSummaryId(obligation.entity_id, parentByDoctorId)
                : obligation.entity_id,
            obligation.order_id
        );
        addTo(activeObligationOrderAmounts, componentKey, obligation.net_amount || 0);
        const metadata = obligationMetadata.get(componentKey) || {
            triggerTypes: new Set<string>(),
            triggerDates: new Set<string>(),
        };
        metadata.triggerTypes.add(obligation.trigger_type);
        metadata.triggerDates.add(dateOnly(obligation.trigger_date));
        obligationMetadata.set(componentKey, metadata);
        activeObligationComponents.set(componentKey, [
            ...(activeObligationComponents.get(componentKey) || []),
            {
                triggerType: obligation.trigger_type,
                source: obligation.source,
                amount: obligation.net_amount || 0,
                date: dateOnly(obligation.trigger_date),
            },
        ]);

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
        } else if (
            obligation.entity_type === 'designer'
            && obligation.direction === 'payable'
            && ['designer_approved', 'designer_issue_settlement'].includes(obligation.trigger_type)
        ) {
            addTo(obligationDesignerPayables, obligation.entity_id, obligation.net_amount || 0);
        }
    }

    for (const obligation of allObligations) {
        if (obligation.status !== 'void' || !isInRange(obligation.trigger_date, params)) continue;
        const componentKey = orderComponentKey(
            obligation.entity_type,
            obligation.entity_type === 'doctor'
                ? getDoctorSummaryId(obligation.entity_id, parentByDoctorId)
                : obligation.entity_id,
            obligation.order_id
        );
        addTo(voidObligationOrderAmounts, componentKey, obligation.net_amount || 0);
        const metadata = obligationMetadata.get(componentKey) || {
            triggerTypes: new Set<string>(),
            triggerDates: new Set<string>(),
        };
        metadata.triggerTypes.add(obligation.trigger_type);
        metadata.triggerDates.add(dateOnly(obligation.trigger_date));
        obligationMetadata.set(componentKey, metadata);
        voidObligationComponents.set(componentKey, [
            ...(voidObligationComponents.get(componentKey) || []),
            {
                triggerType: obligation.trigger_type,
                source: obligation.source,
                amount: obligation.net_amount || 0,
                date: dateOnly(obligation.trigger_date),
            },
        ]);
    }

    const buildOrderDifferences = (
        entityType: 'doctor' | 'external_lab' | 'designer',
        entityId: string
    ): FinancialReconciliationOrderDifference[] => {
        const prefix = `${entityType}:${entityId}:`;
        const componentKeys = new Set<string>([
            ...[...officialOrderAmounts.keys()].filter(key => key.startsWith(prefix)),
            ...[...activeObligationOrderAmounts.keys()].filter(key => key.startsWith(prefix)),
            ...[...voidObligationOrderAmounts.keys()].filter(key => key.startsWith(prefix)),
        ]);

        return [...componentKeys]
            .map(componentKey => {
                const orderId = componentKey.slice(prefix.length);
                const officialAmount = officialOrderAmounts.get(componentKey) || 0;
                const activeObligationAmount = activeObligationOrderAmounts.get(componentKey) || 0;
                const voidObligationAmount = voidObligationOrderAmounts.get(componentKey) || 0;
                const difference = activeObligationAmount - officialAmount;
                const metadata = obligationMetadata.get(componentKey);
                const order = orderMetadata.get(orderId);
                const lifecycleOrder = orderById.get(orderId);
                const officialDate = lifecycleOrder
                    ? (entityType === 'doctor'
                        ? getOfficialStatementDate(lifecycleOrder)
                        : getOperationalOrderDate(lifecycleOrder))
                    : '';
                const officialAmountExcludedByDateRange = Boolean(
                    hasDateRange
                    && lifecycleOrder
                    && !isInRange(officialDate, params)
                    && officialAmount === 0
                    && activeObligationAmount > 0
                );
                const classification: FinancialReconciliationOrderDifference['classification'] = officialAmountExcludedByDateRange
                    ? 'date_range_mismatch'
                    : officialAmount > 0 && activeObligationAmount === 0
                    ? 'missing_obligation'
                    : officialAmount === 0 && activeObligationAmount > 0
                        ? 'orphan_obligation'
                        : 'amount_mismatch';

                return {
                    orderId,
                    caseId: order?.caseId || orderId,
                    status: order?.status || 'unknown',
                    officialAmount,
                    activeObligationAmount,
                    voidObligationAmount,
                    difference,
                    classification,
                    triggerTypes: [...(metadata?.triggerTypes || [])],
                    triggerDates: [...(metadata?.triggerDates || [])],
                    activeComponents: activeObligationComponents.get(componentKey) || [],
                    voidComponents: voidObligationComponents.get(componentKey) || [],
                };
            })
            .filter(item => Math.abs(item.difference) >= 0.01)
            .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
    };

    const rows: FinancialReconciliationPreviewRow[] = [];

    if (params.entityType !== 'external_lab' && params.entityType !== 'designer') {
        const doctorEntityIds = new Set<string>([
            ...doctors.filter(doctor => !doctor.parent_id).map(doctor => doctor.id),
            ...officialDoctorDebits.keys(),
            ...officialDoctorCredits.keys(),
            ...obligationDoctorReceivables.keys(),
        ]);

        for (const entityId of doctorEntityIds) {
            const officialBalance = (officialDoctorDebits.get(entityId) || 0) - (officialDoctorCredits.get(entityId) || 0);
            const obligationTotal = obligationDoctorReceivables.get(entityId) || 0;
            const transactionPaymentTotal = doctorCashCredits.get(entityId) || 0;
            const adjustmentDebitTotal = adjustmentDebits.get(`doctor:${entityId}`) || 0;
            const adjustmentCreditTotal = adjustmentCredits.get(`doctor:${entityId}`) || 0;
            const obligationBasedBalance = calculateCanonicalAccountBalance({
                accountNature: 'debit',
                obligationDebitTotal: obligationTotal,
                obligationCreditTotal: 0,
                adjustmentDebitTotal,
                adjustmentCreditTotal,
                cashDebitTotal: 0,
                cashCreditTotal: transactionPaymentTotal,
            });
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
                adjustmentDebitTotal,
                adjustmentCreditTotal,
                obligationBasedBalance,
                difference,
                flags,
                notes,
                orderDifferences: buildOrderDifferences('doctor', entityId),
                totalDoctorReceivableObligations: obligationTotal,
            });
        }
    }

    if (params.entityType !== 'doctor' && params.entityType !== 'designer') {
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
            const transactionPaymentTotal = supplierCashDebits.get(entityId) || 0;
            const adjustmentDebitTotal = adjustmentDebits.get(`external_lab:${entityId}`) || 0;
            const adjustmentCreditTotal = adjustmentCredits.get(`external_lab:${entityId}`) || 0;
            const obligationBasedBalance = calculateCanonicalAccountBalance({
                accountNature: 'credit',
                obligationDebitTotal: 0,
                obligationCreditTotal: obligationTotal,
                adjustmentDebitTotal,
                adjustmentCreditTotal,
                cashDebitTotal: transactionPaymentTotal,
                cashCreditTotal: 0,
            });
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
                adjustmentDebitTotal,
                adjustmentCreditTotal,
                obligationBasedBalance,
                difference,
                flags,
                notes,
                orderDifferences: buildOrderDifferences('external_lab', entityId),
                totalExternalLabReadyPayables: readyTotal,
                totalExternalLabIssueSettlementPayables: issueTotal,
            });
        }
    }

    if (params.entityType !== 'doctor' && params.entityType !== 'external_lab') {
        const designerEntityIds = new Set<string>([
            ...designerUsers.map(designer => designer.id),
            ...officialDesignerCredits.keys(),
            ...officialDesignerDebits.keys(),
            ...obligationDesignerPayables.keys(),
        ]);

        for (const entityId of designerEntityIds) {
            const officialBalance = (officialDesignerCredits.get(entityId) || 0)
                - (officialDesignerDebits.get(entityId) || 0);
            const obligationTotal = obligationDesignerPayables.get(entityId) || 0;
            const transactionPaymentTotal = designerCashDebits.get(entityId) || 0;
            const adjustmentDebitTotal = adjustmentDebits.get(`designer:${entityId}`) || 0;
            const adjustmentCreditTotal = adjustmentCredits.get(`designer:${entityId}`) || 0;
            const obligationBasedBalance = calculateCanonicalAccountBalance({
                accountNature: 'credit',
                obligationDebitTotal: 0,
                obligationCreditTotal: obligationTotal,
                adjustmentDebitTotal,
                adjustmentCreditTotal,
                cashDebitTotal: transactionPaymentTotal,
                cashCreditTotal: 0,
            });
            const difference = obligationBasedBalance - officialBalance;
            const { flags, notes } = buildFlags({
                difference,
                obligationTotal,
                transactionPaymentTotal,
                hasDateRange,
                entityName: designerNames.get(entityId),
            });

            rows.push({
                entityType: 'designer',
                entityId,
                entityName: designerNames.get(entityId) || entityId,
                officialBalance,
                obligationTotal,
                transactionPaymentTotal,
                adjustmentDebitTotal,
                adjustmentCreditTotal,
                obligationBasedBalance,
                difference,
                flags,
                notes,
                orderDifferences: buildOrderDifferences('designer', entityId),
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
        summary: summarize(filteredRows),
        page,
        pageSize,
    };
}
