import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');

const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length > 0) {
        env[key.trim()] = rest.join('=').trim();
    }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

async function fetchSupabase(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers,
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const response = await fetch(`${supabaseUrl}/rest/v1/${endpoint}`, options);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase Error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    if (response.status === 204) return null;
    return await response.json();
}

async function mergeServices() {
    console.log('Starting merge process...');

    // 1. Get services
    const query = `select=*&name=in.("Removable","Removable Partial by tooth")`;
    const services = await fetchSupabase(`services?${query}`);

    console.log('Found services:', services.map(s => s.name));

    const targetService = services.find(s => s.name === 'Removable');
    const oldService = services.find(s => s.name === 'Removable Partial by tooth');

    if (!targetService) {
        console.log('Could not find Removable service to merge into. Rename if only 1 exists.');
        if (oldService) {
            const res = await fetchSupabase(`services?id=eq.${oldService.id}`, 'PATCH', { name: 'Removable' });
            console.log('Renamed old service to Removable instead of full merge.');
        }
        return;
    }

    if (!oldService) {
        console.log('Did not find "Removable Partial by tooth" service to remove. Already merged?');
        return;
    }

    console.log(`Merging "${oldService.name}" into "${targetService.name}"...`);

    // 2. Update order_items
    const updateEndpoint = `order_items?product_type=eq.${encodeURIComponent(oldService.name)}`;
    const updatedItems = await fetchSupabase(updateEndpoint, 'PATCH', { product_type: targetService.name });
    console.log(`Updated ${updatedItems?.length || 0} order_items`);

    // 3. Update orders JSONB items
    console.log('Fetching orders with legacy JSONB arrays...');
    const orders = await fetchSupabase(`orders?select=id,items`);

    let updatedOrdersCount = 0;
    for (const order of orders || []) {
        if (!Array.isArray(order.items)) continue;

        let needsUpdate = false;
        const newItems = order.items.map((item) => {
            if (item.serviceType === oldService.name || (item.serviceType && item.serviceType.includes('Removable Partial by tooth'))) {
                needsUpdate = true;
                return { ...item, serviceType: targetService.name };
            }
            return item;
        });

        if (needsUpdate) {
            await fetchSupabase(`orders?id=eq.${order.id}`, 'PATCH', { items: newItems });
            updatedOrdersCount++;
        }
    }

    console.log(`Updated items JSONB for ${updatedOrdersCount} orders.`);

    // 4. Delete the old service
    await fetchSupabase(`services?id=eq.${oldService.id}`, 'DELETE');
    console.log('Successfully deleted duplicate service from DB.');
    console.log('Process completed successfully.');
}

mergeServices().catch(console.error);
