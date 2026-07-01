import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://piuiiwcjnfvjwyewczuz.supabase.co';
const supabaseAnonKey = 'sb_publishable_cDAW5KBvM587xmBArq_nlA_GLoDj7yL';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkArchived() {
    try {
        console.log('Querying remote Supabase...');
        const { data, error, count } = await supabase
            .from('orders')
            .select('id, case_id, status, is_archived, created_at', { count: 'exact' })
            .eq('is_archived', true);

        if (error) {
            console.error('Error fetching archived orders:', error);
            return;
        }

        console.log(`Found ${count} archived orders on remote database:`);
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

checkArchived();
