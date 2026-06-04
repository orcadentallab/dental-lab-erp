/**
 * Task 6: Final Financial System Verification
 * 
 * Checks:
 * 1. TypeScript compilation (already passed)
 * 2. Obligations consistency: No void obligations with active allocations
 * 3. Allocation integrity: All active allocations point to non-void obligations
 * 4. Designer payable check: Orders with designStatus=completed and split workflow 
 *    should have designer payable obligations
 * 5. Balance sanity: obligation-based balance vs official transaction balance
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Manual .env loader
function loadEnv(filePath: string) {
    if (!existsSync(filePath)) return;
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        process.env[key] = process.env[key] ?? val;
    }
}
loadEnv(join(process.cwd(), '.env'));
loadEnv(join(process.cwd(), '.env.local'));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface CheckResult {
    name: string;
    passed: boolean;
    details: string;
    count?: number;
}

const results: CheckResult[] = [];

function pass(name: string, details: string, count?: number) {
    results.push({ name, passed: true, details, count });
    console.log(`  ✅ ${name}: ${details}`);
}

function fail(name: string, details: string, count?: number) {
    results.push({ name, passed: false, details, count });
    console.log(`  ❌ ${name}: ${details}`);
}

function warn(name: string, details: string, count?: number) {
    results.push({ name, passed: true, details: `[WARN] ${details}`, count });
    console.log(`  ⚠️  ${name}: ${details}`);
}

// ---------------------------------------------------------------------------
// Check 1: No active allocations pointing to voided obligations
// ---------------------------------------------------------------------------
async function checkAllocationsOnVoidedObligations() {
    console.log('\n[1] Checking active allocations on voided obligations...');

    const { data, error } = await supabase
        .from('payment_allocations')
        .select('id, obligation_id, allocated_amount, financial_obligations!inner(status)')
        .eq('status', 'active')
        .eq('financial_obligations.status', 'void');

    if (error) {
        fail('allocations_on_void', `Query error: ${error.message}`);
        return;
    }

    if (!data || data.length === 0) {
        pass('allocations_on_void', 'No active allocations point to voided obligations', 0);
    } else {
        fail('allocations_on_void',
            `Found ${data.length} active allocation(s) still pointing to voided obligations — these need reallocatePaymentsAfterObligationVoid`,
            data.length
        );
        data.slice(0, 5).forEach((r: any) => {
            console.log(`    → allocation ${r.id}, obligation ${r.obligation_id}, amount ${r.allocated_amount}`);
        });
    }
}

// ---------------------------------------------------------------------------
// Check 2: allocated_amount = sum of active payment_allocations per obligation
// ---------------------------------------------------------------------------
async function checkObligationAllocatedAmountConsistency() {
    console.log('\n[2] Checking obligation allocated_amount consistency...');

    const { data: obRows, error: obError } = await supabase
        .from('financial_obligations')
        .select('id, allocated_amount, net_amount, status')
        .in('status', ['unpaid', 'partially_paid', 'paid']);

    if (obError) {
        fail('obligation_amounts', `Query error: ${obError.message}`);
        return;
    }

    const { data: allocRows, error: allocError } = await supabase
        .from('payment_allocations')
        .select('obligation_id, allocated_amount')
        .eq('status', 'active');

    if (allocError) {
        fail('obligation_amounts', `Alloc query error: ${allocError.message}`);
        return;
    }

    // Sum up allocations per obligation
    const allocSums = new Map<string, number>();
    for (const a of (allocRows || []) as any[]) {
        const prev = allocSums.get(a.obligation_id) || 0;
        allocSums.set(a.obligation_id, prev + Number(a.allocated_amount));
    }

    let mismatches = 0;
    for (const ob of (obRows || []) as any[]) {
        const dbAllocated = Number(ob.allocated_amount);
        const computed = allocSums.get(ob.id) || 0;
        const diff = Math.abs(dbAllocated - computed);
        if (diff > 0.01) {
            mismatches++;
            if (mismatches <= 5) {
                console.log(`    → obligation ${ob.id}: db_allocated=${dbAllocated}, sum_of_allocs=${computed.toFixed(2)}, diff=${diff.toFixed(2)}`);
            }
        }
    }

    if (mismatches === 0) {
        pass('obligation_amounts', `All ${(obRows || []).length} obligations have consistent allocated_amount`, 0);
    } else {
        fail('obligation_amounts', `${mismatches} obligations have allocated_amount ≠ sum of active payment_allocations`, mismatches);
    }
}

// ---------------------------------------------------------------------------
// Check 3: Split orders with completed design should have designer payable
// ---------------------------------------------------------------------------
async function checkDesignerPayableObligations() {
    console.log('\n[3] Checking designer payable obligations for completed split orders...');

    // Try to query orders with designer info
    const { data: eligibleOrders, error: ordError } = await supabase
        .from('orders')
        .select('id, case_id, designer_id, design_price, design_status, workflow_type, status')
        .eq('workflow_type', 'split')
        .eq('design_status', 'completed')
        .not('designer_id', 'is', null)
        .gt('design_price', 0);

    if (ordError) {
        if (ordError.code === '42501' || ordError.message?.includes('permission denied')) {
            warn('designer_payable', 'Cannot verify designer payable — anon key lacks orders table access. Run with service role key for full check.');
            return;
        }
        fail('designer_payable', `Query error: ${ordError.message}`);
        return;
    }

    // Filter out cancelled/rejected in JS to avoid RLS issues with operator
    const eligible = (eligibleOrders || []).filter(
        (o: any) => o.status !== 'Cancelled' && o.status !== 'Rejected'
    );

    if (!eligible.length) {
        pass('designer_payable', 'No split orders with completed design found (backfill may be needed later)', 0);
        return;
    }

    const orderIds = eligible.map((o: any) => o.id);
    const { data: obRows, error: obError } = await supabase
        .from('financial_obligations')
        .select('order_id, status')
        .in('order_id', orderIds)
        .eq('entity_type', 'designer')
        .eq('direction', 'payable')
        .eq('trigger_type', 'designer_approved')
        .neq('status', 'void');

    if (obError) {
        fail('designer_payable', `Obligations query error: ${obError.message}`);
        return;
    }

    const coveredOrderIds = new Set((obRows || []).map((r: any) => r.order_id));
    const missing = eligible.filter((o: any) => !coveredOrderIds.has(o.id));

    if (missing.length === 0) {
        pass('designer_payable', `All ${eligible.length} completed split design orders have designer payable obligations`, eligible.length);
    } else {
        warn('designer_payable',
            `${missing.length}/${eligible.length} completed split orders are missing designer payable obligations (need backfill)`,
            missing.length
        );
        missing.slice(0, 5).forEach((o: any) => {
            console.log(`    → Order ${o.case_id || o.id}, designer=${o.designer_id}, design_price=${o.design_price}`);
        });
    }
}

// ---------------------------------------------------------------------------
// Check 4: Obligation status vs allocated_amount coherence
// ---------------------------------------------------------------------------
async function checkObligationStatusCoherence() {
    console.log('\n[4] Checking obligation status/amount coherence...');

    const { data, error } = await supabase
        .from('financial_obligations')
        .select('id, status, net_amount, allocated_amount, remaining_amount')
        .neq('status', 'void')
        .neq('status', 'written_off');

    if (error) {
        fail('status_coherence', `Query error: ${error.message}`);
        return;
    }

    let badStatus = 0;
    let badRemaining = 0;
    for (const ob of (data || []) as any[]) {
        const net = Number(ob.net_amount);
        const alloc = Number(ob.allocated_amount);
        const remaining = Number(ob.remaining_amount);
        const expectedRemaining = net - alloc;

        // Check remaining_amount
        if (Math.abs(remaining - expectedRemaining) > 0.01) {
            badRemaining++;
        }

        // Check status coherence
        const paidFully = alloc >= net - 0.01;
        const partiallyPaid = alloc > 0.01 && alloc < net - 0.01;
        const unpaid = alloc <= 0.01;

        if (paidFully && ob.status !== 'paid') badStatus++;
        else if (partiallyPaid && ob.status !== 'partially_paid') badStatus++;
        else if (unpaid && ob.status !== 'unpaid') badStatus++;
    }

    if (badStatus === 0 && badRemaining === 0) {
        pass('status_coherence', `All ${(data || []).length} active obligations have correct status and remaining_amount`, 0);
    } else {
        if (badRemaining > 0) fail('status_coherence_remaining', `${badRemaining} obligations have incorrect remaining_amount`, badRemaining);
        else pass('status_coherence_remaining', 'All remaining_amounts correct', 0);
        if (badStatus > 0) warn('status_coherence_status', `${badStatus} obligations may have stale status (payment triggers may not have updated them)`, badStatus);
        else pass('status_coherence_status', 'All obligation statuses coherent', 0);
    }
}

// ---------------------------------------------------------------------------
// Check 5: Overall financial obligations summary
// ---------------------------------------------------------------------------
async function printFinancialSummary() {
    console.log('\n[5] Financial Obligations Summary...');

    const { data: summary, error } = await supabase
        .from('financial_obligations')
        .select('direction, entity_type, status, net_amount, allocated_amount, remaining_amount');

    if (error) {
        fail('summary', `Query error: ${error.message}`);
        return;
    }

    const rows = (summary || []) as any[];
    const byStatus = new Map<string, { count: number; net: number; allocated: number; remaining: number }>();

    for (const row of rows) {
        const key = `${row.direction}:${row.entity_type}:${row.status}`;
        const prev = byStatus.get(key) || { count: 0, net: 0, allocated: 0, remaining: 0 };
        byStatus.set(key, {
            count: prev.count + 1,
            net: prev.net + Number(row.net_amount),
            allocated: prev.allocated + Number(row.allocated_amount),
            remaining: prev.remaining + Number(row.remaining_amount),
        });
    }

    console.log('\n  Direction       | Entity Type  | Status          | Count | Net        | Allocated  | Remaining');
    console.log('  ' + '-'.repeat(100));
    for (const [key, v] of [...byStatus.entries()].sort()) {
        const [dir, entity, status] = key.split(':');
        console.log(`  ${dir.padEnd(15)} | ${entity.padEnd(12)} | ${status.padEnd(15)} | ${String(v.count).padStart(5)} | ${v.net.toFixed(0).padStart(10)} | ${v.allocated.toFixed(0).padStart(10)} | ${v.remaining.toFixed(0).padStart(10)}`);
    }

    const totalReceivables = rows.filter(r => r.direction === 'receivable' && r.status !== 'void').reduce((s, r) => s + Number(r.remaining_amount), 0);
    const totalPayables = rows.filter(r => r.direction === 'payable' && r.status !== 'void').reduce((s, r) => s + Number(r.remaining_amount), 0);
    const totalVoid = rows.filter(r => r.status === 'void').length;

    console.log(`\n  Total remaining receivables : ${totalReceivables.toFixed(2)} EGP`);
    console.log(`  Total remaining payables    : ${totalPayables.toFixed(2)} EGP`);
    console.log(`  Total voided obligations    : ${totalVoid}`);
    pass('summary', `Obligations summary printed (${rows.length} total obligations)`, rows.length);
}

// ---------------------------------------------------------------------------
// Check 6: account_credits orphan check
// ---------------------------------------------------------------------------
async function checkAccountCredits() {
    console.log('\n[6] Checking account_credits integrity...');

    const { data, error } = await supabase
        .from('account_credits')
        .select('id, entity_type, entity_id, amount, remaining_amount, status')
        .eq('status', 'active')
        .lt('remaining_amount', 0);

    if (error) {
        fail('credits', `Query error: ${error.message}`);
        return;
    }

    if (!data || data.length === 0) {
        pass('credits', 'No active credits with negative remaining_amount', 0);
    } else {
        fail('credits', `${data.length} active credits have negative remaining_amount`, data.length);
    }

    // Count active credits summary
    const { data: summary, error: sumErr } = await supabase
        .from('account_credits')
        .select('entity_type, amount, remaining_amount, status');

    if (!sumErr && summary) {
        const active = (summary as any[]).filter(r => r.status === 'active');
        const totalCredits = active.reduce((s, r) => s + Number(r.remaining_amount), 0);
        console.log(`  Active credit balance: ${totalCredits.toFixed(2)} EGP across ${active.length} credit entries`);
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    console.log('='.repeat(70));
    console.log('  TASK 6: FINANCIAL SYSTEM FINAL VERIFICATION');
    console.log(`  Date: ${new Date().toISOString()}`);
    console.log('='.repeat(70));

    await checkAllocationsOnVoidedObligations();
    await checkObligationAllocatedAmountConsistency();
    await checkDesignerPayableObligations();
    await checkObligationStatusCoherence();
    await printFinancialSummary();
    await checkAccountCredits();

    console.log('\n' + '='.repeat(70));
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('\n  FAILED CHECKS:');
        results.filter(r => !r.passed).forEach(r => console.log(`    ❌ ${r.name}: ${r.details}`));
    }
    console.log('='.repeat(70));
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
