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

const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

async function fetchSupabase(endpoint, method = 'GET', body = null) {
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`${supabaseUrl}/rest/v1/${endpoint}`, options);
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Supabase Error [${method} ${endpoint}]: ${response.status} - ${errorText}`);
        return null;
    }
    if (response.status === 204) return null;
    return await response.json();
}

async function debugServices() {
    console.log('--- Services in DB ---');
    const services = await fetchSupabase(`services?select=id,name,selling_price,cost_price`);
    const removables = services.filter(s => s.name.toLowerCase().includes('removable'));
    console.table(removables);

    console.log('\n--- Orders with "Removable" in items ---');
    const orders = await fetchSupabase(`orders?select=id,case_id,items`);
    let found = 0;
    for (const o of orders || []) {
        if (!Array.isArray(o.items)) continue;
        const hasOld = o.items.some(i => i.serviceType && typeof i.serviceType === 'string' && i.serviceType.toLowerCase().includes('removable'));
        if (hasOld) {
            found++;
            console.log(`Order ${o.case_id}:`, JSON.stringify(o.items.filter(i => i.serviceType && typeof i.serviceType === 'string' && i.serviceType.toLowerCase().includes('removable'))));
        }
    }
    console.log(`Found ${found} orders with removable services.`);
}

debugServices();
