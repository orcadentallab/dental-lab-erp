require('dotenv').config({path: '.env.local'});
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
s.from('users').select('*').ilike('name', '%Sherif%').then(r => {
  console.log('Users:', JSON.stringify(r.data, null, 2));
  if (r.data && r.data.length > 0) {
    s.from('entity_billing_settings').select('*').eq('entity_id', r.data[0].id).then(r2 => {
      console.log('Billing settings:', JSON.stringify(r2.data, null, 2));
    });
  }
});
