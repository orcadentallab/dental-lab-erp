import { createClient } from '@supabase/supabase-js';

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(url, key);

    const { count, error } = await supabase
        .from('payment_allocations')
        .select('*', { count: 'exact', head: true });

    console.log(`Payment allocations count: ${count}`);
    if (error) console.error(error);
}

main().catch(console.error);
