
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

    console.log('Deleting all orders...');
    // Delete all rows where id is not null (effectively all)
    const { error, count } = await supabase
        .from('orders')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('Success! All orders deleted.');
    }
}

main();
