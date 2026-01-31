
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function main() {
    const envPath = path.resolve(__dirname, '../.env');
    let supabaseUrl = '';
    let supabaseKey = '';

    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                if (key === 'VITE_SUPABASE_URL') supabaseUrl = value;
                if (key === 'VITE_SUPABASE_ANON_KEY') supabaseKey = value;
            }
        });
    }

    if (!supabaseUrl || !supabaseKey) {
        console.error('Could find Supabase credentials');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Listing recent expenses (Batch analysis)...');
    // Using select with count to get an overview
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('type', 'expense')
        .order('date', { ascending: false })
        .limit(100);

    if (error) {
        // We expect permission error if anon key isn't allowed to select all.
        // But in the user's environment, maybe it works if RLS is off or if they provide a service key.
        // User's previous run showed "permission denied".
        console.error('Error fetching transactions:', error.message);
        return;
    }

    const groups = {};
    data.forEach(tx => {
        const key = `${tx.date}_${tx.category}`;
        if (!groups[key]) groups[key] = { count: 0, total: 0, ids: [] };
        groups[key].count++;
        groups[key].total += tx.amount;
        groups[key].ids.push(tx.id);
    });

    console.log('--- Expense Batches Found (Recent) ---');
    Object.entries(groups).forEach(([key, info]) => {
        console.log(`${key}: Count: ${info.count}, Total: ${info.total}`);
    });
}

main();
