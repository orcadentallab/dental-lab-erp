import { createClient } from '@supabase/supabase-js';

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(url, key);

    const { data, error } = await supabase
        .from('payment_allocations')
        .select('*')
        .limit(5);

    if (error) {
        console.error(error);
        return;
    }

    console.log('Sample Allocations:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
