import fs from 'fs';

// Read .env manually
const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    env[key] = val;
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL || 'https://piuiiwcjnfvjwyewczuz.supabase.co';
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('Missing Supabase Key!');
  process.exit(1);
}

async function run() {
  try {
    console.log('Sending direct HTTP count request to PostgREST...');
    
    // PostgREST count query uses HEAD method, or GET with Prefer: count=exact and Range: 0-0
    const url = `${supabaseUrl}/rest/v1/orders?select=id`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'count=exact',
        'Range': '0-0'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`HTTP Error ${response.status}: ${errText}`);
      return;
    }

    // Content-Range header has format: "0-0/COUNT"
    const contentRange = response.headers.get('content-range');
    const totalCount = contentRange ? contentRange.split('/')[1] : null;

    // Do same for transactions
    const txUrl = `${supabaseUrl}/rest/v1/transactions?select=id`;
    const txResponse = await fetch(txUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'count=exact',
        'Range': '0-0'
      }
    });

    const txContentRange = txResponse.headers.get('content-range');
    const txTotalCount = txContentRange ? txContentRange.split('/')[1] : null;

    console.log('\n--- DATABASE COUNT EVIDENCE ---');
    console.log(`Total Orders Count (Content-Range):       ${totalCount}`);
    console.log(`Total Transactions Count (Content-Range): ${txTotalCount}`);
    console.log('--------------------------------');
  } catch (error) {
    console.error('Error running fetch count query:', error);
  }
}

run();
