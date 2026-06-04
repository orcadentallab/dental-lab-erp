import { createClient } from '@supabase/supabase-js';

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(url, key);

    const { data: suppliers } = await supabase.from('suppliers').select('id, name');
    const allstars = suppliers?.find(s => s.name === 'Allstars');
    if (!allstars) return;

    // Fetch active (non-void) obligations
    const { data: activeObligs } = await supabase
        .from('financial_obligations')
        .select('*')
        .eq('entity_id', allstars.id)
        .eq('entity_type', 'external_lab')
        .neq('status', 'void');

    console.log(`Active obligations count: ${activeObligs?.length}`);
    const activeNet = activeObligs?.reduce((sum, o) => sum + Number(o.net_amount || 0), 0) || 0;
    const activeAlloc = activeObligs?.reduce((sum, o) => sum + Number(o.allocated_amount || 0), 0) || 0;
    console.log(`Active Net: ${activeNet}, Active Allocated: ${activeAlloc}`);
    console.log(`Active Obligations Balance: ${activeNet - activeAlloc}`);

    // Fetch transactions
    const { data: txs } = await supabase
        .from('transactions')
        .select('*')
        .eq('entity_id', allstars.id)
        .eq('type', 'expense');

    console.log(`Transactions count: ${txs?.length}`);
    const txSum = txs?.reduce((sum, t) => sum + Number(t.amount || 0), 0) || 0;
    console.log(`Transactions Sum: ${txSum}`);
}

main().catch(console.error);
