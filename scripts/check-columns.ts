import { createClient } from '@supabase/supabase-js';

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(url, key);

    const { data: ordersCols, error: err1 } = await supabase.rpc('pg_get_cols', { table_name: 'orders' }).select();
    
    // Alternative: Query information_schema.columns directly
    const { data: cols, error: err2 } = await supabase
        .from('pg_namespace') // We can't query info_schema via PostgREST unless exposed, but we can do RPC or direct SQL
        .select('*')
        .limit(1);

    // Let's use a simple query that is safe
    const { data: columns, error: err3 } = await supabase.rpc('execute_sql', {
        query_text: `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name IN ('orders', 'doctors');
        `
    });

    if (err3) {
        console.error('Error fetching columns:', err3);
    } else {
        console.log('Columns in DB:', columns);
    }
}

main().catch(console.error);
