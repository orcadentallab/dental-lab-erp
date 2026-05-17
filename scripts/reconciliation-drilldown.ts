// WF-1.5 Read-Only Reconciliation Drill-Down.
//
// Usage:
//   $env:SUPABASE_URL = "https://<project>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
//   npx tsx scripts/reconciliation-drilldown.ts > drilldown.md
//
// READ-ONLY GUARANTEES:
//  - Only `.select()` queries.
//  - No insert/update/delete/upsert/rpc calls.
//  - No allocations, credits, transaction writes, or obligation writes.
//  - No changes to official statements/balances/reports/analytics/dashboards.
//
// Produces a markdown report per entity with Sections A-H matching
// the user's requested format.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
    getDoctorReceivableAmount,
    getOfficialStatementDate,
    isDoctorStatementIncluded,
} from '../src/constants/orderLifecycle';
import type { Order } from '../src/services/db';

// ─── Hardcoded entity list (the 12 non-zero-difference entities) ─────────────
const DOCTOR_NAMES = [
    'دنتال جاليري',
    'سمارت دنتل سنتر - د حازم البلتاجى',
    'الشامي',
    'حاتم الدسوقى',
    'عبدالرحمن الاشرم',
    'خالد العامري',
    'خالد المرسي',
    'محمد حسن',
    'مركز شفاء',
];

const SUPPLIER_NAMES = ['EZ Lab', 'AB Lab', 'Dr.M Lab'];

const SETTLEMENT_KEYWORDS = ['تقفيل', 'فرق', 'settlement', 'closing', 'dispute', 'write-off', 'writeoff'];

// ─── Types ───────────────────────────────────────────────────────────────────
type DoctorRow = { id: string; name: string; parent_id: string | null; is_center: boolean | null };
type SupplierRow = { id: string; name: string };
type OrderRow = {
    id: string; case_id: string | null; doctor_id: string | null; supplier_id: string | null;
    status: string; total_price: number | null; cost: number | null; design_price: number | null;
    workflow_type: string | null; delivery_date: string | null; actual_delivery_date: string | null;
    created_at: string; is_archived: boolean | null; rejected_lab_cost: number | null;
    patient_name: string | null;
    // WF-1 shadow columns; only present after migration 086. Treated as optional
    // so this script works against pre-086 production databases.
    production_status?: string | null;
    issue_state?: string | null;
};
type TxRow = {
    id: string; type: 'income' | 'expense'; amount: number; date: string;
    category: string | null; description: string | null;
    entity_id: string | null; entity_type: string | null;
};
type ObligRow = {
    id: string; order_id: string; entity_type: string; entity_id: string;
    direction: 'receivable' | 'payable'; trigger_type: string;
    gross_amount: number | null; net_amount: number | null; status: string;
    metadata: Record<string, unknown> | null;
};
type AdjRow = {
    id: string; entity_type: string; entity_id: string;
    type: 'charge' | 'credit'; amount: number; date: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toFixed(2);
const dateOnly = (s?: string | null) => (s || '').split('T')[0];

function toLifecycle(r: OrderRow): Partial<Order> {
    return {
        id: r.id,
        doctorId: r.doctor_id || '',
        supplierId: r.supplier_id || undefined,
        status: r.status as Order['status'],
        totalPrice: r.total_price || 0,
        cost: r.cost || 0,
        designPrice: r.design_price || undefined,
        workflowType: (r.workflow_type as Order['workflowType']) || undefined,
        deliveryDate: r.delivery_date || '',
        actualDeliveryDate: r.actual_delivery_date || undefined,
        createdAt: r.created_at,
        isArchived: r.is_archived || false,
        rejectedLabCost: r.rejected_lab_cost ?? undefined,
    };
}

function getSupplierOfficialAmount(o: ReturnType<typeof toLifecycle>): number | null {
    const status = o.status || '';
    const hasRejCost = status === 'Rejected' && typeof o.rejectedLabCost === 'number';
    const lower = status.toLowerCase();
    const relevant = (status !== 'Rejected' || hasRejCost) &&
        (lower === 'delivered' || lower === 'cancelled' || hasRejCost);
    if (!relevant) return null;
    let cost = (status === 'Cancelled' || status === 'Rejected' ? 0 : (o.cost || 0));
    if (hasRejCost) cost = o.rejectedLabCost || 0;
    if (o.workflowType === 'split' && o.designPrice && status !== 'Cancelled' && status !== 'Rejected' && !hasRejCost) {
        cost -= o.designPrice;
    }
    return cost;
}

// Resolve name → set of doctor IDs to roll up under (handles parent/children).
function resolveDoctorGroup(name: string, allDoctors: DoctorRow[]): { rootId: string | null; ids: string[]; rootName: string } {
    const matches = allDoctors.filter(d => (d.name || '').trim() === name.trim());
    if (matches.length === 0) return { rootId: null, ids: [], rootName: name };
    // Choose root: prefer one where parent_id is null
    let root = matches.find(d => !d.parent_id) || matches[0];
    // Walk up if needed
    while (root.parent_id) {
        const p = allDoctors.find(d => d.id === root.parent_id);
        if (!p) break;
        root = p;
    }
    // Collect root + all descendants (one level deep is the schema; but recurse to be safe)
    const ids = new Set<string>([root.id]);
    let added = true;
    while (added) {
        added = false;
        for (const d of allDoctors) {
            if (d.parent_id && ids.has(d.parent_id) && !ids.has(d.id)) {
                ids.add(d.id);
                added = true;
            }
        }
    }
    return { rootId: root.id, ids: Array.from(ids), rootName: root.name };
}

function resolveSupplier(name: string, suppliers: SupplierRow[]): SupplierRow | null {
    return suppliers.find(s => (s.name || '').trim() === name.trim()) || null;
}

// ─── Per-entity report builders ──────────────────────────────────────────────
function reportDoctor(
    name: string,
    group: { rootId: string | null; ids: string[]; rootName: string },
    orders: OrderRow[],
    txs: TxRow[],
    obligs: ObligRow[],
    adjs: AdjRow[]
): string {
    const out: string[] = [];
    out.push(`## Doctor: ${name}`);
    if (!group.rootId) {
        out.push(`> ⚠️ No matching doctor row found by name. Skipping.`);
        return out.join('\n') + '\n';
    }
    out.push(`- Root id: \`${group.rootId}\` | Roll-up ids: ${group.ids.length} (\`${group.ids.join('`, `')}\`)`);

    const idSet = new Set(group.ids);
    const myOrders = orders.filter(o => o.doctor_id && idSet.has(o.doctor_id));
    const myTxs = txs.filter(t => t.entity_id && idSet.has(t.entity_id) && (t.entity_type === 'doctor' || !t.entity_type));
    const myObligs = obligs.filter(o => o.entity_type === 'doctor' && idSet.has(o.entity_id) && o.status !== 'void');
    const myAdjs = adjs.filter(a => a.entity_type === 'doctor' && idSet.has(a.entity_id));

    // ── Section A: Official side ─────────────────────────────────────────────
    out.push(`\n### A) Official side breakdown`);
    let officialDebits = 0, officialCredits = 0, rejectedContribution = 0;
    const debitDetail: Array<{ caseId: string | null; status: string; amt: number; date: string }> = [];
    for (const r of myOrders) {
        if (r.is_archived) continue;
        const lc = toLifecycle(r);
        if (!isDoctorStatementIncluded(lc)) continue;
        const amt = getDoctorReceivableAmount(lc);
        if (amt > 0) {
            officialDebits += amt;
            debitDetail.push({ caseId: r.case_id, status: r.status, amt, date: getOfficialStatementDate(lc) });
        }
    }
    for (const t of myTxs) {
        if (t.type === 'income') officialCredits += t.amount || 0;
    }
    let adjCharges = 0, adjCredits = 0;
    for (const a of myAdjs) {
        if (a.type === 'charge') { officialDebits += a.amount; adjCharges += a.amount; }
        else { officialCredits += a.amount; adjCredits += a.amount; }
    }
    const officialBalance = officialDebits - officialCredits;
    out.push(`- Order-derived receivable rows: **${debitDetail.length}**, total \`${fmt(debitDetail.reduce((s, r) => s + r.amt, 0))}\``);
    out.push(`- Official adjustments: ${myAdjs.length} rows (charges \`${fmt(adjCharges)}\`, credits \`${fmt(adjCredits)}\`)`);
    out.push(`- Income transactions (payments): ${myTxs.filter(t => t.type === 'income').length} rows, total \`${fmt(myTxs.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0))}\``);
    out.push(`- **Final official balance**: \`${fmt(officialBalance)}\``);

    // ── Section B: Obligation side ───────────────────────────────────────────
    out.push(`\n### B) Obligation side breakdown (active, non-void)`);
    const orderById = new Map(myOrders.map(o => [o.id, o]));
    let obligTotal = 0;
    if (myObligs.length === 0) {
        out.push(`_(none)_`);
    } else {
        out.push(`| obligationId | orderId | caseId | patient | trigger | gross | net | status | backfill | issueBased |`);
        out.push(`|---|---|---|---|---|---|---|---|---|---|`);
        for (const o of myObligs) {
            const ord = orderById.get(o.order_id);
            const meta = o.metadata || {};
            obligTotal += o.net_amount || 0;
            out.push(`| \`${o.id.slice(0, 8)}\` | \`${o.order_id.slice(0, 8)}\` | ${ord?.case_id ?? '-'} | ${ord?.patient_name ?? '-'} | ${o.trigger_type} | ${fmt(o.gross_amount || 0)} | ${fmt(o.net_amount || 0)} | ${o.status} | ${meta['backfill'] ?? '-'} | ${meta['issueBased'] ?? '-'} |`);
        }
    }
    out.push(`- **Obligation total**: \`${fmt(obligTotal)}\``);

    // ── Section C: Transaction side ──────────────────────────────────────────
    out.push(`\n### C) Transaction side`);
    let txTotal = 0;
    if (myTxs.length === 0) {
        out.push(`_(none)_`);
    } else {
        out.push(`| txId | date | type | category | amount | description |`);
        out.push(`|---|---|---|---|---|---|`);
        for (const t of myTxs) {
            txTotal += (t.type === 'income' ? 1 : -1) * (t.amount || 0);
            out.push(`| \`${t.id.slice(0, 8)}\` | ${dateOnly(t.date)} | ${t.type} | ${t.category ?? '-'} | ${fmt(t.amount || 0)} | ${(t.description || '-').slice(0, 60)} |`);
        }
    }
    out.push(`- **Transaction net (income−expense)**: \`${fmt(txTotal)}\``);

    // ── Section D: Stale receivable detection ────────────────────────────────
    out.push(`\n### D) Stale doctor_delivered receivables (order no longer billable)`);
    const stale: ObligRow[] = [];
    for (const o of myObligs) {
        if (o.trigger_type !== 'doctor_delivered') continue;
        const ord = orderById.get(o.order_id);
        if (!ord) { stale.push(o); continue; }
        const lc = toLifecycle(ord);
        if (getDoctorReceivableAmount(lc) <= 0) stale.push(o);
    }
    if (stale.length === 0) {
        out.push(`_(none — no stale doctor receivables)_`);
    } else {
        out.push(`| obligationId | caseId | patient | amount | current order status | issue_state |`);
        out.push(`|---|---|---|---|---|---|`);
        for (const o of stale) {
            const ord = orderById.get(o.order_id);
            out.push(`| \`${o.id.slice(0, 8)}\` | ${ord?.case_id ?? '-'} | ${ord?.patient_name ?? '-'} | ${fmt(o.net_amount || 0)} | ${ord?.status ?? '(missing)'} | ${ord?.issue_state ?? '-'} |`);
        }
        out.push(`- **Stale total**: \`${fmt(stale.reduce((s, o) => s + (o.net_amount || 0), 0))}\` (recommend targeted void after admin review).`);
    }

    // ── Section G + H: classification + action ───────────────────────────────
    const obligationBased = obligTotal - officialCredits;
    const diff = obligationBased - officialBalance;
    const classifications: string[] = [];
    if (Math.abs(diff) < 0.01) classifications.push('difference_zero');
    if (stale.length > 0) classifications.push('stale_doctor_receivable_cleanup_needed', 'obligations_include_item_not_in_official_logic');
    if (myAdjs.length > 0 && myObligs.length === 0) classifications.push('official_adjustment_missing_in_obligations');

    out.push(`\n### G) Classification`);
    out.push(classifications.length === 0 ? `- unknown_needs_manual_review` : classifications.map(c => `- ${c}`).join('\n'));

    out.push(`\n### H) Recommended action`);
    if (stale.length > 0) {
        out.push(`- **Targeted void** of the ${stale.length} stale obligation(s) listed in Section D.`);
        out.push(`- Re-run reconciliation; expected difference closes to \`${fmt(officialBalance - (obligTotal - stale.reduce((s, o) => s + (o.net_amount || 0), 0) - officialCredits))}\` (approx).`);
    } else if (Math.abs(diff) >= 0.01) {
        out.push(`- Manual review: difference \`${fmt(diff)}\` not explained by stale-receivable rule. Inspect adjustments + transaction entity/category.`);
    } else {
        out.push(`- No action — within rounding tolerance.`);
    }
    out.push(`\n---\n`);
    return out.join('\n');
}

function reportSupplier(
    name: string,
    supplier: SupplierRow | null,
    orders: OrderRow[],
    txs: TxRow[],
    obligs: ObligRow[],
    adjs: AdjRow[]
): string {
    const out: string[] = [];
    out.push(`## External Lab: ${name}`);
    if (!supplier) {
        out.push(`> ⚠️ No matching supplier row found by name. Skipping.`);
        return out.join('\n') + '\n';
    }
    out.push(`- Supplier id: \`${supplier.id}\``);

    const myOrders = orders.filter(o => o.supplier_id === supplier.id);
    const myTxs = txs.filter(t => t.entity_id === supplier.id && (t.entity_type === 'supplier' || !t.entity_type));
    const myObligs = obligs.filter(o => o.entity_type === 'external_lab' && o.entity_id === supplier.id && o.status !== 'void');
    const myAdjs = adjs.filter(a => a.entity_type === 'supplier' && a.entity_id === supplier.id);

    // ── Section A ───────────────────────────────────────────────────────────
    out.push(`\n### A) Official side breakdown`);
    let officialCredits = 0, officialDebits = 0, rejectedContribution = 0;
    const orderDetail: Array<{ caseId: string | null; status: string; amt: number; rejected: boolean }> = [];
    for (const r of myOrders) {
        if (r.is_archived) continue;
        const lc = toLifecycle(r);
        const amt = getSupplierOfficialAmount(lc);
        if (amt !== null) {
            officialCredits += amt;
            const isRej = r.status === 'Rejected' && typeof r.rejected_lab_cost === 'number';
            if (isRej) rejectedContribution += amt;
            orderDetail.push({ caseId: r.case_id, status: r.status, amt, rejected: isRej });
        }
    }
    for (const t of myTxs) {
        if (t.type === 'expense') officialDebits += t.amount || 0;
    }
    let adjC = 0, adjD = 0;
    for (const a of myAdjs) {
        if (a.type === 'charge') { officialDebits += a.amount; adjD += a.amount; }
        else { officialCredits += a.amount; adjC += a.amount; }
    }
    const officialBalance = officialCredits - officialDebits;
    out.push(`- Order-derived payable rows: **${orderDetail.length}**, total \`${fmt(orderDetail.reduce((s, r) => s + r.amt, 0))}\``);
    out.push(`- rejectedLabCost contribution: \`${fmt(rejectedContribution)}\` (across ${orderDetail.filter(o => o.rejected).length} rejected orders)`);
    out.push(`- Official adjustments: ${myAdjs.length} (charges \`${fmt(adjD)}\`, credits \`${fmt(adjC)}\`)`);
    out.push(`- Expense transactions (payments out): ${myTxs.filter(t => t.type === 'expense').length} rows, total \`${fmt(myTxs.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0))}\``);
    out.push(`- **Final official balance** (credits − debits, payable): \`${fmt(officialBalance)}\``);

    // ── Section B ───────────────────────────────────────────────────────────
    out.push(`\n### B) Obligation side breakdown (active, non-void)`);
    const orderById = new Map(myOrders.map(o => [o.id, o]));
    let readyTotal = 0, issueTotal = 0;
    if (myObligs.length === 0) {
        out.push(`_(none)_`);
    } else {
        out.push(`| obligationId | orderId | caseId | patient | trigger | gross | net | status | backfill | issueBased | costSource |`);
        out.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
        for (const o of myObligs) {
            const ord = orderById.get(o.order_id);
            const meta = o.metadata || {};
            const isIssue = o.trigger_type === 'external_lab_issue_settlement';
            if (isIssue) issueTotal += o.net_amount || 0;
            else if (o.trigger_type === 'external_lab_ready') readyTotal += o.net_amount || 0;
            out.push(`| \`${o.id.slice(0, 8)}\` | \`${o.order_id.slice(0, 8)}\` | ${ord?.case_id ?? '-'} | ${ord?.patient_name ?? '-'} | ${o.trigger_type} | ${fmt(o.gross_amount || 0)} | ${fmt(o.net_amount || 0)} | ${o.status} | ${meta['backfill'] ?? '-'} | ${meta['issueBased'] ?? '-'} | ${meta['costSource'] ?? '-'} |`);
        }
    }
    out.push(`- Ready-payable total: \`${fmt(readyTotal)}\``);
    out.push(`- Issue-settlement total: \`${fmt(issueTotal)}\``);
    out.push(`- **Obligation total**: \`${fmt(readyTotal + issueTotal)}\``);

    // ── Section C ───────────────────────────────────────────────────────────
    out.push(`\n### C) Transaction side`);
    let settlementTxFound = false;
    if (myTxs.length === 0) {
        out.push(`_(none)_`);
    } else {
        out.push(`| txId | date | type | category | amount | description |`);
        out.push(`|---|---|---|---|---|---|`);
        for (const t of myTxs) {
            const text = `${t.category || ''} ${t.description || ''}`.toLowerCase();
            const isSettlement = SETTLEMENT_KEYWORDS.some(k => text.includes(k));
            if (isSettlement) settlementTxFound = true;
            out.push(`| \`${t.id.slice(0, 8)}\` | ${dateOnly(t.date)} | ${t.type}${isSettlement ? ' ⚠️settlement' : ''} | ${t.category ?? '-'} | ${fmt(t.amount || 0)} | ${(t.description || '-').slice(0, 60)} |`);
        }
    }
    out.push(`- **Transaction expense total**: \`${fmt(myTxs.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0))}\``);

    // ── Section E: issue settlement detection ──────────────────────────────
    if (name === 'AB Lab' || name === 'Dr.M Lab') {
        out.push(`\n### E) Issue-settlement detection`);
        const settlementObligs = myObligs.filter(o => o.trigger_type === 'external_lab_issue_settlement');
        out.push(`- external_lab_issue_settlement obligations: **${settlementObligs.length}** rows, total \`${fmt(settlementObligs.reduce((s, o) => s + (o.net_amount || 0), 0))}\``);
        out.push(`- rejectedLabCost contribution from official side: \`${fmt(rejectedContribution)}\``);
        const explainDiff = (rejectedContribution - settlementObligs.reduce((s, o) => s + (o.net_amount || 0), 0));
        if (Math.abs(explainDiff) < 0.01) out.push(`- Issue side **balanced**.`);
        else if (rejectedContribution > 0 && settlementObligs.length === 0) out.push(`- ⚠️ Official has rejectedLabCost but **no settlement obligations** → likely backfill missing.`);
        else if (settlementObligs.length > 0 && rejectedContribution === 0) out.push(`- ⚠️ Settlement obligations exist but official side recognizes no rejectedLabCost → official-logic mismatch.`);
        else out.push(`- ⚠️ Mismatch \`${fmt(explainDiff)}\`: review per-order pairing.`);
    }

    // ── Section F: settlement classification (EZ Lab) ──────────────────────
    if (name === 'EZ Lab') {
        out.push(`\n### F) Settlement classification`);
        if (settlementTxFound) out.push(`- ✅ Account-closing/dispute payment **detected** in transactions (matched keyword filter).`);
        else out.push(`- ⚠️ Expected account-closing/dispute payment **not detected** by keyword filter — review transaction descriptions manually.`);
        out.push(`- Keep flag \`account_closing_or_dispute_settlement_needed\`.`);
        out.push(`- Recommend future manual settlement/adjustment (do NOT auto-allocate).`);
    }

    // ── Section G + H ──────────────────────────────────────────────────────
    const obligationTotal = readyTotal + issueTotal;
    const obligationBased = obligationTotal - officialDebits;
    const diff = obligationBased - officialBalance;
    const classifications: string[] = [];
    if (Math.abs(diff) < 0.01) classifications.push('difference_zero');
    if (name === 'EZ Lab' || (settlementTxFound && obligationBased < 0)) classifications.push('account_closing_or_dispute_settlement_needed');
    if (name === 'AB Lab' || name === 'Dr.M Lab') classifications.push('issue_settlement_review_needed');
    if (myAdjs.length > 0) classifications.push('official_adjustment_missing_in_obligations');

    out.push(`\n### G) Classification`);
    out.push(classifications.length === 0 ? `- unknown_needs_manual_review` : classifications.map(c => `- ${c}`).join('\n'));

    out.push(`\n### H) Recommended action`);
    if (name === 'EZ Lab') out.push(`- Future manual settlement/adjustment (no auto-allocate).`);
    else if (name === 'AB Lab' || name === 'Dr.M Lab') out.push(`- Review issue-settlement / rejectedLabCost pairing per Section E. Decide whether to backfill missing settlement or correct official logic.`);
    else if (Math.abs(diff) < 0.01) out.push(`- No action — within rounding tolerance.`);
    else out.push(`- Manual review: difference \`${fmt(diff)}\`.`);

    out.push(`\n---\n`);
    return out.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

// Verbose error printer: PostgREST errors don't have .stack and stringify to
// "[object Object]" by default. Print every field individually plus the JSON
// dump so we always see message/details/hint/code/status.
function dumpError(table: string, err: unknown): never {
    const e = err as Record<string, unknown> & { stack?: string };
    process.stderr.write(`\n┏━ FETCH FAILED: ${table} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    process.stderr.write(`┃ message: ${String(e?.message ?? '(none)')}\n`);
    process.stderr.write(`┃ details: ${String(e?.details ?? '(none)')}\n`);
    process.stderr.write(`┃ hint:    ${String(e?.hint ?? '(none)')}\n`);
    process.stderr.write(`┃ code:    ${String(e?.code ?? '(none)')}\n`);
    process.stderr.write(`┃ status:  ${String(e?.status ?? '(none)')}\n`);
    if (e?.stack) process.stderr.write(`┃ stack:\n${e.stack}\n`);
    let dump: string;
    try { dump = JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2); }
    catch { dump = String(err); }
    process.stderr.write(`┃ raw JSON:\n${dump}\n`);
    process.stderr.write(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    throw err;
}

// Read-only paginated fetcher. PostgREST defaults to a max of 1000 rows per
// request, so we page through using `.range(from, to)` until we get a partial
// page. Logs before/after each page, and dumps full error detail on failure.
async function fetchTable<T>(
    label: string,
    fn: (range: { from: number; to: number }) => Promise<{ data: unknown; error: unknown }>,
): Promise<T[]> {
    process.stderr.write(`Fetching ${label}…\n`);
    const PAGE = 1000;
    const all: T[] = [];
    let from = 0;
    while (true) {
        const to = from + PAGE - 1;
        let result;
        try {
            result = await fn({ from, to });
        } catch (err) {
            dumpError(label, err);
        }
        if (result!.error) dumpError(label, result!.error);
        const page = (result!.data || []) as T[];
        all.push(...page);
        if (page.length < PAGE) break;
        process.stderr.write(`  · ${label}: page ${from}-${to} (${page.length} rows, running total ${all.length})\n`);
        from += PAGE;
    }
    process.stderr.write(`  ↳ ${label}: ${all.length} rows total\n`);
    return all;
}

async function main() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Missing SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY).');
    const supabase: SupabaseClient = createClient(url, key);

    process.stderr.write(`Source: ${url}\n`);

    // Sequential paginated fetches so a failing table is unambiguous in the log.
    // STRICTLY READ-ONLY: only `.select()` is used below; no .insert/.update/.delete/.upsert/.rpc.
    const allDoctors = await fetchTable<DoctorRow>('doctors', ({ from, to }) =>
        supabase.from('doctors').select('id, name, parent_id, is_center').range(from, to));
    const allSuppliers = await fetchTable<SupplierRow>('suppliers', ({ from, to }) =>
        supabase.from('suppliers').select('id, name').range(from, to));
    // NOTE: `production_status` and `issue_state` (WF-1 shadow columns) are
    // intentionally NOT selected here so this drill-down works against
    // databases where migration 086 has not yet been applied (e.g. production
    // before WF-1.5 sign-off).
    const allOrders = await fetchTable<OrderRow>('orders', ({ from, to }) =>
        supabase.from('orders').select('id, case_id, doctor_id, supplier_id, status, total_price, cost, design_price, workflow_type, delivery_date, actual_delivery_date, created_at, is_archived, rejected_lab_cost, patient_name').range(from, to));
    const allTxs = await fetchTable<TxRow>('transactions', ({ from, to }) =>
        supabase.from('transactions').select('id, type, amount, date, category, description, entity_id, entity_type').range(from, to));
    const allObligs = await fetchTable<ObligRow>('financial_obligations', ({ from, to }) =>
        supabase.from('financial_obligations').select('id, order_id, entity_type, entity_id, direction, trigger_type, gross_amount, net_amount, status, metadata').neq('status', 'void').range(from, to));
    // `adjustments.notes` column does not exist on production yet — drop it from the SELECT.
    const allAdjs = await fetchTable<AdjRow>('adjustments', ({ from, to }) =>
        supabase.from('adjustments').select('id, entity_type, entity_id, type, amount, date').range(from, to));

    process.stderr.write(`Loaded: ${allDoctors.length} doctors, ${allSuppliers.length} suppliers, ${allOrders.length} orders, ${allTxs.length} transactions, ${allObligs.length} active obligations, ${allAdjs.length} adjustments.\n`);

    const out: string[] = [];
    out.push(`# WF-1.5 Reconciliation Drill-Down (read-only)`);
    out.push(`Generated: ${new Date().toISOString()}`);
    out.push(`Source: \`${url}\`\n`);
    out.push(`---\n`);
    out.push(`# Doctors\n`);
    for (const name of DOCTOR_NAMES) {
        const group = resolveDoctorGroup(name, allDoctors);
        out.push(reportDoctor(name, group, allOrders, allTxs, allObligs, allAdjs));
    }
    out.push(`# External Labs\n`);
    for (const name of SUPPLIER_NAMES) {
        const sup = resolveSupplier(name, allSuppliers);
        out.push(reportSupplier(name, sup, allOrders, allTxs, allObligs, allAdjs));
    }

    process.stdout.write(out.join('\n'));
    process.stderr.write('Done.\n');
}

main().catch(err => {
    // Top-level safety net. dumpError() already prints full detail when a
    // fetch fails; this only fires for unexpected non-fetch errors or rethrows.
    const e = err as Record<string, unknown> & { stack?: string };
    process.stderr.write('\nDrill-down failed.\n');
    process.stderr.write(`message: ${String(e?.message ?? '(none)')}\n`);
    process.stderr.write(`details: ${String(e?.details ?? '(none)')}\n`);
    process.stderr.write(`hint:    ${String(e?.hint ?? '(none)')}\n`);
    process.stderr.write(`code:    ${String(e?.code ?? '(none)')}\n`);
    process.stderr.write(`status:  ${String(e?.status ?? '(none)')}\n`);
    if (e?.stack) process.stderr.write(`stack:\n${e.stack}\n`);
    try {
        process.stderr.write(`raw JSON:\n${JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2)}\n`);
    } catch {
        process.stderr.write(`raw: ${String(err)}\n`);
    }
    process.exit(1);
});
