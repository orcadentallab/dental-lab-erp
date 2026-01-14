
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Read .env manually
const envPath = path.resolve(__dirname, '../.env');
let supabaseUrl = '';
let supabaseKey = '';

if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            if (key.trim() === 'VITE_SUPABASE_URL') supabaseUrl = value.trim();
            if (key.trim() === 'VITE_SUPABASE_ANON_KEY') supabaseKey = value.trim();
        }
    });
}
// Fallback or explicit check
if (!supabaseUrl || !supabaseKey) {
    console.error('Could not find Supabase credentials in .env');
    process.exit(1);
}

console.log('Credentials found. URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearOrders() {
    console.log('Start clearing orders...');
    const { error } = await supabase
        .from('orders')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all not equal to zero uuid

    if (error) {
        console.error('Error deleting orders:', error);
    } else {
        console.log(`Successfully deleted orders.`);
    }
}

clearOrders();
