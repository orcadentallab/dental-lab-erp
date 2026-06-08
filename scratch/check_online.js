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
    const { data, error } = await supabase
        .from('entity_billing_settings')
        .select('*')
        .eq('entity_type', 'designer');
        
    console.log('Online entity_billing_settings:', JSON.stringify(data, null, 2));
    if (error) {
        console.error('Error fetching online settings:', error);
    }
}

run().catch(console.error);
