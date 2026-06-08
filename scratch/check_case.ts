import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
        env[key.trim()] = values.join('=').trim().replace(/['"]/g, '');
    }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- Querying Case 1037-1904-1943 ---');
    const { data: orders, error: orderErr } = await supabase
        .from('orders')
        .select('*')
        .ilike('case_id', '%1037-1904-1943%');
    if (orderErr) throw orderErr;

    if (!orders || orders.length === 0) {
        console.log('No order found with case_id 1037-1904-1943');
        return;
    }

    const order = orders[0];
    console.log('Order Details:', {
        id: order.id,
        case_id: order.case_id,
        patient_name: order.patient_name,
        doctor_id: order.doctor_id,
        supplier_id: order.supplier_id,
        status: order.status,
        cost: order.cost,
        manual_cost: order.manual_cost,
        workflow_type: order.workflow_type,
        designer_id: order.designer_id,
        design_status: order.design_status,
        design_price: order.design_price,
        manual_design_price: order.manual_design_price,
    });

    if (order.designer_id) {
        const { data: user, error: userErr } = await supabase
            .from('users')
            .select('*')
            .eq('id', order.designer_id)
            .single();
        if (userErr) throw userErr;
        console.log('Designer Details:', {
            id: user.id,
            name: user.name,
            role: user.role,
            custom_permissions: user.custom_permissions,
        });
    }

    const { data: obligations, error: obligErr } = await supabase
        .from('financial_obligations')
        .select('*')
        .eq('order_id', order.id);
    if (obligErr) throw obligErr;

    console.log('Financial Obligations:');
    for (const ob of obligations) {
        console.log(`- ID: ${ob.id}, entity_type: ${ob.entity_type}, direction: ${ob.direction}, trigger_type: ${ob.trigger_type}, gross: ${ob.gross_amount}, net: ${ob.net_amount}, status: ${ob.status}`);
    }
}

run().catch(console.error);
