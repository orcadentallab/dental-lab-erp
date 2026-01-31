
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function main() {
    // Read .env manually
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
        console.error('Could not find Supabase credentials');
        process.exit(1);
    }

    console.log('Connecting to Supabase...');
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Searching for transactions with amount 402000...');
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('amount', 402000)
        .eq('type', 'expense');

    if (error) {
        console.error('Error fetching transactions:', error.message);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No transactions found with amount 402000 and type expense.');

        // Let's try to look for multiple transactions that sum up to 402000? 
        // Or maybe it's just one. The image shows "إجمالي المصروفات 402000".
        // If there are other expenses, I should be careful.
        return;
    }

    console.log(`Found ${data.length} transaction(s):`);
    data.forEach(tx => {
        console.log(`${tx.id}: ${tx.amount} - ${tx.description} (Category: ${tx.category})`);
    });

    console.log('Deleting these transactions...');
    const ids = data.map(tx => tx.id);
    const { error: delError } = await supabase
        .from('transactions')
        .delete()
        .in('id', ids);

    if (delError) {
        console.error('Error deleting transactions:', delError.message);
    } else {
        console.log('Success! Erroneous transactions removed.');
    }
}

main();
