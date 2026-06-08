import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const url = 'http://127.0.0.1:54321';
const key = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

const supabase = createClient(url, key);

async function run() {
    // 1. Find user Hosny
    const { data: users, error: usersError } = await supabase.from('users').select('*');
    if (usersError) {
        console.error('Error fetching users:', usersError);
        return;
    }
    const hosny = users.find(u => u.name && (u.name.toLowerCase().includes('hosny') || u.name.includes('حسني') || u.name.includes('حسنى')));
    if (!hosny) {
        console.log('Hosny not found in users. Available users:', users.map(u => u.name));
        return;
    }
    console.log('Found Hosny:', JSON.stringify(hosny, null, 2));

    // 2. Find billing settings
    const { data: settings, error } = await supabase
        .from('entity_billing_settings')
        .select('*')
        .eq('entity_id', hosny.id)
        .eq('entity_type', 'designer');
        
    console.log('Billing settings for Hosny:', JSON.stringify(settings, null, 2));
    if (error) {
        console.error('Error fetching settings:', error);
    }
}

run().catch(console.error);
