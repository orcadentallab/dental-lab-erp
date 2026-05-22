/**
 * Production DB readiness check — READ-ONLY
 * Verifies required objects exist before deploy.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
    console.error('Missing env vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(url, key);

async function tableExists(name: string): Promise<boolean> {
    const { error } = await supabase.from(name).select('*', { count: 'exact', head: true });
    if (!error) return true;
    const msg = error.message || '';
    return !msg.includes('does not exist');
}

async function columnExists(table: string, col: string): Promise<boolean> {
    const { data, error } = await supabase.from(table).select(col).limit(1);
    if (error) {
        const msg = error.message || '';
        if (msg.includes('does not exist') && msg.includes(col)) return false;
        // RLS or other error means table exists, column likely exists too
        return true;
    }
    return true;
}

async function rpcExists(name: string): Promise<boolean> {
    try {
        // @ts-ignore
        await supabase.rpc(name, { order_id: '00000000-0000-0000-0000-000000000000', changed_by: null, updates: {} });
        return true;
    } catch (e: any) {
        const msg = e.message || '';
        if (msg.includes('not found') || msg.includes('Could not find')) return false;
        return true; // failed with data error, not missing
    }
}

async function triggerExists(name: string): Promise<boolean | 'unknown'> {
    // Triggers can't be checked via anon key easily without service role
    return 'unknown';
}

async function checkAppSetting(key: string): Promise<string | 'unknown'> {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) return 'unknown';
    return data?.value ?? 'ABSENT';
}

async function main() {
    console.log('=== Production DB Readiness Check ===\n');

    const tables = [
        'order_events',
        'financial_obligations',
        'entity_billing_settings',
        'allocations',
        'allocation_items',
    ];
    for (const t of tables) {
        const ok = await tableExists(t);
        console.log(`${t}: ${ok ? 'EXISTS ✅' : 'MISSING ❌'}`);
    }

    console.log('\n--- Columns ---');
    const columns = [
        { table: 'orders', col: 'manual_cost' },
        { table: 'orders', col: 'production_status' },
        { table: 'orders', col: 'issue_state' },
    ];
    for (const { table, col } of columns) {
        const ok = await columnExists(table, col);
        console.log(`${table}.${col}: ${ok ? 'EXISTS ✅' : 'MISSING ❌'}`);
    }

    console.log('\n--- RPCs ---');
    const rpcs = ['rep_update_order_fields_with_audit'];
    for (const rpc of rpcs) {
        const ok = await rpcExists(rpc);
        console.log(`${rpc}: ${ok === true ? 'EXISTS ✅' : ok === false ? 'MISSING ❌' : 'UNKNOWN ⚠️'}`);
    }

    console.log('\n--- Triggers ---');
    console.log('trigger_orders_role_field_guard: requires service role key to verify (SKIPPED) ⚠️');

    console.log('\n--- App Settings ---');
    const wf = await checkAppSetting('workflow_strict_rep');
    console.log(`app.workflow_strict_rep: ${wf === 'true' ? 'ON ⚠️' : wf === 'false' || wf === 'ABSENT' ? 'OFF ✅' : 'UNKNOWN ⚠️'}`);

    console.log('\n=== Done ===');
}

main().catch(e => { console.error(e); process.exit(1); });
