import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseKey = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function main() {
    console.log("Connecting to local Supabase...");
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, case_id, status, production_status, delivery_type, status_history, updated_at')
        .order('updated_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${orders.length} orders in local DB:`);
    for (const order of orders) {
        console.log(`- Case ID: ${order.case_id}`);
        console.log(`  ID: ${order.id}`);
        console.log(`  Status: ${order.status}`);
        console.log(`  Production Status: ${order.production_status}`);
        console.log(`  Delivery Type: ${order.delivery_type}`);
        console.log(`  Updated At: ${order.updated_at}`);
        console.log("----------------------------------------");
    }
}

main();
