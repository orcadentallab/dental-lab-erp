import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Parse .env manually
const envPath = './.env';
const envContent = fs.readFileSync(envPath, 'utf-8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        env[key] = val;
    }
});

const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
    console.log('Parsed env keys:', Object.keys(env));
    process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
    // 1. Find the doctor
    const { data: doctors, error: docErr } = await supabase
        .from('doctors')
        .select('id, name, parent_id, is_center, doctor_code')
        .ilike('name', '%حازم البلتاجى%');

    if (docErr) {
        console.error('Error fetching doctor:', docErr);
        return;
    }

    console.log('Doctors found:', doctors);
    if (!doctors || doctors.length === 0) return;

    const docIds = doctors.map(d => d.id);

    // 2. Fetch all orders for this doctor group
    const { data: orders, error: ordErr } = await supabase
        .from('orders')
        .select('id, case_id, doctor_id, patient_name, total_price, status, delivery_date, actual_delivery_date, created_at, is_archived')
        .in('doctor_id', docIds);

    if (ordErr) {
        console.error('Error fetching orders:', ordErr);
        return;
    }

    console.log(`Orders found: ${orders.length}`);

    // 3. Fetch all transactions for this doctor group
    const { data: txs, error: txErr } = await supabase
        .from('transactions')
        .select('id, type, amount, date, category, description, entity_id, entity_type')
        .in('entity_id', docIds);

    if (txErr) {
        console.error('Error fetching transactions:', txErr);
        return;
    }

    console.log(`Transactions found: ${txs.length}`);

    // Save to a JSON file in scratch for inspection
    fs.writeFileSync(
        './scratch/hazem_data.json',
        JSON.stringify({ doctors, orders, transactions: txs }, null, 2)
    );
    console.log('Saved data to ./scratch/hazem_data.json');
}

main().catch(console.error);
