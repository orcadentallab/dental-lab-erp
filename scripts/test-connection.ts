import { createClient } from '@supabase/supabase-js';

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    
    console.log(`URL: ${url}`);
    console.log(`Key Length: ${key.length}`);

    const supabase = createClient(url, key);

    const tables = ['doctors', 'suppliers', 'orders', 'transactions', 'financial_obligations', 'payment_allocations'];

    for (const table of tables) {
        const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error(`Error querying ${table}:`, error.message, error.details);
        } else {
            console.log(`Table ${table} count: ${count}`);
        }
    }
}

main().catch(console.error);
