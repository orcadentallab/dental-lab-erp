// WF-1.5 P0 Tracer — Delivery → doctor_delivered obligation path (READ-ONLY).
//
// Investigates why 3 orders delivered on 2026-05-16 (after the 2026-05-13
// backfill) have NO doctor_delivered obligation. Compares with 5-10 control
// orders that DO have an obligation, to localise the bug.
//
// READ-ONLY GUARANTEES:
//   - Only `.select()` queries; no insert/update/delete/upsert/rpc.
//   - No writes to financial_obligations, transactions, orders, order_events,
//     adjustments, allocations, statements, balances, reports, or RLS.
//   - No status changes, no obligation creation/voiding, no migrations.
//
// Usage:
//   $env:SUPABASE_URL = "https://<project>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
//   npx tsx scripts/trace-delivery-obligation-path.ts > delivery-obligation-trace.md

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Targets (the 3 missing-obligation orders) ──────────────────────────────
const TARGET_ORDER_IDS: Array<{ id: string; expectedAmount: number; label: string }> = [
    { id: 'da65640a-bd1d-481b-83e6-13c9c0b7e2c1'.slice(0, 0) || 'da65640a', expectedAmount: 1350, label: '1013-260516-503 / Abdelrahman Elashram' },
    { id: '95e903c5', expectedAmount: 600,  label: '1044-260511-501 / Khaled El Morsy' },
    { id: 'b5a14943', expectedAmount: 600,  label: '1001-260516-524 / Mohamed Hassan' },
];

// We resolve full UUIDs via `case_id` (text column) since `orders.id` is UUID
// and PostgREST won't run `LIKE` against UUID without an explicit cast.
const TARGET_CASE_IDS = ['1013-260516-503', '1044-260511-501', '1001-260516-524'];

// ─── Types ──────────────────────────────────────────────────────────────────
type DoctorRow = { id: string; name: string };
type OrderRow = {
    id: string; case_id: string | null; doctor_id: string | null; supplier_id: string | null;
    status: string; total_price: number | null; cost: number | null;
    manual_cost: number | null; design_price: number | null; discount: number | null;
    workflow_type: string | null; delivery_date: string | null; actual_delivery_date: string | null;
    created_at: string; updated_at: string | null; is_archived: boolean | null;
    rejected_lab_cost: number | null; patient_name: string | null;
    status_history: Array<{ status: string; enteredAt: string; exitedAt?: string; durationMinutes?: number }> | null;
};
type ObligRow = {
    id: string; order_id: string; entity_type: string; entity_id: string;
    direction: string; trigger_type: string; source: string | null;
    gross_amount: number | null; net_amount: number | null; status: string;
    metadata: Record<string, unknown> | null; created_at: string;
};
type OrderEventRow = {
    id: string; order_id: string; event_type: string;
    old_value: string | null; new_value: string | null;
    changed_by: string | null; actor_role: string | null;
    changed_at: string; severity: string;
    reason: string | null; notes: string | null;
    metadata: Record<string, unknown> | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined) => (n == null ? '-' : Number(n).toFixed(2));
const dateOnly = (s?: string | null) => (s || '').split('T')[0];
const short = (id: string) => id.slice(0, 8);
const j = (x: unknown) => JSON.stringify(x ?? null).replace(/\|/g, '\\|');

function dumpError(table: string, err: unknown): never {
    const e = err as Record<string, unknown> & { stack?: string };
    process.stderr.write(`\n┏━ FETCH FAILED: ${table} ━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    process.stderr.write(`┃ message: ${String(e?.message ?? '(none)')}\n`);
    process.stderr.write(`┃ details: ${String(e?.details ?? '(none)')}\n`);
    process.stderr.write(`┃ hint:    ${String(e?.hint ?? '(none)')}\n`);
    process.stderr.write(`┃ code:    ${String(e?.code ?? '(none)')}\n`);
    let dump: string;
    try { dump = JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2); }
    catch { dump = String(err); }
    process.stderr.write(`┃ raw:\n${dump}\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
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

// Render an order summary block.
function renderOrderSnapshot(o: OrderRow, doctorName: string | null): string {
    const out: string[] = [];
    out.push(`- order_id: \`${o.id}\``);
    out.push(`- case_id: ${o.case_id ?? '-'}`);
    out.push(`- doctor_id: \`${o.doctor_id}\` (${doctorName ?? '?'})`);
    out.push(`- patient_name: ${o.patient_name ?? '-'}`);
    out.push(`- status: **${o.status}**`);
    out.push(`- workflow_type: ${o.workflow_type ?? '-'}`);
    out.push(`- total_price: ${fmt(o.total_price)}`);
    out.push(`- discount: ${fmt(o.discount)}`);
    out.push(`- cost: ${fmt(o.cost)} | manual_cost: ${fmt(o.manual_cost)} | design_price: ${fmt(o.design_price)}`);
    out.push(`- rejected_lab_cost: ${fmt(o.rejected_lab_cost)}`);
    out.push(`- delivery_date (planned): ${dateOnly(o.delivery_date)}`);
    out.push(`- actual_delivery_date: **${dateOnly(o.actual_delivery_date)}**`);
    out.push(`- created_at: ${o.created_at}`);
    out.push(`- updated_at: ${o.updated_at ?? '-'}`);
    out.push(`- is_archived: ${o.is_archived ?? false}`);
    out.push(`- status_history: ${o.status_history ? `${o.status_history.length} entries` : 'NULL'}`);
    if (o.status_history && o.status_history.length > 0) {
        for (const h of o.status_history) {
            out.push(`  - \`${h.status}\` enteredAt=\`${h.enteredAt}\`${h.exitedAt ? ` exitedAt=\`${h.exitedAt}\`` : ' (open)'}${h.durationMinutes != null ? ` duration=${h.durationMinutes}min` : ''}`);
        }
    }
    return out.join('\n');
}

function renderObligations(obs: ObligRow[]): string {
    if (obs.length === 0) return `_No obligations linked to this order._`;
    const lines: string[] = [];
    lines.push(`| id | trigger | source | direction | gross | net | status | created_at | metadata |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    for (const o of obs) {
        lines.push(`| \`${short(o.id)}\` | ${o.trigger_type} | ${o.source ?? '-'} | ${o.direction} | ${fmt(o.gross_amount)} | ${fmt(o.net_amount)} | ${o.status} | ${dateOnly(o.created_at)} | ${j(o.metadata).slice(0, 80)} |`);
    }
    return lines.join('\n');
}

function renderEvents(evs: OrderEventRow[]): string {
    if (evs.length === 0) return `_No order_events found for this order._`;
    const lines: string[] = [];
    lines.push(`| changed_at | event_type | old → new | severity | actor_role | changed_by | metadata |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const e of evs) {
        const transition = `${e.old_value ?? '∅'} → ${e.new_value ?? '∅'}`;
        lines.push(`| ${e.changed_at} | \`${e.event_type}\` | ${transition} | ${e.severity} | ${e.actor_role ?? '-'} | ${e.changed_by ? short(e.changed_by) : '-'} | ${j(e.metadata).slice(0, 80)} |`);
    }
    return lines.join('\n');
}

// Diagnose a single failed order.
function diagnose(
    order: OrderRow,
    obligations: ObligRow[],
    events: OrderEventRow[],
): { cause: string; confidence: string; reasoning: string[] } {
    const reasoning: string[] = [];
    const hasDoctorDeliveredOblig = obligations.some(o =>
        o.trigger_type === 'doctor_delivered' && o.status !== 'void');
    if (hasDoctorDeliveredOblig) {
        return {
            cause: 'NOT_A_FAILURE — obligation exists',
            confidence: 'high',
            reasoning: ['Active doctor_delivered obligation present.'],
        };
    }

    // Check status_history for Delivered transition
    const sh = order.status_history || [];
    const hasDeliveredInHistory = sh.some(h => h.status === 'Delivered');
    reasoning.push(`status_history contains "Delivered" entry: **${hasDeliveredInHistory}**.`);

    // Check order_events for status_changed → Delivered
    const statusChangeEvents = events.filter(e =>
        (e.event_type === 'status_changed' || e.event_type.startsWith('order_'))
        && e.new_value === 'Delivered'
    );
    reasoning.push(`order_events with new_value='Delivered': **${statusChangeEvents.length}**.`);

    // Check ANY event whatsoever
    reasoning.push(`Total order_events rows for this order: **${events.length}**.`);

    // Heuristic decision
    if (sh.some(h => h.status === 'Delivered') && statusChangeEvents.length === 0 && events.length === 0) {
        return {
            cause: 'status_changed_outside_updateOrderStatus',
            confidence: 'high',
            reasoning: [
                ...reasoning,
                'status_history shows Delivered transition, but NO order_events at all → status was set via a path that bypasses both `updateOrderStatus` and `createOrderEventNonBlocking`.',
                'Most likely: code called `updateOrder({ status: \'Delivered\' })` directly, OR a direct SQL/RPC update bypassing the service layer.',
                '`updateOrder` writes `status_history` + `actual_delivery_date` but does NOT call the financial hook (verified in `src/services/supabase/orders.ts:1192-1242`).',
            ],
        };
    }
    if (sh.some(h => h.status === 'Delivered') && statusChangeEvents.length === 0 && events.length > 0) {
        return {
            cause: 'status_changed_outside_updateOrderStatus',
            confidence: 'medium-high',
            reasoning: [
                ...reasoning,
                'status_history shows Delivered, other order_events exist, but no Delivered status_changed event → status flipped without going through `updateOrderStatus`.',
                'Check the actor of the last non-Delivered event vs the last entry in status_history.',
            ],
        };
    }
    if (statusChangeEvents.length > 0) {
        return {
            cause: 'financial_hook_called_but_obligation_not_persisted',
            confidence: 'medium',
            reasoning: [
                ...reasoning,
                '`updateOrderStatus` WAS called (event exists) but obligation row is missing.',
                'Possible causes: (a) `createDoctorReceivableObligationForOrder` threw, but the error was caught upstream; (b) RLS prevented the insert; (c) `buildDoctorReceivableCandidate` returned null because `isDeliveredForDoctorReceivable` was false at trigger time (e.g. issue_state column missing or set to cancelled/rejected); (d) FINANCIAL_OBLIGATIONS_FLAGS.trackingEnabled was momentarily disabled.',
                'In `updateOrderStatus` lines 1729-1746, the obligation creation throws on error — so a swallowed-error case is unlikely unless the caller swallowed it.',
            ],
        };
    }
    if (!hasDeliveredInHistory) {
        return {
            cause: 'predicate_mismatch_or_status_not_actually_delivered',
            confidence: 'medium',
            reasoning: [
                ...reasoning,
                'Order.status is "Delivered" but status_history shows no Delivered entry → row was inserted/seeded directly without going through `updateOrder` at all.',
            ],
        };
    }
    return {
        cause: 'unknown_needs_manual_repro',
        confidence: 'low',
        reasoning,
    };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Missing SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY).');
    const supabase: SupabaseClient = createClient(url, key);
    process.stderr.write(`Source: ${url}\n`);

    // Resolve target orders by case_id (text column, exact match via `.in()`).
    process.stderr.write(`Resolving target orders by case_id…\n`);
    const { data: targetData, error: targetErr } = await supabase
        .from('orders')
        .select('id, case_id, doctor_id, supplier_id, status, total_price, cost, manual_cost, design_price, discount, workflow_type, delivery_date, actual_delivery_date, created_at, updated_at, is_archived, rejected_lab_cost, patient_name, status_history')
        .in('case_id', TARGET_CASE_IDS);
    if (targetErr) dumpError('orders case_id IN (...)', targetErr);
    const targetOrders = (targetData || []) as OrderRow[];
    for (const want of TARGET_CASE_IDS) {
        const found = targetOrders.filter(o => o.case_id === want);
        if (found.length === 0) process.stderr.write(`  ⚠️ no order matched case_id ${want}\n`);
        else if (found.length > 1) process.stderr.write(`  ⚠️ multiple orders matched case_id ${want}: ${found.map(o => o.id).join(', ')}\n`);
    }
    process.stderr.write(`  ↳ resolved ${targetOrders.length} target orders\n`);

    // Pick controls: delivered orders with actual_delivery_date >= 2026-05-01,
    // limited to 30, then filter to those with an active doctor_delivered obligation.
    process.stderr.write(`Fetching control candidates (delivered orders after 2026-05-01)…\n`);
    const { data: candidatesRaw, error: candErr } = await supabase
        .from('orders')
        .select('id, case_id, doctor_id, supplier_id, status, total_price, cost, manual_cost, design_price, discount, workflow_type, delivery_date, actual_delivery_date, created_at, updated_at, is_archived, rejected_lab_cost, patient_name, status_history')
        .eq('status', 'Delivered')
        .gte('actual_delivery_date', '2026-05-01')
        .order('actual_delivery_date', { ascending: false })
        .limit(40);
    if (candErr) dumpError('control candidates', candErr);
    const candidates = (candidatesRaw || []) as OrderRow[];
    process.stderr.write(`  ↳ ${candidates.length} candidate delivered orders\n`);

    // Pull doctor names for everyone we'll show
    const doctorIds = Array.from(new Set([
        ...targetOrders.map(o => o.doctor_id).filter((x): x is string => !!x),
        ...candidates.map(o => o.doctor_id).filter((x): x is string => !!x),
    ]));
    process.stderr.write(`Fetching doctor names for ${doctorIds.length} doctors…\n`);
    const { data: doctorsData, error: docErr } = await supabase
        .from('doctors')
        .select('id, name')
        .in('id', doctorIds);
    if (docErr) dumpError('doctors', docErr);
    const doctorNameById = new Map<string, string>();
    for (const d of (doctorsData || []) as DoctorRow[]) doctorNameById.set(d.id, d.name);

    // Bulk-fetch obligations for all orders of interest (targets + candidates).
    const allOrderIds = Array.from(new Set([
        ...targetOrders.map(o => o.id),
        ...candidates.map(o => o.id),
    ]));
    process.stderr.write(`Fetching obligations for ${allOrderIds.length} orders…\n`);
    const { data: obligData, error: obligErr } = await supabase
        .from('financial_obligations')
        .select('id, order_id, entity_type, entity_id, direction, trigger_type, source, gross_amount, net_amount, status, metadata, created_at')
        .in('order_id', allOrderIds);
    if (obligErr) dumpError('financial_obligations', obligErr);
    const obligationsByOrder = new Map<string, ObligRow[]>();
    for (const o of (obligData || []) as ObligRow[]) {
        const list = obligationsByOrder.get(o.order_id) || [];
        list.push(o);
        obligationsByOrder.set(o.order_id, list);
    }

    // Bulk-fetch order_events for all orders of interest.
    process.stderr.write(`Fetching order_events for ${allOrderIds.length} orders…\n`);
    const { data: evtData, error: evtErr } = await supabase
        .from('order_events')
        .select('id, order_id, event_type, old_value, new_value, changed_by, actor_role, changed_at, severity, reason, notes, metadata')
        .in('order_id', allOrderIds)
        .order('changed_at', { ascending: true });
    if (evtErr) dumpError('order_events', evtErr);
    const eventsByOrder = new Map<string, OrderEventRow[]>();
    for (const e of (evtData || []) as OrderEventRow[]) {
        const list = eventsByOrder.get(e.order_id) || [];
        list.push(e);
        eventsByOrder.set(e.order_id, list);
    }

    // Pick 5-10 control orders: delivered AND has an active doctor_delivered obligation.
    const controls: OrderRow[] = [];
    for (const c of candidates) {
        if (controls.length >= 8) break;
        const obligs = obligationsByOrder.get(c.id) || [];
        const hasDoctorDelivered = obligs.some(o =>
            o.trigger_type === 'doctor_delivered' && o.status !== 'void');
        if (hasDoctorDelivered) controls.push(c);
    }
    process.stderr.write(`  ↳ selected ${controls.length} controls\n`);

    // ── Render report ──────────────────────────────────────────────────────
    const out: string[] = [];
    out.push(`# Delivery → doctor_delivered Obligation Trace (READ-ONLY)`);
    out.push(`Generated: ${new Date().toISOString()}`);
    out.push(`Source: \`${url}\`\n`);
    out.push(`> Investigates 3 delivered orders (2026-05-16) with no doctor_delivered obligation, compared against 5-8 control delivered orders that do have one. **No write actions executed.**\n`);
    out.push(`---\n`);

    // Sections A-D, per target order.
    out.push(`# Part 1: Target orders (missing obligations)\n`);
    for (const o of targetOrders) {
        const obligs = obligationsByOrder.get(o.id) || [];
        const evts = eventsByOrder.get(o.id) || [];
        const docName = o.doctor_id ? (doctorNameById.get(o.doctor_id) || null) : null;

        out.push(`## Target: ${o.case_id ?? '(no case)'} — ${o.patient_name ?? '?'}\n`);
        out.push(`### A) Order snapshot`);
        out.push(renderOrderSnapshot(o, docName));
        out.push(`\n### B) Obligation lookup`);
        out.push(renderObligations(obligs));
        const hasDD = obligs.some(x => x.trigger_type === 'doctor_delivered' && x.status !== 'void');
        out.push(`\n- **Active doctor_delivered obligation exists?** ${hasDD ? '✅ YES' : '❌ NO'}`);
        out.push(`\n### C) Order events`);
        out.push(renderEvents(evts));
        out.push(`\n### D) Status history analysis`);
        const sh = o.status_history || [];
        if (sh.length === 0) {
            out.push(`- status_history is empty or null.`);
        } else {
            const dEntry = sh.find(h => h.status === 'Delivered');
            if (!dEntry) out.push(`- ❌ No "Delivered" entry in status_history despite \`status = '${o.status}'\`.`);
            else {
                const prev = sh[sh.findIndex(h => h === dEntry) - 1];
                out.push(`- ✅ Delivered entry found: enteredAt=\`${dEntry.enteredAt}\`, previous=${prev ? `\`${prev.status}\`` : '(none)'}.`);
                out.push(`- Compare to actual_delivery_date=\`${dateOnly(o.actual_delivery_date)}\` — ${dateOnly(dEntry.enteredAt) === dateOnly(o.actual_delivery_date) ? 'matches' : '**mismatch — actual_delivery_date differs from history**'}.`);
            }
        }
        out.push(`\n---\n`);
    }

    // Section E: Controls
    out.push(`# Part 2: Control orders (delivered, obligation exists)\n`);
    out.push(`Selected ${controls.length} controls: delivered orders with \`actual_delivery_date >= 2026-05-01\` and an active doctor_delivered obligation.\n`);
    for (const c of controls) {
        const obligs = obligationsByOrder.get(c.id) || [];
        const evts = eventsByOrder.get(c.id) || [];
        const docName = c.doctor_id ? (doctorNameById.get(c.doctor_id) || null) : null;
        out.push(`## Control: ${c.case_id ?? '(no case)'} — ${c.patient_name ?? '?'}`);
        out.push(renderOrderSnapshot(c, docName));
        out.push(`\n**Obligations:**`);
        out.push(renderObligations(obligs));
        out.push(`\n**order_events (${evts.length} rows):**`);
        out.push(renderEvents(evts));
        out.push(`\n---\n`);
    }

    // Section F: Compare failed vs successful
    out.push(`# Part 3: Comparative analysis (F)\n`);
    out.push(`| order_id | role | actual_delivery | status_history len | has Delivered in history | order_events count | status_changed → Delivered events | doctor_delivered obligation | created_at age vs now |`);
    out.push(`|---|---|---|---|---|---|---|---|---|`);
    const renderRow = (o: OrderRow, role: 'TARGET' | 'CONTROL') => {
        const obligs = obligationsByOrder.get(o.id) || [];
        const evts = eventsByOrder.get(o.id) || [];
        const sh = o.status_history || [];
        const hasD = sh.some(h => h.status === 'Delivered');
        const scD = evts.filter(e => e.new_value === 'Delivered').length;
        const hasDD = obligs.some(x => x.trigger_type === 'doctor_delivered' && x.status !== 'void');
        return `| \`${short(o.id)}\` | **${role}** | ${dateOnly(o.actual_delivery_date)} | ${sh.length} | ${hasD ? '✅' : '❌'} | ${evts.length} | ${scD} | ${hasDD ? '✅' : '❌'} | ${o.created_at} |`;
    };
    for (const o of targetOrders) out.push(renderRow(o, 'TARGET'));
    for (const c of controls) out.push(renderRow(c, 'CONTROL'));

    // Section G: Code-path inspection (static reference, derived from grep)
    out.push(`\n# Part 4: Code-path inspection (G)\n`);
    out.push(`The following references are derived from the current workspace source at the time this script was generated. They do not execute code — they document the paths a runtime obligation creation must traverse.\n`);
    out.push(`**Obligation-creation entry point (the only path):**`);
    out.push(`- \`src/services/supabase/orders.ts:1565-1775\` — \`updateOrderStatus(orderId, newStatus, context)\``);
    out.push(`  - Lines 1729-1746: calls \`createDoctorReceivableObligationForOrder(updatedOrder, ...)\` if predicate passes.`);
    out.push(`  - Errors here are NOT swallowed: \`throw new Error(DOCTOR_RECEIVABLE_OBLIGATION_FAILURE_MESSAGE)\`.`);
    out.push(`\n**Bypass path that does NOT create obligations:**`);
    out.push(`- \`src/services/supabase/orders.ts:1167-1275\` — \`updateOrder(id, updates, context)\``);
    out.push(`  - Lines 1194-1243: updates \`status_history\` and \`actual_delivery_date\` when \`status = 'Delivered'\`.`);
    out.push(`  - **Never calls** \`createDoctorReceivableObligationForOrder\`. Any caller using \`updateOrder({ status: 'Delivered' })\` directly will produce status_history + actual_delivery_date but NO obligation.`);
    out.push(`\n**Predicates:**`);
    out.push(`- \`src/constants/financialObligations.ts:194-199\` — \`shouldCreateDoctorReceivableObligationForStatusChange(prev, new)\` returns \`prev !== new && new === 'Delivered'\`.`);
    out.push(`- \`src/constants/financialObligations.ts:134-137\` — \`buildDoctorReceivableCandidate(order)\` returns \`null\` if \`!order.id || !order.doctorId || !isDeliveredForDoctorReceivable(order)\`. **Null short-circuits createDoctorReceivableObligationForOrder silently** (no throw).`);
    out.push(`- \`src/constants/orderLifecycle.ts:181-184\` — \`isDeliveredForDoctorReceivable(order)\` requires \`getProductionStatus(order) === 'delivered'\` AND issueStatus not in {cancelled, rejected}.`);
    out.push(`\n**Idempotency check (used elsewhere, not at create-time):**`);
    out.push(`- \`src/services/supabase/financialObligations.ts:434-462\` — \`findActiveDoctorDeliveredObligationForOrder(orderId)\` filters by \`source = 'order'\`. Note: backfilled obligations have \`source = 'backfill'\` — so this function would NOT find them, and a duplicate could theoretically be created. (Not the cause of the missing-obligation bug, but flagged for awareness.)`);
    out.push(`\n**Error swallow points:**`);
    out.push(`- \`src/services/supabase/orders.ts:66-78\` — \`createOrderEventNonBlocking\` catches errors and only logs to \`console.error\`. This means a missing \`order_events\` row does NOT imply the financial path failed — but it does imply \`updateOrderStatus\` was at least invoked (because both calls happen in the same function).`);
    out.push(`- The financial hook itself (lines 1734-1745) does NOT swallow errors; failures throw and abort the status transition.`);
    out.push(`\n**Flag gating:**`);
    out.push(`- \`src/constants/financialObligations.ts:50-53\` — \`FINANCIAL_OBLIGATIONS_FLAGS.trackingEnabled = true\` (constant; cannot be off at runtime).`);

    // Section H: Final diagnosis per order
    out.push(`\n# Part 5: Final diagnosis (H)\n`);
    type Diag = ReturnType<typeof diagnose>;
    const diagnoses: Array<{ order: OrderRow; diag: Diag }> = [];
    for (const o of targetOrders) {
        const diag = diagnose(o, obligationsByOrder.get(o.id) || [], eventsByOrder.get(o.id) || []);
        diagnoses.push({ order: o, diag });
        out.push(`## ${o.case_id ?? '?'} — \`${short(o.id)}\``);
        out.push(`- **Cause**: \`${diag.cause}\``);
        out.push(`- **Confidence**: ${diag.confidence}`);
        out.push(`- **Reasoning**:`);
        for (const r of diag.reasoning) out.push(`  - ${r}`);
        out.push('');
    }

    // Section I: Recommended fix options
    out.push(`# Part 6: Recommended fix options (I) — NOT IMPLEMENTED\n`);
    const allBypass = diagnoses.every(d => d.diag.cause === 'status_changed_outside_updateOrderStatus');
    if (allBypass) {
        out.push(`All 3 targets indicate the **same root cause**: status changed via a path that bypasses \`updateOrderStatus\` (likely \`updateOrder({status: 'Delivered'})\` direct call or a UI/admin action that uses the generic update RPC).\n`);
        out.push(`**Fix options (any of these — not yet implemented):**`);
        out.push(`1. **Audit + redirect call sites**: grep for \`updateOrder(.*status:.*['"]Delivered['"]\` and convert each to \`updateOrderStatus(orderId, 'Delivered', ...)\`. Add a unit test that fails if a status change bypasses \`updateOrderStatus\`.`);
        out.push(`2. **Move the financial hook into \`updateOrder\` itself**: detect \`updates.status === 'Delivered'\` and \`prev !== new\`, then invoke the same hook. Risk: double-creation if both paths run. Mitigation: gate by checking \`findActiveDoctorDeliveredObligationForOrder\` first (but update its predicate to ignore \`source\` filter).`);
        out.push(`3. **Move the financial hook into the DB layer**: a Postgres trigger \`AFTER UPDATE OF status\` that inserts the obligation when transitioning to Delivered. This is the safest, since no service-layer bypass can avoid it. Belongs in WF-2.`);
        out.push(`4. **Tighten the idempotency function**: change \`findActiveDoctorDeliveredObligationForOrder\` to drop the \`source = 'order'\` filter, so backfilled and live-created obligations are both detected as existing. Prevents duplicates if multiple paths re-trigger.`);
    } else {
        out.push(`Diagnoses vary across the 3 targets — see Part 5 per-order causes and refer to the specific recommendation that matches each.`);
    }
    out.push(`\n> **No fix executed**. Decision required before any of options 1-4 are implemented.\n`);

    // Final table
    out.push(`---\n# Final summary table\n`);
    out.push(`| order_id | case_id | expected receivable | doctor_delivered obligation exists? | suspected failure point | confidence | recommended next action |`);
    out.push(`|---|---|---|---|---|---|---|`);
    for (const { order, diag } of diagnoses) {
        const obligs = obligationsByOrder.get(order.id) || [];
        const hasDD = obligs.some(x => x.trigger_type === 'doctor_delivered' && x.status !== 'void');
        const tgt = TARGET_ORDER_IDS.find(t => order.id.startsWith(t.id));
        const amt = tgt ? tgt.expectedAmount : (order.total_price || 0);
        out.push(`| \`${short(order.id)}\` | ${order.case_id ?? '-'} | ${fmt(amt)} | ${hasDD ? '✅' : '❌'} | \`${diag.cause}\` | ${diag.confidence} | Investigate call site that set status; see Part 6 |`);
    }

    out.push(`\n## Hard constraints honoured\n`);
    out.push(`- ✅ Read-only: only \`.select()\` queries used.`);
    out.push(`- ✅ No insert/update/delete/upsert/rpc anywhere in this script.`);
    out.push(`- ✅ No mutation of financial_obligations, transactions, orders, order_events, statements, balances, reports.`);
    out.push(`- ✅ \`app.workflow_strict_rep\` left untouched (OFF as per WF-1.5 gate).`);
    out.push(`- ✅ No migration changes.`);
    out.push(`- ✅ No fix applied — Part 6 is recommendations only.`);

    process.stdout.write(out.join('\n'));
    process.stderr.write('Done.\n');
}

main().catch(err => {
    const e = err as Record<string, unknown> & { stack?: string };
    process.stderr.write('\nTracer failed.\n');
    process.stderr.write(`message: ${String(e?.message ?? '(none)')}\n`);
    process.stderr.write(`details: ${String(e?.details ?? '(none)')}\n`);
    process.stderr.write(`hint:    ${String(e?.hint ?? '(none)')}\n`);
    process.stderr.write(`code:    ${String(e?.code ?? '(none)')}\n`);
    if (e?.stack) process.stderr.write(`stack:\n${e.stack}\n`);
    process.exit(1);
});
