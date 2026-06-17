import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseKey = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
    // Find Smart Dental Center
    const { data: docs } = await supabase.from('doctors').select('id,name').ilike('name','%سمارت%');
    console.log('Doctors found:', JSON.stringify(docs?.map(d => ({ id: d.id, name: d.name }))));
    if (!docs?.length) { console.log('Not found!'); return; }
    const id = docs[0].id;
    
    // All orders for this doctor
    const { data: orders } = await supabase
        .from('orders')
        .select('id,case_id,status,total_price,is_archived,delivery_date,actual_delivery_date,created_at,production_status,issue_state')
        .eq('doctor_id', id)
        .order('created_at');
    
    console.log('\nTotal orders:', orders?.length);
    
    let workTotal = 0;
    const statuses = {};
    for (const o of orders || []) {
        const s = o.status || 'unknown';
        statuses[s] = (statuses[s] || 0) + 1;
        
        // isDoctorStatementIncluded logic from Accounts.tsx:
        // Delivered, Completed → billable
        // Rejected, Cancelled → 0
        const billable = ['Delivered','Completed'].includes(s);
        if (billable && !o.is_archived) {
            workTotal += o.total_price || 0;
        }
        if (o.is_archived && ['Delivered','Completed','Rejected','Cancelled'].includes(s)) {
            if (['Delivered','Completed'].includes(s)) workTotal += o.total_price || 0;
        }
    }
    
    console.log('Status breakdown:', JSON.stringify(statuses));
    console.log('Work total (debit):', workTotal);
    
    // Transactions
    const { data: txns } = await supabase
        .from('transactions')
        .select('id,amount,type,date,description,entity_type')
        .eq('entity_id', id);
    
    const paidTotal = (txns || [])
        .filter(t => (t.entity_type === 'doctor' || !t.entity_type) && t.type === 'income')
        .reduce((s, t) => s + (t.amount || 0), 0);
    
    console.log('Transactions count:', txns?.length);
    console.log('Paid total (credit):', paidTotal);
    console.log('Balance (work - paid):', workTotal - paidTotal);
    
    // Adjustments
    const { data: adjs } = await supabase.from('adjustments').select('*').eq('entity_id', id);
    console.log('Adjustments:', JSON.stringify(adjs));
}

main().catch(console.error);
