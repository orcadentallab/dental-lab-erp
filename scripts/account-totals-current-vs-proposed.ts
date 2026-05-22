import { execSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    getDoctorReceivableAmount,
    getOfficialStatementDate,
    isDoctorStatementIncluded,
} from '../src/constants/orderLifecycle';
import type { Order } from '../src/services/db';

type EntityType = 'doctor' | 'external_lab';
type DoctorRow = { id: string; name: string; parent_id: string | null };
type SupplierRow = { id: string; name: string };
type OrderRow = {
    id: string; case_id: string | null; patient_name: string | null;
    doctor_id: string | null; supplier_id: string | null; status: string;
    total_price: number | null; cost: number | null; design_price: number | null;
    workflow_type: string | null; delivery_date: string | null; actual_delivery_date: string | null;
    created_at: string; is_archived: boolean | null; rejected_lab_cost: number | null;
};
type TxRow = {
    id: string; type: 'income' | 'expense'; amount: number; date: string;
    category: string | null; description: string | null; entity_id: string | null; entity_type: string | null;
};
type ObligationRow = {
    id: string; order_id: string; entity_type: EntityType | 'designer'; entity_id: string;
    direction: 'receivable' | 'payable'; trigger_type: string; net_amount: number | null;
    allocated_amount: number | null; remaining_amount: number | null; status: string;
    due_date: string | null; trigger_date: string | null; created_at: string;
};
type AdjustmentRow = { entity_type: string; entity_id: string; type: 'charge' | 'credit'; amount: number; date: string };

type AccountRow = {
    entity_type: EntityType;
    entity_id: string;
    entity_name: string;
    official_order_total: number;
    official_adjustments_total: number;
    official_transactions_total: number;
    current_official_balance: number;
    active_obligations_total: number;
    current_allocated_total: number;
    current_obligation_balance_before_cleanup: number;
    targeted_cleanup_void_amount: number;
    proposed_obligation_balance_after_cleanup: number;
    clean_allocation_preview_amount: number;
    remaining_unpaid_after_clean_allocation: number;
    unallocated_payment_after_clean_allocation: number;
    proposed_balance_after_cleanup_and_allocation: number;
    difference_current_obligation_vs_official: number;
    difference_after_cleanup_vs_official: number;
    difference_after_cleanup_and_allocation_vs_official: number;
    has_stale_void_candidate: boolean;
    has_issue_non_final_payable: boolean;
    has_issue_settlement: boolean;
    has_credit_candidate: boolean;
    has_settlement_dispute: boolean;
    has_supplier_overpayment: boolean;
    needs_manual_review: boolean;
    difference_reason: string;
};

const TARGETED_CLEANUP_IDS = new Set([
    '7470c5b1-f4da-4e77-ac1d-b2c8e144ae2c',
    'bea42b39-7085-43c0-a6e6-d0fbd2a3c516',
    '6f7dff6e-5ef2-4784-898d-e8afaabc158a',
    '11247e0e-e226-449e-954f-9dff999dabdb',
    '3bee6d3b-d906-45c8-866b-4dde35d638b6',
    'f84d605e-92f4-4977-898b-580d1137692f',
    'a659d0cf-582b-4f64-b43e-66d8507134a4',
    'f7a4f80e-24f1-4d1a-b351-22b81272dd72',
    '91bd642c-8bc7-4a93-aeb2-4b423a084c19',
    'a2a6a542-0cbf-4801-a17b-a6dc28ba8d60',
    'c2c2664f-49ae-4614-96ca-f48a2a33f523',
    'c99dbae6-db37-4a32-afb2-dda899c97341',
    '0d002fac-332f-43e6-8a29-a2ef357ddb67',
    '483dde11-7f0f-4ae7-b0c1-9aba10b9dba6',
    '15ce5e59-3183-44aa-97dd-9ca88a2ac989',
]);

const STALE_DOCTOR_IDS = new Set(Array.from(TARGETED_CLEANUP_IDS).slice(0, 11));
const ISSUE_NORMAL_PAYABLE_IDS = new Set(Array.from(TARGETED_CLEANUP_IDS).slice(11));
const ISSUE_SETTLEMENT_IDS = new Set([
    '6df860c3-8fb9-4597-9eec-88aaadf2ffb6',
    'ce24fd54-a8ab-4dea-ae9a-55a0ee71ceb3',
    '147f7286-a74d-4b2c-a08c-d871ec233844',
    '41778378-223e-4a80-914b-8de140e74279',
    'fc566db2-9c1d-4d7d-a73c-d72aa37cae9b',
    'a4d22eed-f5d2-409d-ac10-b218b29f0209',
    '21b41755-a218-42d0-bdf6-977e47834efd',
]);
const EXCLUDED_SUPPLIER_TX_IDS = new Set([
    'd79feb70-a62f-487c-8573-4c487239b60a',
    '22b40b85-4347-4483-b703-08bf37f2e1f9',
]);

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number | null | undefined) => Number(n || 0);
const day = (s?: string | null) => (s || '').split('T')[0];

function query<T>(sql: string, field: string): T {
    const temp = resolve(process.cwd(), 'scripts', '.account-totals.query.sql');
    writeFileSync(temp, sql);
    try {
        const stdout = execSync(`npx supabase db query --linked -o json -f "${temp}"`, {
            cwd: process.cwd(),
            encoding: 'utf8',
            maxBuffer: 128 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const parsed = JSON.parse(stdout) as { rows?: Array<Record<string, T>> };
        return parsed.rows?.[0]?.[field] as T;
    } finally {
        try { unlinkSync(temp); } catch { /* temp cleanup only */ }
    }
}

function table<T>(label: string, sql: string): T[] {
    process.stderr.write(`Reading ${label}...\n`);
    const rows = query<T[]>(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows from (${sql}) t;`, 'rows');
    process.stderr.write(`  ${label}: ${rows.length}\n`);
    return rows;
}

function toOrder(o: OrderRow): Partial<Order> {
    return {
        id: o.id,
        doctorId: o.doctor_id || '',
        supplierId: o.supplier_id || undefined,
        status: o.status as Order['status'],
        totalPrice: num(o.total_price),
        cost: num(o.cost),
        designPrice: o.design_price || undefined,
        workflowType: (o.workflow_type as Order['workflowType']) || undefined,
        deliveryDate: o.delivery_date || '',
        actualDeliveryDate: o.actual_delivery_date || undefined,
        createdAt: o.created_at,
        isArchived: o.is_archived || false,
        rejectedLabCost: o.rejected_lab_cost ?? undefined,
    };
}

function supplierOfficialAmount(o: OrderRow): number | null {
    const status = o.status || '';
    const lower = status.toLowerCase();
    const hasRejectedCost = status === 'Rejected' && typeof o.rejected_lab_cost === 'number';
    const relevant = (status !== 'Rejected' || hasRejectedCost) && (lower === 'delivered' || lower === 'cancelled' || hasRejectedCost);
    if (!relevant) return null;
    let cost = status === 'Cancelled' || status === 'Rejected' ? 0 : num(o.cost);
    if (hasRejectedCost) cost = num(o.rejected_lab_cost);
    if (o.workflow_type === 'split' && o.design_price && status !== 'Cancelled' && status !== 'Rejected' && !hasRejectedCost) {
        cost -= num(o.design_price);
    }
    return cost;
}

function add(map: Map<string, number>, key: string, amount: number) {
    map.set(key, (map.get(key) || 0) + amount);
}

function csvCell(v: unknown) {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function reason(row: AccountRow): string {
    const reasons: string[] = [];
    if (row.has_stale_void_candidate) reasons.push('stale doctor receivable cleanup candidate');
    if (row.has_issue_non_final_payable) reasons.push('supplier issue/non-final normal payable cleanup candidate');
    if (row.has_issue_settlement) reasons.push('issue settlement excluded from clean FIFO');
    if (row.has_credit_candidate) reasons.push('doctor credit candidate after matching obligations');
    if (row.has_settlement_dispute) reasons.push('settlement/dispute transaction excluded');
    if (row.has_supplier_overpayment) reasons.push('supplier overpayment/manual review');
    if (reasons.length === 0 && Math.abs(row.difference_after_cleanup_and_allocation_vs_official) < 0.01) return 'matches official after proposed preview';
    if (reasons.length === 0 && Math.abs(row.difference_current_obligation_vs_official) < 0.01) return 'already matches official';
    return reasons.join('; ') || 'unexplained difference requires review';
}

function render(rows: AccountRow[], counts: Record<string, number>) {
    const official = rows.reduce((s, r) => s + r.current_official_balance, 0);
    const obligations = rows.reduce((s, r) => s + r.active_obligations_total, 0);
    const currentBalance = rows.reduce((s, r) => s + r.current_obligation_balance_before_cleanup, 0);
    const cleanup = rows.reduce((s, r) => s + r.targeted_cleanup_void_amount, 0);
    const allocation = rows.reduce((s, r) => s + r.clean_allocation_preview_amount, 0);
    const after = rows.reduce((s, r) => s + r.proposed_balance_after_cleanup_and_allocation, 0);
    const zeroCurrent = rows.filter(r => Math.abs(r.difference_current_obligation_vs_official) < 0.01);
    const fixedByCleanup = rows.filter(r => Math.abs(r.difference_current_obligation_vs_official) >= 0.01 && Math.abs(r.difference_after_cleanup_vs_official) < 0.01);
    const fixedByAllocation = rows.filter(r => Math.abs(r.difference_after_cleanup_vs_official) >= 0.01 && Math.abs(r.difference_after_cleanup_and_allocation_vs_official) < 0.01);
    const remaining = rows.filter(r => Math.abs(r.difference_after_cleanup_and_allocation_vs_official) >= 0.01);

    const lines: string[] = [];
    lines.push('# Account Totals: Current vs Proposed');
    lines.push('');
    lines.push('Read-only reconciliation. Targeted cleanup and allocation are simulated only.');
    lines.push('');
    lines.push('## A) Executive Summary');
    lines.push('');
    lines.push(`- Total official balances: **${fmt(official)}**`);
    lines.push(`- Total active obligations: **${fmt(obligations)}**`);
    lines.push(`- Current obligation balance before cleanup: **${fmt(currentBalance)}**`);
    lines.push(`- Total current difference: **${fmt(currentBalance - official)}**`);
    lines.push(`- Targeted cleanup impact: **${fmt(cleanup)}**`);
    lines.push(`- Proposed allocation impact: **${fmt(allocation)}**`);
    lines.push(`- Remaining difference after proposed steps: **${fmt(after - official)}**`);
    lines.push(`- Entities analyzed: **${rows.length}**`);
    lines.push(`- Accounts matching official now: **${zeroCurrent.length}**`);
    lines.push(`- Accounts with current difference: **${rows.length - zeroCurrent.length}**`);
    lines.push(`- Accounts fixed by targeted cleanup: **${fixedByCleanup.length}**`);
    lines.push(`- Accounts fixed by allocation after cleanup: **${fixedByAllocation.length}**`);
    lines.push(`- Accounts still different after cleanup/allocation preview: **${remaining.length}**`);
    lines.push('');
    lines.push('Protected counts observed:');
    Object.entries(counts).forEach(([k, v]) => lines.push(`- ${k}: ${v}`));
    lines.push('');
    lines.push('## B) Entity Summary Table');
    lines.push('');
    lines.push('| entity_type | entity_name | official | active obligations | cleanup | clean allocation | after cleanup+allocation | final difference | flags |');
    lines.push('|---|---|---:|---:|---:|---:|---:|---:|---|');
    for (const r of rows.sort((a, b) => Math.abs(b.difference_after_cleanup_and_allocation_vs_official) - Math.abs(a.difference_after_cleanup_and_allocation_vs_official))) {
        const flags = [
            r.has_stale_void_candidate && 'stale',
            r.has_issue_non_final_payable && 'issue_non_final_payable',
            r.has_issue_settlement && 'issue_settlement',
            r.has_credit_candidate && 'credit_candidate',
            r.has_settlement_dispute && 'settlement_dispute',
            r.has_supplier_overpayment && 'supplier_overpayment',
            r.needs_manual_review && 'manual_review',
        ].filter(Boolean).join(', ') || '-';
        lines.push(`| ${r.entity_type} | ${r.entity_name} | ${fmt(r.current_official_balance)} | ${fmt(r.active_obligations_total)} | ${fmt(r.targeted_cleanup_void_amount)} | ${fmt(r.clean_allocation_preview_amount)} | ${fmt(r.proposed_balance_after_cleanup_and_allocation)} | ${fmt(r.difference_after_cleanup_and_allocation_vs_official)} | ${flags} |`);
    }
    const section = (title: string, subset: AccountRow[]) => {
        lines.push('');
        lines.push(`## ${title}`);
        lines.push('');
        if (subset.length === 0) {
            lines.push('None.');
            return;
        }
        lines.push('| entity_type | entity_name | current difference | after cleanup | after cleanup+allocation | reason |');
        lines.push('|---|---|---:|---:|---:|---|');
        for (const r of subset.sort((a, b) => Math.abs(b.difference_after_cleanup_and_allocation_vs_official) - Math.abs(a.difference_after_cleanup_and_allocation_vs_official))) {
            lines.push(`| ${r.entity_type} | ${r.entity_name} | ${fmt(r.difference_current_obligation_vs_official)} | ${fmt(r.difference_after_cleanup_vs_official)} | ${fmt(r.difference_after_cleanup_and_allocation_vs_official)} | ${r.difference_reason} |`);
        }
    };
    section('C) Accounts With Zero Difference Now', zeroCurrent);
    section('D) Accounts Where Cleanup Fixes The Difference', fixedByCleanup);
    section('E) Accounts Where Allocation Fixes/Matches The Balance', fixedByAllocation);
    section('F) Accounts Still Different After Cleanup/Allocation', remaining);
    lines.push('');
    lines.push('## G) Reason Breakdown For Remaining Differences');
    lines.push('');
    const reasonCounts = new Map<string, number>();
    for (const r of remaining) for (const part of r.difference_reason.split('; ')) reasonCounts.set(part, (reasonCounts.get(part) || 0) + 1);
    for (const [k, v] of Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v}`);
    lines.push('');
    lines.push('## H) Final Go/No-Go Recommendation');
    lines.push('');
    lines.push('No-go for broad allocation write.');
    lines.push('');
    lines.push('Conditional go later for a clean subset only, after:');
    lines.push('1. Targeted cleanup is approved/applied separately for the exact 15 candidates.');
    lines.push('2. Issue settlements, settlement/dispute payments, supplier overpayments, and doctor credit excess remain excluded.');
    lines.push('3. A final clean-subset dry run is regenerated and reviewed.');
    return lines.join('\n');
}

async function main() {
    const doctors = table<DoctorRow>('doctors', 'select id, name, parent_id from doctors');
    const suppliers = table<SupplierRow>('suppliers', 'select id, name from suppliers');
    const orders = table<OrderRow>('orders', 'select id, case_id, patient_name, doctor_id, supplier_id, status, total_price, cost, design_price, workflow_type, delivery_date, actual_delivery_date, created_at, is_archived, rejected_lab_cost from orders');
    const txs = table<TxRow>('transactions', 'select id, type, amount, date, category, description, entity_id, entity_type from transactions');
    const obligations = table<ObligationRow>('financial_obligations', "select id, order_id, entity_type, entity_id, direction, trigger_type, net_amount, allocated_amount, remaining_amount, status, due_date, trigger_date, created_at from financial_obligations where status <> 'void'");
    const adjustments = table<AdjustmentRow>('adjustments', 'select entity_type, entity_id, type, amount, date from adjustments');
    const protectedCounts = query<Record<string, number>>("select jsonb_build_object('financial_obligations',(select count(*) from financial_obligations),'payment_allocations',(select count(*) from payment_allocations),'account_credits',(select count(*) from account_credits),'allocation_events',(select count(*) from allocation_events),'financial_exception_reviews',(select count(*) from financial_exception_reviews),'transactions',(select count(*) from transactions)) as counts;", 'counts');

    const parentByDoctor = new Map(doctors.map(d => [d.id, d.parent_id || d.id]));
    const doctorName = new Map(doctors.map(d => [d.id, d.name]));
    const supplierName = new Map(suppliers.map(s => [s.id, s.name]));
    const root = (id: string) => parentByDoctor.get(id) || id;
    const keys = new Set<string>();
    const orderTotal = new Map<string, number>();
    const adjTotal = new Map<string, number>();
    const txTotal = new Map<string, number>();
    const obligationTotal = new Map<string, number>();
    const allocatedTotal = new Map<string, number>();
    const cleanupTotal = new Map<string, number>();
    const issueSettlement = new Set<string>();
    const issueNormal = new Set<string>();
    const stale = new Set<string>();
    const settlement = new Set<string>();
    const supplierOverpayment = new Set<string>();
    const creditCandidate = new Set<string>();

    for (const o of orders) {
        if (o.is_archived) continue;
        const lo = toOrder(o);
        if (o.doctor_id && isDoctorStatementIncluded(lo)) {
            const key = `doctor:${root(o.doctor_id)}`;
            keys.add(key);
            add(orderTotal, key, getDoctorReceivableAmount(lo));
            getOfficialStatementDate(lo);
        }
        if (o.supplier_id) {
            const amount = supplierOfficialAmount(o);
            if (amount !== null) {
                const key = `external_lab:${o.supplier_id}`;
                keys.add(key);
                add(orderTotal, key, amount);
            }
        }
    }

    for (const a of adjustments) {
        if (a.entity_type === 'doctor') {
            const key = `doctor:${root(a.entity_id)}`;
            keys.add(key);
            add(adjTotal, key, a.type === 'charge' ? num(a.amount) : -num(a.amount));
        } else if (a.entity_type === 'supplier') {
            const key = `external_lab:${a.entity_id}`;
            keys.add(key);
            add(adjTotal, key, a.type === 'credit' ? num(a.amount) : -num(a.amount));
        }
    }

    for (const t of txs) {
        if (!t.entity_id) continue;
        if (t.type === 'income' && (t.entity_type === 'doctor' || !t.entity_type)) {
            const key = `doctor:${root(t.entity_id)}`;
            keys.add(key);
            add(txTotal, key, num(t.amount));
        } else if (t.type === 'expense' && (t.entity_type === 'supplier' || !t.entity_type)) {
            const key = `external_lab:${t.entity_id}`;
            keys.add(key);
            add(txTotal, key, num(t.amount));
            if (EXCLUDED_SUPPLIER_TX_IDS.has(t.id) && t.description?.includes('تقفيل')) settlement.add(key);
            if (EXCLUDED_SUPPLIER_TX_IDS.has(t.id) && !t.description?.includes('تقفيل')) supplierOverpayment.add(key);
        }
    }

    const obligationsByKey = new Map<string, ObligationRow[]>();
    for (const o of obligations) {
        if (o.entity_type !== 'doctor' && o.entity_type !== 'external_lab') continue;
        const key = `${o.entity_type}:${o.entity_type === 'doctor' ? root(o.entity_id) : o.entity_id}`;
        keys.add(key);
        add(obligationTotal, key, num(o.net_amount));
        add(allocatedTotal, key, num(o.allocated_amount));
        if (TARGETED_CLEANUP_IDS.has(o.id)) add(cleanupTotal, key, num(o.net_amount));
        if (STALE_DOCTOR_IDS.has(o.id)) stale.add(key);
        if (ISSUE_NORMAL_PAYABLE_IDS.has(o.id)) issueNormal.add(key);
        if (ISSUE_SETTLEMENT_IDS.has(o.id) || o.trigger_type === 'external_lab_issue_settlement') issueSettlement.add(key);
        obligationsByKey.set(key, [...(obligationsByKey.get(key) || []), o]);
    }

    const rows: AccountRow[] = [];
    for (const key of Array.from(keys)) {
        const [type, id] = key.split(':') as [EntityType, string];
        const officialOrder = orderTotal.get(key) || 0;
        const officialAdj = adjTotal.get(key) || 0;
        const officialTx = txTotal.get(key) || 0;
        const officialBalance = officialOrder + officialAdj - officialTx;
        const activeObligations = obligationTotal.get(key) || 0;
        const currentAllocated = allocatedTotal.get(key) || 0;
        const beforeCleanup = activeObligations - currentAllocated;
        const cleanup = cleanupTotal.get(key) || 0;
        const afterCleanupOpen = Math.max(0, beforeCleanup - cleanup);
        const availablePayments = type === 'external_lab' && (settlement.has(key) || supplierOverpayment.has(key))
            ? Math.max(0, officialTx - (key.endsWith('b7de7f77-c92f-456a-b6b4-04b2910c609b') ? 12000 : 800))
            : officialTx;
        const cleanAllocation = Math.min(afterCleanupOpen, availablePayments);
        const remaining = afterCleanupOpen - cleanAllocation;
        const unallocated = Math.max(0, availablePayments - cleanAllocation);
        if (type === 'doctor' && unallocated > 0.009) creditCandidate.add(key);
        const proposed = remaining;
        const row: AccountRow = {
            entity_type: type,
            entity_id: id,
            entity_name: type === 'doctor' ? (doctorName.get(id) || id) : (supplierName.get(id) || id),
            official_order_total: officialOrder,
            official_adjustments_total: officialAdj,
            official_transactions_total: officialTx,
            current_official_balance: officialBalance,
            active_obligations_total: activeObligations,
            current_allocated_total: currentAllocated,
            current_obligation_balance_before_cleanup: beforeCleanup,
            targeted_cleanup_void_amount: cleanup,
            proposed_obligation_balance_after_cleanup: afterCleanupOpen,
            clean_allocation_preview_amount: cleanAllocation,
            remaining_unpaid_after_clean_allocation: remaining,
            unallocated_payment_after_clean_allocation: unallocated,
            proposed_balance_after_cleanup_and_allocation: proposed,
            difference_current_obligation_vs_official: beforeCleanup - officialBalance,
            difference_after_cleanup_vs_official: afterCleanupOpen - officialBalance,
            difference_after_cleanup_and_allocation_vs_official: proposed - officialBalance,
            has_stale_void_candidate: stale.has(key),
            has_issue_non_final_payable: issueNormal.has(key),
            has_issue_settlement: issueSettlement.has(key),
            has_credit_candidate: creditCandidate.has(key),
            has_settlement_dispute: settlement.has(key),
            has_supplier_overpayment: supplierOverpayment.has(key),
            needs_manual_review: false,
            difference_reason: '',
        };
        row.needs_manual_review = row.has_stale_void_candidate || row.has_issue_non_final_payable || row.has_issue_settlement || row.has_credit_candidate || row.has_settlement_dispute || row.has_supplier_overpayment || Math.abs(row.difference_after_cleanup_and_allocation_vs_official) >= 0.01;
        row.difference_reason = reason(row);
        rows.push(row);
    }

    const headers = Object.keys(rows[0] || {});
    writeFileSync(resolve(process.cwd(), 'account-totals-current-vs-proposed.csv'), [
        headers.join(','),
        ...rows.map(r => headers.map(h => csvCell((r as unknown as Record<string, unknown>)[h])).join(',')),
    ].join('\n'));
    writeFileSync(resolve(process.cwd(), 'account-totals-current-vs-proposed.md'), render(rows, protectedCounts));

    const matchingNow = rows.filter(r => Math.abs(r.difference_current_obligation_vs_official) < 0.01).length;
    const fixedCleanup = rows.filter(r => Math.abs(r.difference_current_obligation_vs_official) >= 0.01 && Math.abs(r.difference_after_cleanup_vs_official) < 0.01).length;
    const still = rows.filter(r => Math.abs(r.difference_after_cleanup_and_allocation_vs_official) >= 0.01).length;
    const safe = rows.filter(r => !r.needs_manual_review && r.clean_allocation_preview_amount > 0).length;
    const top20 = rows
        .filter(r => Math.abs(r.difference_after_cleanup_and_allocation_vs_official) >= 0.01)
        .sort((a, b) => Math.abs(b.difference_after_cleanup_and_allocation_vs_official) - Math.abs(a.difference_after_cleanup_and_allocation_vs_official))
        .slice(0, 20)
        .map(r => ({ entity_type: r.entity_type, entity_name: r.entity_name, difference: r.difference_after_cleanup_and_allocation_vs_official, reason: r.difference_reason }));
    process.stdout.write(JSON.stringify({
        totalEntitiesAnalyzed: rows.length,
        accountsMatchingCurrentOfficialBalance: matchingNow,
        accountsWithCurrentDifference: rows.length - matchingNow,
        accountsFixedByTargetedCleanup: fixedCleanup,
        accountsStillDifferentAfterCleanup: still,
        accountsSafeForCleanAllocation: safe,
        top20AccountsByRemainingDifference: top20,
    }, null, 2));
    process.stdout.write('\n');
}

main();
