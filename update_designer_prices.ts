import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
        env[key.trim()] = values.join('=').trim().replace(/['"]/g, '');
    }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // 1. Get designers
    const { data: users, error: usersError } = await supabase.from('users').select('*').eq('role', 'designer');
    if (usersError) throw usersError;
    
    console.log('Designers:');
    for (const u of users) {
        console.log(`- ${u.name} (ID: ${u.id}), unit_rate: ${u.unit_rate}`);
    }

    // Find the one who probably had 60 and changed to 50
    const targetDesigner = users.find(u => u.unit_rate === 50 || u.unit_rate === 60 || u.name.includes('مصمم'));
    if (!targetDesigner) {
        console.log('No specific designer found with rate 50 or 60.');
        return;
    }
    
    console.log(`\nTarget Designer: ${targetDesigner.name} (ID: ${targetDesigner.id})`);

    // Fetch their orders
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, design_price, items, order_items(price, teeth_numbers)')
        .eq('designer_id', targetDesigner.id);

    if (ordersError) throw ordersError;

    let updateCount = 0;

    for (const order of orders) {
        // Calculate units
        let units = 0;
        if (order.order_items && order.order_items.length > 0) {
            units = order.order_items.reduce((sum, item) => sum + (item.teeth_numbers ? item.teeth_numbers.length : 0), 0);
        } else if (order.items && Array.isArray(order.items)) {
            units = order.items.reduce((sum, item) => sum + (item.teethNumbers ? item.teethNumbers.length : 0), 0);
        }

        if (units === 0) continue;

        // The current price should be units * 60
        // We want to change it to units * 50
        const currentCalculatedPrice = units * 60;
        const newCalculatedPrice = units * 50;

        if (order.design_price === currentCalculatedPrice) {
            console.log(`Updating Order ${order.id}: Units = ${units}, Old Price = ${order.design_price}, New Price = ${newCalculatedPrice}`);
            const { error: updateError } = await supabase
                .from('orders')
                .update({ design_price: newCalculatedPrice })
                .eq('id', order.id);

            if (updateError) {
                console.error(`Failed to update Order ${order.id}:`, updateError);
            } else {
                updateCount++;
            }
        } else if (order.design_price === newCalculatedPrice) {
            console.log(`Order ${order.id} is already updated (Price = ${order.design_price})`);
        } else {
            console.log(`Order ${order.id} has manual or different price: Units = ${units}, Price = ${order.design_price}. Skipping.`);
        }
    }

    console.log(`\nMigration completed. Updated ${updateCount} orders.`);
}

run().catch(console.error);
