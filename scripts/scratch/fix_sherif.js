import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = readFileSync('.env', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
});

const supabase = createClient(env['VITE_SUPABASE_URL'], env['VITE_SUPABASE_ANON_KEY']);

async function run() {
    const { data: users } = await supabase.from('users').select('*');
    const sherif = users.find(u => u.name && (u.name.includes('Sherif') || u.name.includes('شريف')));
    if (!sherif) return console.log('Sherif not found');
    console.log('Found Sherif:', sherif.id);
    
    const { data: services } = await supabase.from('services').select('*');
    const { data: orders } = await supabase.from('orders').select('*').eq('designer_id', sherif.id).eq('workflow_type', 'split');
    console.log('Found orders:', orders?.length);
    
    let count = 0;
    for (const o of orders || []) {
        if (o.design_price === 0 || o.design_price == null) {
            let price = 0;
            for (const item of o.items || []) {
                const svc = services.find(s => s.name === item.serviceType);
                const unitCost = sherif.designerServicePrices?.[item.serviceType] ?? svc?.designerPrice ?? 0;
                const teethCount = item.teethNumbers ? (Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1) : 0;
                price += teethCount * unitCost;
            }
            if (price > 0) {
                console.log('Updating order', o.id, 'from 0 to', price);
                await supabase.from('orders').update({ design_price: price }).eq('id', o.id);
                count++;
            }
        }
    }
    console.log('Fixed', count, 'orders');
}

run();
