import { createClient } from '@supabase/supabase-js';

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(url, key);

    const { data: suppliers } = await supabase.from('suppliers').select('*');
    console.log('Suppliers:', JSON.stringify(suppliers, null, 2));
}

main().catch(console.error);
