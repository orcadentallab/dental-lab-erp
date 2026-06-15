import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://piuiiwcjnfvjwyewczuz.supabase.co';
const supabaseAnonKey = 'sb_publishable_cDAW5KBvM587xmBArq_nlA_GLoDj7yL';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
    console.log("Fetching orders with TryIn delivery type...");
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, case_id, status, production_status, delivery_type, status_history, updated_at')
        .eq('delivery_type', 'TryIn')
        .order('updated_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${orders.length} orders:`);
    for (const order of orders) {
        console.log(`- Case ID: ${order.case_id}`);
        console.log(`  ID: ${order.id}`);
        console.log(`  Status: ${order.status}`);
        console.log(`  Production Status: ${order.production_status}`);
        console.log(`  Delivery Type: ${order.delivery_type}`);
        console.log(`  Updated At: ${order.updated_at}`);
        console.log(`  History:`, JSON.stringify(order.status_history));
        console.log("----------------------------------------");
    }
}

main();
