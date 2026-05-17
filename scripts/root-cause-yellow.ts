// WF-1.5 Root-Cause Investigation — Yellow Group (read-only).
//
// Per-order drill-down for the 6 doctors whose reconciliation diff is
// NEGATIVE (official > obligation), meaning obligations are either missing
// or under-valued. Voiding stale obligations would make the gap worse, so
// this script gathers the per-order evidence needed to decide between:
//   - creating missing obligations
//   - correcting obligation amounts
//   - leaving an official-only adjustment in place
//
// READ-ONLY GUARANTEES:
//   - Only `.select()` queries; no insert/update/delete/upsert/rpc.
//   - No allocations, transaction writes, obligation writes, status changes.
//   - No migration changes, no workflow changes, no financial corrections.
//
// Usage:
//   $env:SUPABASE_URL = "https://<project>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
//   npx tsx scripts/root-cause-yellow.ts > root-cause-yellow-group.md

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
    getDoctorReceivableAmount,
    isDoctorStatementIncluded,
} from '../src/constants/orderLifecycle';
import type { Order } from '../src/services/db';

// ─── Hardcoded yellow-group entity list ─────────────────────────────────────
const YELLOW_DOCTORS: Array<{ name: string; rootId: string; goal: string }> = [
    { name: 'دنتال جاليري',     rootId: 'e109e723-9c34-4b74-8bdb-169b5c2eb1d2',
      goal: 'Explain why 13 orders total 43,900 but 13 non-stale obligations total 29,150.' },
    { name: 'عبدالرحمن الاشرم', rootId: 'ceeb79c2-9cd5-4ed4-b1e1-e68e03884590',
      goal: 'Identify the missing 1 order with no obligation (3 orders, 2 obligations).' },
    { name: 'خالد العامري',     rootId: '3c4cf0fa-ea07-4e07-a498-266bb8a8d1af',
      goal: 'Inspect the 950 EGP adjustment row — does it have any matching obligation?' },
    { name: 'خالد المرسي',      rootId: '777f495a-6a20-4324-9f4f-bbcd9674cac8',
      goal: 'Identify the single 600 EGP order with no obligation and no transaction.' },
    { name: 'محمد حسن',         rootId: '8518c5cb-e947-4d39-852b-55402cbbb8c9',
      goal: 'Find the 600 EGP missing/mismatched order. Compare all orders vs obligations.' },
    { name: 'مركز شفاء',        rootId: 'b39e4f11-1b66-4c7b-a4ed-3058b1890741',
      goal: 'Find the 600 EGP amount mismatch. Check if same cause as محمد حسن.' },
];

// ─── Types ──────────────────────────────────────────────────────────────────
type DoctorRow = { id: string; name: string; parent_id: string | null };
type OrderRow = {
    id: string; case_id: string | null; doctor_id: string | null; supplier_id: string | null;
    status: string; total_price: number | null; cost: number | null;
    manual_cost: number | null; design_price: number | null; discount: number | null;
    workflow_type: string | null; delivery_date: string | null; actual_delivery_date: string | null;
    created_at: string; is_archived: boolean | null; rejected_lab_cost: number | null;
    patient_name: string | null;
};
type ObligRow = {
    id: string; order_id: string; entity_type: string; entity_id: string;
    direction: string; trigger_type: string;
    gross_amount: number | null; net_amount: number | null; status: string;
    metadata: Record<string, unknown> | null; created_at: string;
};
type AdjRow = {
    id: string; entity_type: string; entity_id: string;
    type: 'charge' | 'credit'; amount: number; date: string;
    description?: string | null; created_at?: string;
};
type TxRow = {
    id: string; type: 'income' | 'expense'; amount: number; date: string;
    category: string | null; description: string | null;
    entity_id: string | null; entity_type: string | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toFixed(2);
const dateOnly = (s?: string | null) => (s || '').split('T')[0];
const short = (id: string) => id.slice(0, 8);

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

function resolveGroupIds(rootId: string, allDoctors: DoctorRow[]): string[] {
    const ids = new Set<string>([rootId]);
    let added = true;
    while (added) {
        added = false;
        for (const d of allDoctors) {
            if (d.parent_id && ids.has(d.parent_id) && !ids.has(d.id)) {
                ids.add(d.id); added = true;
            }
        }
    }
    return Array.from(ids);
}

// ─── Verbose error printing + paginated fetch (reused pattern) ──────────────
function dumpError(table: string, err: unknown): never {
    const e = err as Record<string, unknown> & { stack?: string };
    process.stderr.write(`\n┏━ FETCH FAILED: ${table} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    process.stderr.write(`┃ message: ${String(e?.message ?? '(none)')}\n`);
    process.stderr.write(`┃ details: ${String(e?.details ?? '(none)')}\n`);
    process.stderr.write(`┃ hint:    ${String(e?.hint ?? '(none)')}\n`);
    process.stderr.write(`┃ code:    ${String(e?.code ?? '(none)')}\n`);
    process.stderr.write(`┃ status:  ${String(e?.status ?? '(none)')}\n`);
    let dump: string;
    try { dump = JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2); }
    catch { dump = String(err); }
    process.stderr.write(`┃ raw:\n${dump}\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    throw err;
}

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
        try { result = await fn({ from, to }); } catch (err) { dumpError(label, err); }
        if (result!.error) dumpError(label, result!.error);
        const page = (result!.data || []) as T[];
        all.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
    }
    process.stderr.write(`  ↳ ${label}: ${all.length} rows total\n`);
    return all;
}

// ─── Per-entity report ──────────────────────────────────────────────────────
function reportEntity(
    entry: { name: string; rootId: string; goal: string },
    allDoctors: DoctorRow[],
    orders: OrderRow[],
    obligs: ObligRow[],
    adjs: AdjRow[],
    txs: TxRow[],
): string {
    const out: string[] = [];
    const ids = resolveGroupIds(entry.rootId, allDoctors);
    const idSet = new Set(ids);

    out.push(`## ${entry.name}`);
    out.push(`- Root id: \`${entry.rootId}\``);
    out.push(`- Roll-up ids (${ids.length}): \`${ids.join('`, `')}\``);
    out.push(`- **Goal**: ${entry.goal}`);

    const myOrders = orders.filter(o => o.doctor_id && idSet.has(o.doctor_id) && !o.is_archived);
    const myObligs = obligs.filter(o =>
        o.entity_type === 'doctor' && idSet.has(o.entity_id) &&
        o.status !== 'void' && o.trigger_type === 'doctor_delivered'
    );
    const myAdjs = adjs.filter(a => a.entity_type === 'doctor' && idSet.has(a.entity_id));
    const myTxs = txs.filter(t => t.entity_id && idSet.has(t.entity_id) && (t.entity_type === 'doctor' || !t.entity_type));

    // Pair obligations with orders by order_id
    const obligByOrder = new Map<string, ObligRow[]>();
    for (const o of myObligs) {
        const list = obligByOrder.get(o.order_id) || [];
        list.push(o);
        obligByOrder.set(o.order_id, list);
    }

    // ── Section A: Official order rows (all orders, billable flag included)
    out.push(`\n### A) Official order rows (all non-archived orders for this entity)`);
    out.push(`| # | order_id | case_id | patient | status | wf_type | totalPrice | discount | cost | manualCost | designPrice | rejectedLabCost | actualDeliveryDate | billable? | official receivable amt |`);
    out.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    let idx = 0;
    let totalOfficial = 0;
    const orderSummaries: Array<{
        order: OrderRow; billable: boolean; officialAmt: number;
    }> = [];
    // Sort by created_at for stable output
    const sortedOrders = [...myOrders].sort((a, b) =>
        (a.created_at || '').localeCompare(b.created_at || ''));
    for (const r of sortedOrders) {
        idx++;
        const lc = toLifecycle(r);
        const included = isDoctorStatementIncluded(lc);
        const amt = included ? getDoctorReceivableAmount(lc) : 0;
        const billable = included && amt > 0;
        if (billable) totalOfficial += amt;
        orderSummaries.push({ order: r, billable, officialAmt: amt });
        out.push(`| ${idx} | \`${short(r.id)}\` | ${r.case_id ?? '-'} | ${r.patient_name ?? '-'} | ${r.status} | ${r.workflow_type ?? '-'} | ${fmt(r.total_price || 0)} | ${fmt(r.discount || 0)} | ${fmt(r.cost || 0)} | ${r.manual_cost == null ? '-' : fmt(r.manual_cost)} | ${r.design_price == null ? '-' : fmt(r.design_price)} | ${r.rejected_lab_cost == null ? '-' : fmt(r.rejected_lab_cost)} | ${dateOnly(r.actual_delivery_date)} | ${billable ? 'YES' : 'no'} | ${fmt(amt)} |`);
    }
    out.push(`- **Billable orders**: ${orderSummaries.filter(s => s.billable).length}`);
    out.push(`- **Official receivable total**: \`${fmt(totalOfficial)}\``);

    // ── Section B: Matching obligations (per order, doctor_delivered, non-void)
    out.push(`\n### B) Matching obligations (doctor_delivered, non-void)`);
    out.push(`| order_id | case_id | obligation_id | gross | net | status | backfill | createdAt | metadata |`);
    out.push(`|---|---|---|---|---|---|---|---|---|`);
    let totalObligationsPaired = 0;
    let pairedCount = 0;
    for (const r of sortedOrders) {
        const list = obligByOrder.get(r.id) || [];
        if (list.length === 0) continue;
        for (const o of list) {
            pairedCount++;
            totalObligationsPaired += (o.net_amount || 0);
            const meta = o.metadata || {};
            const metaStr = JSON.stringify(meta).replace(/\|/g, '\\|').slice(0, 90);
            out.push(`| \`${short(r.id)}\` | ${r.case_id ?? '-'} | \`${short(o.id)}\` | ${fmt(o.gross_amount || 0)} | ${fmt(o.net_amount || 0)} | ${o.status} | ${meta['backfill'] ?? '-'} | ${dateOnly(o.created_at)} | ${metaStr} |`);
        }
    }
    // Orphan obligations (obligation with order_id not in this entity's orders)
    const myOrderIds = new Set(myOrders.map(o => o.id));
    const orphanObligs = myObligs.filter(o => !myOrderIds.has(o.order_id));
    if (orphanObligs.length > 0) {
        out.push(`\n_Orphan obligations (order missing or archived):_`);
        for (const o of orphanObligs) {
            out.push(`- \`${o.id}\` → order \`${o.order_id}\` net \`${fmt(o.net_amount || 0)}\``);
        }
    }
    out.push(`- **Paired obligations**: ${pairedCount}`);
    out.push(`- **Paired obligation net total**: \`${fmt(totalObligationsPaired)}\``);

    // ── Section C: Missing obligations (billable orders without any obligation)
    out.push(`\n### C) Missing obligations (billable orders with no doctor_delivered obligation)`);
    const missing: Array<{ order: OrderRow; amt: number }> = [];
    for (const s of orderSummaries) {
        if (!s.billable) continue;
        const list = obligByOrder.get(s.order.id) || [];
        if (list.length === 0) missing.push({ order: s.order, amt: s.officialAmt });
    }
    if (missing.length === 0) {
        out.push(`_(none — every billable order has at least one obligation)_`);
    } else {
        out.push(`| order_id | case_id | patient | status | totalPrice | official amt | actualDeliveryDate |`);
        out.push(`|---|---|---|---|---|---|---|`);
        for (const m of missing) {
            out.push(`| \`${short(m.order.id)}\` | ${m.order.case_id ?? '-'} | ${m.order.patient_name ?? '-'} | ${m.order.status} | ${fmt(m.order.total_price || 0)} | ${fmt(m.amt)} | ${dateOnly(m.order.actual_delivery_date)} |`);
        }
        out.push(`- **Missing-obligation total**: \`${fmt(missing.reduce((s, m) => s + m.amt, 0))}\``);
    }

    // ── Section D: Amount mismatches (order is billable AND has obligation AND amounts differ)
    out.push(`\n### D) Amount mismatches (billable order WITH obligation, but amounts differ)`);
    const mismatches: Array<{
        order: OrderRow; officialAmt: number; obligTotal: number; diff: number;
        obligIds: string[];
    }> = [];
    for (const s of orderSummaries) {
        if (!s.billable) continue;
        const list = obligByOrder.get(s.order.id) || [];
        if (list.length === 0) continue;
        const obligTotal = list.reduce((sum, o) => sum + (o.gross_amount || 0), 0);
        const diff = s.officialAmt - obligTotal;
        if (Math.abs(diff) >= 0.01) {
            mismatches.push({
                order: s.order, officialAmt: s.officialAmt, obligTotal, diff,
                obligIds: list.map(o => o.id),
            });
        }
    }
    if (mismatches.length === 0) {
        out.push(`_(none — all paired obligations match order receivable amount)_`);
    } else {
        out.push(`| order_id | case_id | patient | status | totalPrice | discount | cost | designPrice | wf_type | obligation_id(s) | obligation gross sum | official amt | diff (official−oblig) |`);
        out.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
        for (const m of mismatches) {
            out.push(`| \`${short(m.order.id)}\` | ${m.order.case_id ?? '-'} | ${m.order.patient_name ?? '-'} | ${m.order.status} | ${fmt(m.order.total_price || 0)} | ${fmt(m.order.discount || 0)} | ${fmt(m.order.cost || 0)} | ${m.order.design_price == null ? '-' : fmt(m.order.design_price)} | ${m.order.workflow_type ?? '-'} | ${m.obligIds.map(i => '`' + short(i) + '`').join(', ')} | ${fmt(m.obligTotal)} | ${fmt(m.officialAmt)} | **${fmt(m.diff)}** |`);
        }
        out.push(`- **Mismatch count**: ${mismatches.length}`);
        out.push(`- **Mismatch diff total**: \`${fmt(mismatches.reduce((s, m) => s + m.diff, 0))}\``);
    }

    // ── Section E: Adjustments and matching obligations
    out.push(`\n### E) Adjustments (official-only, may or may not have matching obligation)`);
    if (myAdjs.length === 0) {
        out.push(`_(none)_`);
    } else {
        out.push(`| adjustment_id | type | amount | date |`);
        out.push(`|---|---|---|---|`);
        for (const a of myAdjs) {
            out.push(`| \`${a.id}\` | ${a.type} | ${fmt(a.amount)} | ${dateOnly(a.date)} |`);
        }
        // Try to find any obligation whose metadata references an adjustment id
        const refs: string[] = [];
        for (const a of myAdjs) {
            for (const o of myObligs) {
                const meta = o.metadata || {};
                const metaStr = JSON.stringify(meta);
                if (metaStr.includes(a.id)) refs.push(`- adjustment \`${a.id}\` referenced by obligation \`${o.id}\``);
            }
        }
        out.push(refs.length === 0
            ? `- No obligation metadata references any of these adjustments (i.e. official-only).`
            : refs.join('\n'));
    }

    // ── Section F: Suspected root cause + G: Recommended (non-executed) options
    const missingSum = missing.reduce((s, m) => s + m.amt, 0);
    const mismatchSum = mismatches.reduce((s, m) => s + m.diff, 0);
    const adjCharges = myAdjs.filter(a => a.type === 'charge').reduce((s, a) => s + a.amount, 0);
    const adjCredits = myAdjs.filter(a => a.type === 'credit').reduce((s, a) => s + a.amount, 0);

    out.push(`\n### F) Suspected root cause (auto-derived from sections A-E)`);
    const causes: string[] = [];
    if (missing.length > 0) causes.push(`- ${missing.length} billable order(s) have **NO obligation row** at all → historical backfill incomplete. Missing total: \`${fmt(missingSum)}\`.`);
    if (mismatches.length > 0) causes.push(`- ${mismatches.length} order(s) have obligations whose **gross_amount ≠ order receivable**. Net mismatch (official − obligation): \`${fmt(mismatchSum)}\`. Inspect \`discount\`, \`workflow_type\`, \`manual_cost\`, and obligation \`metadata.backfill\` for these orders.`);
    if (myAdjs.length > 0 && missing.length === 0 && mismatches.length === 0) {
        causes.push(`- All orders paired correctly. Diff comes entirely from official-side \`adjustments\` (charges \`${fmt(adjCharges)}\`, credits \`${fmt(adjCredits)}\`) which have no obligation counterpart by design.`);
    }
    if (causes.length === 0) {
        causes.push(`- No structural cause detected by this script. Diff may be due to transaction allocation, archived/duplicate rows, or rounding.`);
    }
    out.push(causes.join('\n'));

    out.push(`\n### G) Recommended correction options (NOT EXECUTED)`);
    const opts: string[] = [];
    if (missing.length > 0) {
        opts.push(`- **Option G1**: Backfill obligation rows for the ${missing.length} missing order(s) in Section C. Total amount: \`${fmt(missingSum)}\`. Requires explicit decision on \`gross_amount\` formula (totalPrice − discount? totalPrice raw?) and on metadata flag (\`backfill: true, source: 'manual_yellow_group_fix'\`).`);
    }
    if (mismatches.length > 0) {
        opts.push(`- **Option G2**: Correct obligation \`gross_amount\` / \`net_amount\` for the ${mismatches.length} mismatched obligation(s) in Section D to match \`getDoctorReceivableAmount(order)\`. Net adjustment: \`${fmt(mismatchSum)}\`.`);
    }
    if (myAdjs.length > 0) {
        opts.push(`- **Option G3** (policy): Decide whether \`adjustments\` rows should generate matching obligations going forward. Currently they appear official-only. If kept official-only, the diff is **expected** and is not a bug.`);
    }
    opts.push(`- **Option G4** (null action): Leave as-is and document the diff as historical-known noise; require sign-off before any of G1/G2/G3 are executed.`);
    out.push(opts.join('\n'));

    out.push(`\n---\n`);
    return out.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Missing SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY).');
    const supabase: SupabaseClient = createClient(url, key);
    process.stderr.write(`Source: ${url}\n`);

    // STRICTLY READ-ONLY: only `.select()` is used below.
    const allDoctors = await fetchTable<DoctorRow>('doctors', ({ from, to }) =>
        supabase.from('doctors').select('id, name, parent_id').range(from, to));
    const allOrders = await fetchTable<OrderRow>('orders', ({ from, to }) =>
        supabase.from('orders').select('id, case_id, doctor_id, supplier_id, status, total_price, cost, manual_cost, design_price, discount, workflow_type, delivery_date, actual_delivery_date, created_at, is_archived, rejected_lab_cost, patient_name').range(from, to));
    const allObligs = await fetchTable<ObligRow>('financial_obligations', ({ from, to }) =>
        supabase.from('financial_obligations').select('id, order_id, entity_type, entity_id, direction, trigger_type, gross_amount, net_amount, status, metadata, created_at').neq('status', 'void').range(from, to));
    // NOTE: `description` and `created_at` columns do not exist on the
    // production `adjustments` table — keep this SELECT minimal to match the
    // proven pattern in scripts/reconciliation-drilldown.ts.
    const allAdjs = await fetchTable<AdjRow>('adjustments', ({ from, to }) =>
        supabase.from('adjustments').select('id, entity_type, entity_id, type, amount, date').range(from, to));
    const allTxs = await fetchTable<TxRow>('transactions', ({ from, to }) =>
        supabase.from('transactions').select('id, type, amount, date, category, description, entity_id, entity_type').range(from, to));

    process.stderr.write(`Loaded: ${allDoctors.length} doctors, ${allOrders.length} orders, ${allObligs.length} non-void obligations, ${allAdjs.length} adjustments, ${allTxs.length} transactions.\n`);

    const out: string[] = [];
    out.push(`# WF-1.5 Root-Cause Investigation — Yellow Group (read-only)`);
    out.push(`Generated: ${new Date().toISOString()}`);
    out.push(`Source: \`${url}\`\n`);
    out.push(`> Scope: per-order drill-down for the 6 doctors whose reconciliation diff is NEGATIVE (official > obligation). Goal is to decide between (a) creating missing obligations, (b) correcting obligation amounts, or (c) leaving adjustments official-only. **No write actions executed.**\n`);
    out.push(`---\n`);

    // Per-entity sections.
    const entitySummaries: Array<{
        name: string; missingCount: number; missingSum: number;
        mismatchCount: number; mismatchSum: number;
        adjCount: number; adjNet: number;
        missingOrderIds: string[]; mismatchOrderIds: string[];
        mismatchObligIds: string[]; adjIds: string[];
    }> = [];

    for (const entry of YELLOW_DOCTORS) {
        out.push(reportEntity(entry, allDoctors, allOrders, allObligs, allAdjs, allTxs));
        // Recompute summary numbers for the final table
        const ids = resolveGroupIds(entry.rootId, allDoctors);
        const idSet = new Set(ids);
        const myOrders = allOrders.filter(o => o.doctor_id && idSet.has(o.doctor_id) && !o.is_archived);
        const myObligs = allObligs.filter(o =>
            o.entity_type === 'doctor' && idSet.has(o.entity_id) &&
            o.status !== 'void' && o.trigger_type === 'doctor_delivered'
        );
        const myAdjs = allAdjs.filter(a => a.entity_type === 'doctor' && idSet.has(a.entity_id));
        const obligByOrder = new Map<string, ObligRow[]>();
        for (const o of myObligs) {
            const list = obligByOrder.get(o.order_id) || [];
            list.push(o); obligByOrder.set(o.order_id, list);
        }
        const missingOrderIds: string[] = [];
        const mismatchOrderIds: string[] = [];
        const mismatchObligIds: string[] = [];
        let missingSum = 0, mismatchSum = 0;
        for (const r of myOrders) {
            const lc = toLifecycle(r);
            if (!isDoctorStatementIncluded(lc)) continue;
            const amt = getDoctorReceivableAmount(lc);
            if (amt <= 0) continue;
            const list = obligByOrder.get(r.id) || [];
            if (list.length === 0) {
                missingOrderIds.push(r.id);
                missingSum += amt;
            } else {
                const obligTotal = list.reduce((s, o) => s + (o.gross_amount || 0), 0);
                const diff = amt - obligTotal;
                if (Math.abs(diff) >= 0.01) {
                    mismatchOrderIds.push(r.id);
                    list.forEach(o => mismatchObligIds.push(o.id));
                    mismatchSum += diff;
                }
            }
        }
        const adjNet = myAdjs.reduce((s, a) => s + (a.type === 'charge' ? a.amount : -a.amount), 0);
        entitySummaries.push({
            name: entry.name,
            missingCount: missingOrderIds.length, missingSum,
            mismatchCount: mismatchOrderIds.length, mismatchSum,
            adjCount: myAdjs.length, adjNet,
            missingOrderIds, mismatchOrderIds, mismatchObligIds,
            adjIds: myAdjs.map(a => a.id),
        });
    }

    // ── Final summary table
    out.push(`# Final Summary Table\n`);
    out.push(`| entity | issue type | order_ids | obligation_ids | amount diff | recommended next action | confidence |`);
    out.push(`|---|---|---|---|---|---|---|`);
    for (const s of entitySummaries) {
        const types: string[] = [];
        if (s.missingCount > 0) types.push(`missing_obligation (${s.missingCount})`);
        if (s.mismatchCount > 0) types.push(`amount_mismatch (${s.mismatchCount})`);
        if (s.adjCount > 0 && s.missingCount === 0 && s.mismatchCount === 0) types.push(`official_adjustment_only (${s.adjCount})`);
        const issueType = types.length > 0 ? types.join('; ') : 'unknown';
        const orderIds = [...s.missingOrderIds, ...s.mismatchOrderIds];
        const orderIdsStr = orderIds.length === 0 ? '-' : orderIds.map(i => '`' + short(i) + '`').join(', ');
        const obligIdsStr = s.mismatchObligIds.length === 0 ? '-' : s.mismatchObligIds.map(i => '`' + short(i) + '`').join(', ');
        const diffTotal = s.missingSum + s.mismatchSum;
        const action: string[] = [];
        if (s.missingCount > 0) action.push(`backfill ${s.missingCount} missing obligation(s)`);
        if (s.mismatchCount > 0) action.push(`correct ${s.mismatchCount} obligation amount(s)`);
        if (s.adjCount > 0 && s.missingCount === 0 && s.mismatchCount === 0) action.push(`policy decision on ${s.adjCount} adjustment(s)`);
        if (action.length === 0) action.push('investigate further');
        // Confidence heuristic:
        //   high   = single clear cause (only missing OR only mismatch, small count)
        //   medium = multiple causes mixed, or adjustment-only
        //   low    = no clear cause detected
        let confidence = 'low';
        if ((s.missingCount > 0 && s.mismatchCount === 0) || (s.mismatchCount > 0 && s.missingCount === 0)) confidence = 'high';
        else if (s.missingCount > 0 || s.mismatchCount > 0 || s.adjCount > 0) confidence = 'medium';
        out.push(`| ${s.name} | ${issueType} | ${orderIdsStr} | ${obligIdsStr} | \`${fmt(diffTotal)}\` | ${action.join('; ')} | ${confidence} |`);
    }

    out.push(`\n# Next decisions (NOT EXECUTED)\n`);
    out.push(`After reviewing this report, decide per-entity which option to apply:`);
    out.push(`1. **Create missing obligations** (Option G1 above) — requires choosing the gross_amount formula.`);
    out.push(`2. **Correct obligation amounts** (Option G2) — requires confirming \`getDoctorReceivableAmount\` is the canonical formula.`);
    out.push(`3. **Leave adjustments as official-only** (Option G3) — policy decision.`);
    out.push(`4. **Proceed with green-group stale void only** (3 doctors, 7 obligations) — independent of yellow-group decisions.`);
    out.push(`\nNo writes have been performed. This file is the input to the next sign-off.\n`);

    process.stdout.write(out.join('\n'));
    process.stderr.write('Done.\n');
}

main().catch(err => {
    const e = err as Record<string, unknown> & { stack?: string };
    process.stderr.write('\nRoot-cause investigation failed.\n');
    process.stderr.write(`message: ${String(e?.message ?? '(none)')}\n`);
    process.stderr.write(`details: ${String(e?.details ?? '(none)')}\n`);
    process.stderr.write(`hint:    ${String(e?.hint ?? '(none)')}\n`);
    process.stderr.write(`code:    ${String(e?.code ?? '(none)')}\n`);
    if (e?.stack) process.stderr.write(`stack:\n${e.stack}\n`);
    process.exit(1);
});
