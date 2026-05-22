// Historical Payment Allocation Preview + Reconciliation (READ-ONLY).
//
// Usage:
//   npx tsx scripts/historical-allocation-preview.ts
//
// This script reads production data and generates:
//   - historical-allocation-preview.md
//   - historical-allocation-preview.csv
//
// Database safety:
//   - Uses SELECT queries only.
//   - Does not call mutating Supabase methods.
//   - Does not create allocations, credits, events, obligations, transactions, or adjustments.

import { execSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    getDoctorReceivableAmount,
    getOfficialStatementDate,
    isDoctorStatementIncluded,
} from '../src/constants/orderLifecycle';
import type { Order } from '../src/services/db';

type DoctorRow = { id: string; name: string; parent_id: string | null; is_center: boolean | null };
type SupplierRow = { id: string; name: string };
type OrderRow = {
    id: string;
    case_id: string | null;
    patient_name: string | null;
    doctor_id: string | null;
    supplier_id: string | null;
    status: string;
    total_price: number | null;
    cost: number | null;
    design_price: number | null;
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
    entity_type: string | null;
};
type ObligationRow = {
    id: string;
    order_id: string;
    entity_type: 'doctor' | 'external_lab' | 'designer';
    entity_id: string;
    direction: 'receivable' | 'payable';
    trigger_type: string;
    gross_amount: number | null;
    net_amount: number | null;
    allocated_amount: number | null;
    remaining_amount: number | null;
    status: string;
    due_date: string | null;
    trigger_date: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
};
type AdjustmentRow = {
    id: string;
    entity_type: 'doctor' | 'supplier' | string;
    entity_id: string;
    type: 'charge' | 'credit';
    amount: number;
    date: string;
};

type EntityKind = 'doctor' | 'external_lab';

type AllocationItem = {
    transactionId: string;
    obligationId: string;
    entityType: EntityKind;
    entityId: string;
    entityName: string;
    amount: number;
    transactionDate: string;
    orderId: string;
    caseId: string;
    patientName: string;
    triggerType: string;
};

type TransactionPreview = {
    transaction: TransactionRow;
    entityType: EntityKind | 'unknown';
    entityId: string;
    entityName: string;
    proposedAllocations: AllocationItem[];
    allocatedAmount: number;
    unallocatedAmount: number;
    flags: string[];
};

type ObligationPreview = {
    obligation: ObligationRow;
    entityType: EntityKind;
    entityId: string;
    entityName: string;
    caseId: string;
    patientName: string;
    currentRemaining: number;
    proposedAllocated: number;
    remainingAfter: number;
    statusAfterPreview: 'unpaid' | 'partially_paid' | 'paid' | 'void' | 'written_off';
    flags: string[];
};

type EntityPreview = {
    entityType: EntityKind;
    entityId: string;
    entityName: string;
    officialBalance: number;
    obligationTotal: number;
    transactionPaymentTotal: number;
    proposedAllocationAmount: number;
    remainingUnpaid: number;
    overpaymentOrCreditCandidate: number;
    unallocatedPaymentAmount: number;
    reconciliationDifferenceBeforeAllocation: number;
    reconciliationDifferenceAfterProposedAllocation: number;
    flags: string[];
    notes: string[];
};

const SETTLEMENT_KEYWORDS = [
    'تقفيل',
    'تسوية',
    'فرق',
    'خلاف',
    'settlement',
    'closing',
    'dispute',
    'write-off',
    'writeoff',
    'manual adjustment',
];

const ISSUE_STATUSES = new Set(['rejected', 'cancelled', 'returned for adjustments', 'returned', 'try in', 'try-in ready']);

const fmt = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (value?: string | null) => (value || '').split('T')[0];
const amountOf = (value: number | null | undefined) => Number(value || 0);

function toLifecycleOrder(row: OrderRow): Partial<Order> {
    return {
        id: row.id,
        doctorId: row.doctor_id || '',
        supplierId: row.supplier_id || undefined,
        status: row.status as Order['status'],
        totalPrice: row.total_price || 0,
        cost: row.cost || 0,
        designPrice: row.design_price || undefined,
        workflowType: (row.workflow_type as Order['workflowType']) || undefined,
        deliveryDate: row.delivery_date || '',
        actualDeliveryDate: row.actual_delivery_date || undefined,
        createdAt: row.created_at,
        isArchived: row.is_archived || false,
        rejectedLabCost: row.rejected_lab_cost ?? undefined,
    };
}

function supplierOfficialOrderAmount(row: OrderRow): number | null {
    const status = row.status || '';
    const lower = status.toLowerCase();
    const hasRejectedCost = status === 'Rejected' && typeof row.rejected_lab_cost === 'number';
    const isRelevant = (status !== 'Rejected' || hasRejectedCost)
        && (lower === 'delivered' || lower === 'cancelled' || hasRejectedCost);
    if (!isRelevant) return null;

    let cost = status === 'Cancelled' || status === 'Rejected' ? 0 : amountOf(row.cost);
    if (hasRejectedCost) cost = amountOf(row.rejected_lab_cost);
    if (row.workflow_type === 'split' && row.design_price && status !== 'Cancelled' && status !== 'Rejected' && !hasRejectedCost) {
        cost -= amountOf(row.design_price);
    }
    return cost;
}

function doctorRootId(doctorId: string, parentByDoctorId: Map<string, string>): string {
    return parentByDoctorId.get(doctorId) || doctorId;
}

function isSettlementTransaction(transaction: TransactionRow): boolean {
    const text = `${transaction.category || ''} ${transaction.description || ''}`.toLowerCase();
    return SETTLEMENT_KEYWORDS.some(keyword => text.includes(keyword));
}

function isIssueLikeOrder(order?: OrderRow): boolean {
    if (!order) return true;
    return ISSUE_STATUSES.has((order.status || '').toLowerCase());
}

function csvCell(value: unknown): string {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function runLinkedJsonQuery<T>(sql: string, field: string): T {
    const tempSqlPath = resolve(process.cwd(), 'scripts', '.historical-allocation-preview.query.sql');
    writeFileSync(tempSqlPath, sql);
    let stdout = '';
    try {
        stdout = execSync(`npx supabase db query --linked -o json -f "${tempSqlPath}"`, {
            cwd: process.cwd(),
            encoding: 'utf8',
            maxBuffer: 128 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } finally {
        try {
            unlinkSync(tempSqlPath);
        } catch {
            // Best effort cleanup for the temporary read-only SQL file.
        }
    }
    const parsed = JSON.parse(stdout) as { rows?: Array<Record<string, T>> };
    if (!parsed.rows?.[0] || !(field in parsed.rows[0])) {
        throw new Error(`Unexpected Supabase CLI response for field ${field}`);
    }
    return parsed.rows[0][field];
}

function fetchTable<T>(label: string, sql: string): T[] {
    process.stderr.write(`Fetching ${label}...\n`);
    const rows = runLinkedJsonQuery<T[]>(
        `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows from (${sql}) t;`,
        'rows'
    );
    process.stderr.write(`  ${label}: ${rows.length}\n`);
    return rows;
}

function allocateEntity(input: {
    entityType: EntityKind;
    entityId: string;
    entityName: string;
    obligations: ObligationPreview[];
    transactions: TransactionRow[];
    officialBalance: number;
    obligationTotal: number;
    transactionPaymentTotal: number;
    entityFlags: string[];
    entityNotes: string[];
    doctorCreditAllowed: boolean;
}): { entity: EntityPreview; transactions: TransactionPreview[] } {
    const sortedObligations = input.obligations
        .filter(item => item.flags.length === 0)
        .sort((a, b) => {
            const ao = a.obligation;
            const bo = b.obligation;
            return day(ao.due_date).localeCompare(day(bo.due_date))
                || day(ao.trigger_date).localeCompare(day(bo.trigger_date))
                || ao.created_at.localeCompare(bo.created_at);
        });

    const sortedTransactions = [...input.transactions].sort((a, b) => day(a.date).localeCompare(day(b.date)) || a.id.localeCompare(b.id));
    const transactionPreviews: TransactionPreview[] = [];
    let totalProposed = 0;
    let totalUnallocated = 0;

    const openByObligation = new Map<string, number>();
    for (const obligation of sortedObligations) {
        openByObligation.set(obligation.obligation.id, obligation.currentRemaining);
    }

    const duplicatePaymentKeys = new Map<string, number>();
    for (const tx of sortedTransactions) {
        const key = `${day(tx.date)}|${tx.amount}|${tx.category || ''}|${tx.description || ''}`;
        duplicatePaymentKeys.set(key, (duplicatePaymentKeys.get(key) || 0) + 1);
    }

    for (const transaction of sortedTransactions) {
        const flags: string[] = [];
        if (isSettlementTransaction(transaction)) flags.push('settlement_or_dispute_payment_excluded');
        if (!transaction.entity_id) flags.push('payment_has_no_entity');
        if (transaction.entity_type === null) flags.push('payment_entity_type_missing_or_legacy');
        const duplicateKey = `${day(transaction.date)}|${transaction.amount}|${transaction.category || ''}|${transaction.description || ''}`;
        if ((duplicatePaymentKeys.get(duplicateKey) || 0) > 1) flags.push('duplicate_payment_suspicion');

        const allocations: AllocationItem[] = [];
        let remainingPayment = amountOf(transaction.amount);

        if (flags.includes('settlement_or_dispute_payment_excluded') || flags.includes('payment_has_no_entity')) {
            totalUnallocated += remainingPayment;
        } else {
            for (const obligation of sortedObligations) {
                if (remainingPayment <= 0) break;
                const open = openByObligation.get(obligation.obligation.id) || 0;
                if (open <= 0) continue;
                const allocated = Math.min(open, remainingPayment);
                openByObligation.set(obligation.obligation.id, open - allocated);
                obligation.proposedAllocated += allocated;
                obligation.remainingAfter = Math.max(0, obligation.currentRemaining - obligation.proposedAllocated);
                obligation.statusAfterPreview = obligation.remainingAfter <= 0.009
                    ? 'paid'
                    : obligation.proposedAllocated > 0
                        ? 'partially_paid'
                        : 'unpaid';
                remainingPayment -= allocated;
                totalProposed += allocated;
                allocations.push({
                    transactionId: transaction.id,
                    obligationId: obligation.obligation.id,
                    entityType: input.entityType,
                    entityId: input.entityId,
                    entityName: input.entityName,
                    amount: allocated,
                    transactionDate: transaction.date,
                    orderId: obligation.obligation.order_id,
                    caseId: obligation.caseId,
                    patientName: obligation.patientName,
                    triggerType: obligation.obligation.trigger_type,
                });
            }
            if (remainingPayment > 0.009) totalUnallocated += remainingPayment;
        }

        if (remainingPayment > 0.009 && input.entityType === 'doctor') {
            flags.push('payment_exceeds_active_obligations_credit_candidate');
        } else if (remainingPayment > 0.009 && input.entityType === 'external_lab') {
            flags.push('payment_exceeds_active_payables_manual_review');
        }

        transactionPreviews.push({
            transaction,
            entityType: input.entityType,
            entityId: input.entityId,
            entityName: input.entityName,
            proposedAllocations: allocations,
            allocatedAmount: allocations.reduce((sum, item) => sum + item.amount, 0),
            unallocatedAmount: Math.max(0, remainingPayment),
            flags,
        });
    }

    for (const obligation of input.obligations) {
        if (obligation.flags.length > 0) continue;
        obligation.remainingAfter = Math.max(0, obligation.currentRemaining - obligation.proposedAllocated);
        if (obligation.proposedAllocated <= 0.009) obligation.statusAfterPreview = 'unpaid';
        else if (obligation.remainingAfter <= 0.009) obligation.statusAfterPreview = 'paid';
        else obligation.statusAfterPreview = 'partially_paid';
    }

    const remainingUnpaid = input.obligations.reduce((sum, obligation) => sum + obligation.remainingAfter, 0);
    const creditCandidate = input.doctorCreditAllowed ? totalUnallocated : 0;
    const before = input.obligationTotal - input.transactionPaymentTotal - input.officialBalance;
    const after = remainingUnpaid - creditCandidate - input.officialBalance;
    const flags = [...input.entityFlags];
    if (totalUnallocated > 0.009) {
        flags.push(input.entityType === 'doctor' ? 'overpayment_credit_candidate' : 'supplier_overpayment_manual_review');
    }
    if (remainingUnpaid > 0.009) flags.push('obligation_has_no_matching_payment');
    if (input.obligations.some(item => item.flags.length > 0)) flags.push('high_risk_obligations_excluded_from_allocation');

    return {
        entity: {
            entityType: input.entityType,
            entityId: input.entityId,
            entityName: input.entityName,
            officialBalance: input.officialBalance,
            obligationTotal: input.obligationTotal,
            transactionPaymentTotal: input.transactionPaymentTotal,
            proposedAllocationAmount: totalProposed,
            remainingUnpaid,
            overpaymentOrCreditCandidate: creditCandidate,
            unallocatedPaymentAmount: totalUnallocated,
            reconciliationDifferenceBeforeAllocation: before,
            reconciliationDifferenceAfterProposedAllocation: after,
            flags,
            notes: input.entityNotes,
        },
        transactions: transactionPreviews,
    };
}

function renderMarkdown(input: {
    generatedAt: string;
    entities: EntityPreview[];
    transactions: TransactionPreview[];
    obligations: ObligationPreview[];
    allocations: AllocationItem[];
    manualReview: string[];
    highRisk: string[];
    counts: Record<string, number>;
}): string {
    const lines: string[] = [];
    const summary = {
        entities: input.entities.length,
        obligations: input.obligations.length,
        payments: input.transactions.length,
        proposed: input.entities.reduce((sum, row) => sum + row.proposedAllocationAmount, 0),
        remaining: input.entities.reduce((sum, row) => sum + row.remainingUnpaid, 0),
        credit: input.entities.reduce((sum, row) => sum + row.overpaymentOrCreditCandidate, 0),
        manual: input.manualReview.length,
        highRisk: input.highRisk.length,
    };

    lines.push('# Historical Payment Allocation Preview + Reconciliation');
    lines.push(`Generated: ${input.generatedAt}`);
    lines.push('');
    lines.push('> Read-only preview. No allocation, credit, transaction, obligation, report, or balance rows were written.');
    lines.push('');
    lines.push('## A) Executive summary');
    lines.push('');
    lines.push(`- Total entities analyzed: **${summary.entities}**`);
    lines.push(`- Total obligations analyzed: **${summary.obligations}**`);
    lines.push(`- Total payments analyzed: **${summary.payments}**`);
    lines.push(`- Total proposed allocation amount: **${fmt(summary.proposed)}**`);
    lines.push(`- Total remaining unpaid after preview: **${fmt(summary.remaining)}**`);
    lines.push(`- Total overpayment / credit candidates: **${fmt(summary.credit)}**`);
    lines.push(`- Manual review queue count: **${summary.manual}**`);
    lines.push(`- High-risk exclusion count: **${summary.highRisk}**`);
    lines.push('');
    lines.push('Protected table counts observed during read-only run:');
    lines.push(`- payment_allocations: ${input.counts.payment_allocations}`);
    lines.push(`- account_credits: ${input.counts.account_credits}`);
    lines.push(`- allocation_events: ${input.counts.allocation_events}`);
    lines.push(`- financial_exception_reviews: ${input.counts.financial_exception_reviews}`);
    lines.push(`- transactions: ${input.counts.transactions}`);
    lines.push('');

    lines.push('## B) Entity-level summary');
    lines.push('');
    lines.push('| Entity | Type | Active obligations | Payments | Proposed allocation | Remaining unpaid | Credit/overpayment candidate | Diff before | Diff after | Flags |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
    for (const row of input.entities.sort((a, b) => Math.abs(b.reconciliationDifferenceAfterProposedAllocation) - Math.abs(a.reconciliationDifferenceAfterProposedAllocation))) {
        lines.push(`| ${row.entityName} | ${row.entityType} | ${fmt(row.obligationTotal)} | ${fmt(row.transactionPaymentTotal)} | ${fmt(row.proposedAllocationAmount)} | ${fmt(row.remainingUnpaid)} | ${fmt(row.overpaymentOrCreditCandidate || row.unallocatedPaymentAmount)} | ${fmt(row.reconciliationDifferenceBeforeAllocation)} | ${fmt(row.reconciliationDifferenceAfterProposedAllocation)} | ${row.flags.join(', ') || '-'} |`);
    }
    lines.push('');

    lines.push('## C) Proposed allocations by transaction');
    lines.push('');
    lines.push('| Transaction | Date | Entity | Amount | Proposed allocation | Unallocated | Target obligations | Flags |');
    lines.push('|---|---|---|---:|---:|---:|---|---|');
    for (const row of input.transactions.filter(row => row.allocatedAmount > 0 || row.unallocatedAmount > 0 || row.flags.length > 0)) {
        const targets = row.proposedAllocations.map(item => `${item.caseId || item.obligationId.slice(0, 8)}:${fmt(item.amount)}`).join('; ');
        lines.push(`| ${row.transaction.id} | ${day(row.transaction.date)} | ${row.entityName} | ${fmt(row.transaction.amount || 0)} | ${fmt(row.allocatedAmount)} | ${fmt(row.unallocatedAmount)} | ${targets || '-'} | ${row.flags.join(', ') || '-'} |`);
    }
    lines.push('');

    lines.push('## D) Proposed allocations by obligation');
    lines.push('');
    lines.push('| Obligation | Case ID | Patient | Entity | Trigger | Net | Currently allocated | Proposed allocated | Remaining after | Status after preview | Flags |');
    lines.push('|---|---|---|---|---|---:|---:|---:|---:|---|---|');
    for (const row of input.obligations.sort((a, b) => a.entityName.localeCompare(b.entityName) || day(a.obligation.due_date).localeCompare(day(b.obligation.due_date)))) {
        lines.push(`| ${row.obligation.id} | ${row.caseId || '-'} | ${row.patientName || '-'} | ${row.entityName} | ${row.obligation.trigger_type} | ${fmt(amountOf(row.obligation.net_amount))} | ${fmt(amountOf(row.obligation.allocated_amount))} | ${fmt(row.proposedAllocated)} | ${fmt(row.remainingAfter)} | ${row.statusAfterPreview} | ${row.flags.join(', ') || '-'} |`);
    }
    lines.push('');

    lines.push('## E) Overpayment / credit candidates');
    lines.push('');
    const creditRows = input.entities.filter(row => row.overpaymentOrCreditCandidate > 0 || row.unallocatedPaymentAmount > 0);
    if (creditRows.length === 0) lines.push('None.');
    else {
        lines.push('| Entity | Type | Unallocated payment | Credit candidate | Flags |');
        lines.push('|---|---|---:|---:|---|');
        for (const row of creditRows) {
            lines.push(`| ${row.entityName} | ${row.entityType} | ${fmt(row.unallocatedPaymentAmount)} | ${fmt(row.overpaymentOrCreditCandidate)} | ${row.flags.join(', ') || '-'} |`);
        }
    }
    lines.push('');

    lines.push('## F) Manual review queue');
    lines.push('');
    if (input.manualReview.length === 0) lines.push('None.');
    else input.manualReview.forEach(item => lines.push(`- ${item}`));
    lines.push('');

    lines.push('## G) High-risk exclusions');
    lines.push('');
    if (input.highRisk.length === 0) lines.push('None.');
    else input.highRisk.forEach(item => lines.push(`- ${item}`));
    lines.push('');

    lines.push('## H) What would change if applied');
    lines.push('');
    lines.push('If this preview were applied in a future approved write phase:');
    lines.push(`- ${input.allocations.length} payment allocation links would be created.`);
    lines.push(`- ${fmt(summary.proposed)} would be linked from historical payments to obligations.`);
    lines.push(`- ${fmt(summary.remaining)} would remain unpaid across active obligations.`);
    lines.push(`- Doctor overpayments of ${fmt(summary.credit)} would need account credit handling before any write.`);
    lines.push('- Supplier overpayments, settlement transactions, and issue settlement obligations would remain in manual review unless explicitly approved.');
    lines.push('');

    lines.push('## I) Recommended next action');
    lines.push('');
    lines.push('1. Review the manual review and high-risk sections first.');
    lines.push('2. Exclude account-closing/dispute settlement payments from automatic FIFO allocation.');
    lines.push('3. Decide the credit/settlement model before writing any historical payment allocations.');
    lines.push('4. After approval, implement a separate write phase with batch limits, audit rows, and before/after protected-table checks.');
    lines.push('');

    return lines.join('\n');
}

async function main() {
    const generatedAt = new Date().toISOString();

    const doctors = fetchTable<DoctorRow>('doctors', 'select id, name, parent_id, is_center from doctors order by name nulls last');
    const suppliers = fetchTable<SupplierRow>('suppliers', 'select id, name from suppliers order by name nulls last');
    const orders = fetchTable<OrderRow>('orders', 'select id, case_id, patient_name, doctor_id, supplier_id, status, total_price, cost, design_price, workflow_type, delivery_date, actual_delivery_date, created_at, is_archived, rejected_lab_cost from orders order by created_at, id');
    const transactions = fetchTable<TransactionRow>('transactions', 'select id, type, amount, date, category, description, entity_id, entity_type from transactions order by date, id');
    const obligations = fetchTable<ObligationRow>('financial_obligations', "select id, order_id, entity_type, entity_id, direction, trigger_type, gross_amount, net_amount, allocated_amount, remaining_amount, status, due_date, trigger_date, created_at, metadata from financial_obligations where status <> 'void' order by due_date nulls last, trigger_date nulls last, created_at, id");
    const adjustments = fetchTable<AdjustmentRow>('adjustments', 'select id, entity_type, entity_id, type, amount, date from adjustments order by date, id');

    const protectedCounts = {
        payment_allocations: fetchTable<{ id: string }>('payment_allocations', 'select id from payment_allocations').length,
        account_credits: fetchTable<{ id: string }>('account_credits', 'select id from account_credits').length,
        allocation_events: fetchTable<{ id: string }>('allocation_events', 'select id from allocation_events').length,
        financial_exception_reviews: fetchTable<{ id: string }>('financial_exception_reviews', 'select id from financial_exception_reviews').length,
        transactions: transactions.length,
    };

    const doctorNames = new Map(doctors.map(doctor => [doctor.id, doctor.name]));
    const supplierNames = new Map(suppliers.map(supplier => [supplier.id, supplier.name]));
    const parentByDoctorId = new Map(doctors.map(doctor => [doctor.id, doctor.parent_id || doctor.id]));
    const orderById = new Map(orders.map(order => [order.id, order]));
    const doctorIds = new Set(doctors.map(doctor => doctor.id));
    const supplierIds = new Set(suppliers.map(supplier => supplier.id));

    const officialDebits = new Map<string, number>();
    const officialCredits = new Map<string, number>();
    const entityFlags = new Map<string, string[]>();
    const entityNotes = new Map<string, string[]>();
    const pushFlag = (key: string, flag: string) => entityFlags.set(key, Array.from(new Set([...(entityFlags.get(key) || []), flag])));
    const pushNote = (key: string, note: string) => entityNotes.set(key, Array.from(new Set([...(entityNotes.get(key) || []), note])));

    const add = (map: Map<string, number>, key: string, amount: number) => map.set(key, (map.get(key) || 0) + amount);

    for (const order of orders) {
        if (order.is_archived) continue;
        const lifecycle = toLifecycleOrder(order);
        if (order.doctor_id && isDoctorStatementIncluded(lifecycle)) {
            add(officialDebits, `doctor:${doctorRootId(order.doctor_id, parentByDoctorId)}`, getDoctorReceivableAmount(lifecycle));
        }
        if (order.supplier_id) {
            const amount = supplierOfficialOrderAmount(order);
            if (amount !== null) add(officialDebits, `external_lab:${order.supplier_id}`, amount);
        }
    }

    for (const adjustment of adjustments) {
        if (adjustment.entity_type === 'doctor') {
            const key = `doctor:${doctorRootId(adjustment.entity_id, parentByDoctorId)}`;
            if (adjustment.type === 'charge') add(officialDebits, key, amountOf(adjustment.amount));
            else add(officialCredits, key, amountOf(adjustment.amount));
            pushFlag(key, 'official_adjustment_present');
        } else if (adjustment.entity_type === 'supplier') {
            const key = `external_lab:${adjustment.entity_id}`;
            if (adjustment.type === 'credit') add(officialDebits, key, amountOf(adjustment.amount));
            else add(officialCredits, key, amountOf(adjustment.amount));
            pushFlag(key, 'official_adjustment_present');
        }
    }

    const transactionsByEntity = new Map<string, TransactionRow[]>();
    for (const transaction of transactions) {
        if (!transaction.entity_id) continue;
        if (transaction.type === 'income' && (transaction.entity_type === 'doctor' || !transaction.entity_type) && doctorIds.has(transaction.entity_id)) {
            const key = `doctor:${doctorRootId(transaction.entity_id, parentByDoctorId)}`;
            add(officialCredits, key, amountOf(transaction.amount));
            transactionsByEntity.set(key, [...(transactionsByEntity.get(key) || []), transaction]);
        } else if (transaction.type === 'expense' && (transaction.entity_type === 'supplier' || !transaction.entity_type) && supplierIds.has(transaction.entity_id)) {
            const key = `external_lab:${transaction.entity_id}`;
            add(officialCredits, key, amountOf(transaction.amount));
            transactionsByEntity.set(key, [...(transactionsByEntity.get(key) || []), transaction]);
            if (isSettlementTransaction(transaction)) {
                pushFlag(key, 'account_closing_or_dispute_settlement_needed');
                pushNote(key, 'Settlement/dispute wording detected in supplier payment; exclude from automatic allocation.');
            }
        }
    }

    const obligationsByEntity = new Map<string, ObligationPreview[]>();
    const manualReview: string[] = [];
    const highRisk: string[] = [];

    for (const obligation of obligations) {
        if (obligation.status === 'void') continue;
        if (obligation.entity_type === 'doctor' && obligation.direction === 'receivable' && obligation.trigger_type === 'doctor_delivered') {
            const key = `doctor:${doctorRootId(obligation.entity_id, parentByDoctorId)}`;
            const order = orderById.get(obligation.order_id);
            const flags: string[] = [];
            if (!order || getDoctorReceivableAmount(toLifecycleOrder(order)) <= 0) {
                flags.push('stale_doctor_receivable_excluded');
                highRisk.push(`Doctor obligation ${obligation.id} (${order?.case_id || obligation.order_id}) is stale/non-billable and excluded.`);
            }
            const preview: ObligationPreview = {
                obligation,
                entityType: 'doctor',
                entityId: key.slice('doctor:'.length),
                entityName: doctorNames.get(key.slice('doctor:'.length)) || key.slice('doctor:'.length),
                caseId: order?.case_id || '',
                patientName: order?.patient_name || '',
                currentRemaining: amountOf(obligation.remaining_amount || obligation.net_amount),
                proposedAllocated: 0,
                remainingAfter: amountOf(obligation.remaining_amount || obligation.net_amount),
                statusAfterPreview: 'unpaid',
                flags,
            };
            obligationsByEntity.set(key, [...(obligationsByEntity.get(key) || []), preview]);
        } else if (obligation.entity_type === 'external_lab' && obligation.direction === 'payable') {
            const key = `external_lab:${obligation.entity_id}`;
            const order = orderById.get(obligation.order_id);
            const flags: string[] = [];
            if (obligation.trigger_type === 'external_lab_issue_settlement') {
                flags.push('issue_settlement_obligation_manual_review');
                pushFlag(key, 'issue_settlement_present');
                manualReview.push(`Issue settlement obligation ${obligation.id} (${order?.case_id || obligation.order_id}) for ${supplierNames.get(obligation.entity_id) || obligation.entity_id} requires manual review.`);
            }
            if (isIssueLikeOrder(order) && obligation.trigger_type !== 'external_lab_issue_settlement') {
                flags.push('rejected_cancelled_returned_order_obligation_excluded');
                highRisk.push(`Supplier obligation ${obligation.id} (${order?.case_id || obligation.order_id}) belongs to issue/non-final status and is excluded.`);
            }
            const preview: ObligationPreview = {
                obligation,
                entityType: 'external_lab',
                entityId: obligation.entity_id,
                entityName: supplierNames.get(obligation.entity_id) || obligation.entity_id,
                caseId: order?.case_id || '',
                patientName: order?.patient_name || '',
                currentRemaining: amountOf(obligation.remaining_amount || obligation.net_amount),
                proposedAllocated: 0,
                remainingAfter: amountOf(obligation.remaining_amount || obligation.net_amount),
                statusAfterPreview: 'unpaid',
                flags,
            };
            obligationsByEntity.set(key, [...(obligationsByEntity.get(key) || []), preview]);
        }
    }

    const entityKeys = new Set<string>([
        ...Array.from(officialDebits.keys()),
        ...Array.from(officialCredits.keys()),
        ...Array.from(transactionsByEntity.keys()),
        ...Array.from(obligationsByEntity.keys()),
    ]);

    const entityResults: EntityPreview[] = [];
    const transactionResults: TransactionPreview[] = [];
    const allObligationPreviews: ObligationPreview[] = [];

    for (const key of Array.from(entityKeys)) {
        const [kind, id] = key.split(':') as [EntityKind, string];
        if (kind !== 'doctor' && kind !== 'external_lab') continue;
        const entityName = kind === 'doctor' ? (doctorNames.get(id) || id) : (supplierNames.get(id) || id);
        const entityObligations = obligationsByEntity.get(key) || [];
        const entityTransactions = transactionsByEntity.get(key) || [];
        const obligationTotal = entityObligations.reduce((sum, item) => sum + amountOf(item.obligation.net_amount), 0);
        const transactionPaymentTotal = entityTransactions.reduce((sum, item) => sum + amountOf(item.amount), 0);
        const officialBalance = (officialDebits.get(key) || 0) - (officialCredits.get(key) || 0);
        const result = allocateEntity({
            entityType: kind,
            entityId: id,
            entityName,
            obligations: entityObligations,
            transactions: entityTransactions,
            officialBalance,
            obligationTotal,
            transactionPaymentTotal,
            entityFlags: entityFlags.get(key) || [],
            entityNotes: entityNotes.get(key) || [],
            doctorCreditAllowed: kind === 'doctor',
        });
        entityResults.push(result.entity);
        transactionResults.push(...result.transactions);
        allObligationPreviews.push(...entityObligations);
        for (const transaction of result.transactions) {
            if (transaction.flags.length > 0) {
                manualReview.push(`Transaction ${transaction.transaction.id} for ${entityName}: ${transaction.flags.join(', ')}.`);
            }
        }
    }

    const allocations = transactionResults.flatMap(row => row.proposedAllocations);
    const markdown = renderMarkdown({
        generatedAt,
        entities: entityResults,
        transactions: transactionResults,
        obligations: allObligationPreviews,
        allocations,
        manualReview: Array.from(new Set(manualReview)),
        highRisk: Array.from(new Set(highRisk)),
        counts: protectedCounts,
    });

    const csvRows = [
        ['transaction_id', 'transaction_date', 'entity_type', 'entity_id', 'entity_name', 'transaction_amount', 'obligation_id', 'order_id', 'case_id', 'patient_name', 'trigger_type', 'allocated_amount'],
        ...allocations.map(item => [
            item.transactionId,
            day(item.transactionDate),
            item.entityType,
            item.entityId,
            item.entityName,
            '',
            item.obligationId,
            item.orderId,
            item.caseId,
            item.patientName,
            item.triggerType,
            item.amount,
        ]),
    ];

    writeFileSync(resolve(process.cwd(), 'historical-allocation-preview.md'), markdown);
    writeFileSync(resolve(process.cwd(), 'historical-allocation-preview.csv'), csvRows.map(row => row.map(csvCell).join(',')).join('\n'));

    process.stdout.write(JSON.stringify({
        generatedAt,
        totalEntitiesAnalyzed: entityResults.length,
        totalObligationsAnalyzed: allObligationPreviews.length,
        totalPaymentsAnalyzed: transactionResults.length,
        totalProposedAllocationAmount: allocations.reduce((sum, item) => sum + item.amount, 0),
        totalRemainingUnpaid: entityResults.reduce((sum, row) => sum + row.remainingUnpaid, 0),
        totalOverpaymentCreditCandidates: entityResults.reduce((sum, row) => sum + row.overpaymentOrCreditCandidate, 0),
        manualReviewCount: new Set(manualReview).size,
        highRiskExclusionCount: new Set(highRisk).size,
        protectedCounts,
        outputFiles: ['historical-allocation-preview.md', 'historical-allocation-preview.csv'],
    }, null, 2));
    process.stdout.write('\n');
}

main().catch(error => {
    process.stderr.write('Historical allocation preview failed.\n');
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : JSON.stringify(error)}\n`);
    process.exit(1);
});
