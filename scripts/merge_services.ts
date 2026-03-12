import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function mergeServices() {
    console.log('Starting merge process...');

    // 1. Get services
    const { data: services, error: servicesErr } = await supabase
        .from('services')
        .select('*')
        .in('name', ['Removable', 'Removable Partial by tooth']);

    if (servicesErr) {
        console.error('Error fetching services:', servicesErr);
        return;
    }

    console.log('Found services:', services.map(s => s.name));

    const targetService = services.find(s => s.name === 'Removable');
    const oldService = services.find(s => s.name === 'Removable Partial by tooth');

    if (!targetService) {
        console.log('Could not find Removable service to merge into. We need to create it or rename the existing one.');
        if (oldService) {
            console.log('Wait, maybe there is only one of them? I see:', services.map(s => s.name));
            // If only oldService exists, just rename it
            const { error: renameErr } = await supabase
                .from('services')
                .update({ name: 'Removable' })
                .eq('id', oldService.id);
            if (renameErr) console.error('Rename error:', renameErr);
            console.log('Renamed old service to Removable instead of full merge.');
            console.log('Done.');
            return;
        }
        return;
    }

    if (!oldService) {
        console.log('Did not find Removable Partial by tooth service to remove. Already merged?');
        return;
    }

    console.log(`Merging ${oldService.name} into ${targetService.name}...`);

    // 2. Update order_items
    const { data: updatedItems, error: itemsError } = await supabase
        .from('order_items')
        .update({ product_type: targetService.name })
        .eq('product_type', oldService.name)
        .select('id, order_id');

    if (itemsError) {
        console.error('Failed to update order_items:', itemsError);
        return;
    }
    console.log(`Updated ${updatedItems?.length || 0} order_items`);

    // 3. Update orders JSONB items
    // Since we can't easily do deep JSONB replace with PostgREST patch, 
    // we'll fetch orders that contain the old service name in their JSON, update locally, and patch back.

    // Fetch orders where items JSON array contains an object with serviceType = oldService.name
    console.log('Fetching orders with legacy JSONB arrays...');
    const { data: ordersWithOldService, error: ordersError } = await supabase
        .from('orders')
        .select('id, items');

    if (ordersError) {
        console.error('Error fetching orders:', ordersError);
        return;
    }

    let updatedOrdersCount = 0;
    for (const order of ordersWithOldService || []) {
        if (!Array.isArray(order.items)) continue;

        let needsUpdate = false;
        const newItems = order.items.map((item: Record<string, unknown> & { serviceType?: string }) => {
            if (item.serviceType === oldService.name || item.serviceType?.includes('Removable Partial by tooth')) {
                needsUpdate = true;
                return { ...item, serviceType: targetService.name };
            }
            return item;
        });

        if (needsUpdate) {
            const { error: updateErr } = await supabase
                .from('orders')
                .update({ items: newItems })
                .eq('id', order.id);

            if (updateErr) {
                console.error(`Failed to update order JSONB items for order ${order.id}:`, updateErr);
            } else {
                updatedOrdersCount++;
            }
        }
    }

    console.log(`Updated items JSONB for ${updatedOrdersCount} orders.`);

    // 4. Delete the old service
    const { error: deleteError } = await supabase
        .from('services')
        .delete()
        .eq('id', oldService.id);

    if (deleteError) {
        console.error('Failed to delete old service map', deleteError);
    } else {
        console.log('Successfully deleted duplicate service from DB.');
    }

    console.log('Process completed successfully.');
}

mergeServices().catch(console.error);
