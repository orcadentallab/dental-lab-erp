import { createClient } from '@supabase/supabase-js';

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(url, key);

    const { data: suppliers } = await supabase.from('suppliers').select('id, name');
    const allstars = suppliers?.find(s => s.name === 'Allstars');
    if (!allstars) {
        console.log('Allstars not found');
        return;
    }

    // Query allocations directly
    const { data: allocs } = await supabase
        .from('payment_allocations')
        .select('*, financial_obligations!inner(*)')
        .eq('financial_obligations.entity_id', allstars.id);

    console.log(`Total written payment allocations for Allstars: ${allocs?.length}`);
    const allocatedSum = allocs?.reduce((sum, a) => sum + Number(a.allocated_amount || 0), 0) || 0;
    console.log(`Allocated Sum: ${allocatedSum}`);
}

main().catch(console.error);
