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

async function findUnlinkedServices() {
    console.log('Fetching active services...');
    const activeServices = await fetchSupabase(`services?select=name`);
    const activeServiceNames = new Set((activeServices || []).map(s => s.name));

    console.log(`Found ${activeServiceNames.size} active services.\n`);

    console.log('Scanning historical orders for old service names...');
    const orders = await fetchSupabase(`orders?select=id,items`);

    const historicalNames = new Set();
    for (const order of orders || []) {
        if (!Array.isArray(order.items)) continue;
        for (const item of order.items) {
            if (item.serviceType && typeof item.serviceType === 'string') {
                historicalNames.add(item.serviceType);
            }
        }
    }

    console.log('Scanning supplier custom prices for old service names...');
    const suppliers = await fetchSupabase(`suppliers?select=id,custom_prices,milling_prices`);
    for (const supplier of suppliers || []) {
        if (supplier.custom_prices && typeof supplier.custom_prices === 'object') {
            Object.keys(supplier.custom_prices).forEach(k => historicalNames.add(k));
        }
        if (supplier.milling_prices && typeof supplier.milling_prices === 'object') {
            Object.keys(supplier.milling_prices).forEach(k => historicalNames.add(k));
        }
    }

    const unlinkedNames = [];
    for (const name of historicalNames) {
        if (!activeServiceNames.has(name)) {
            unlinkedNames.push(name);
        }
    }

    console.log('\n=======================================');
    console.log('🚨 DISCONNECTED OLD SERVICES FOUND 🚨');
    console.log('=======================================');
    if (unlinkedNames.length === 0) {
        console.log('All historical names are perfectly matched! No action needed.');
    } else {
        unlinkedNames.forEach((name, i) => console.log(`${i + 1}. "${name}"`));
        console.log('\nThese names exist in orders/prices but NOT in the active services list.');
    }
}

findUnlinkedServices();
