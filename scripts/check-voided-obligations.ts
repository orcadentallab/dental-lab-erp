import { createClient } from '@supabase/supabase-js';

const TARGETED_CLEANUP_IDS = [
    '7470c5b1-f4da-4e77-ac1d-b2c8e144ae2c',
    'bea42b39-7085-43c0-a6e6-d0fbd2a3c516',
    '6f7dff6e-5ef2-4784-898d-e8afaabc158a',
    '11247e0e-e226-449e-954f-9dff999dabdb',
    '3bee6d3b-d906-45c8-866b-4dde35d638b6',
    'f84d605e-92f4-4977-898b-580d1137692f',
    'a659d0cf-582b-4f64-b43e-66d8507134a4',
    'f7a4f80e-24f1-4d1a-b351-22b81272dd72',
    '91bd642c-8bc7-4a93-aeb2-4b423a084c19',
    'a2a6a542-0cbf-4801-a17b-a6dc28ba8d60',
    'c2c2664f-49ae-4614-96ca-f48a2a33f523',
    'c99dbae6-db37-4a32-afb2-dda899c97341',
    '0d002fac-332f-43e6-8a29-a2ef357ddb67',
    '483dde11-7f0f-4ae7-b0c1-9aba10b9dba6',
    '15ce5e59-3183-44aa-97dd-9ca88a2ac989',
];

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(url, key);

    const { data, error } = await supabase
        .from('financial_obligations')
        .select('id, status, net_amount, entity_type')
        .in('id', TARGETED_CLEANUP_IDS);

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Found ${data?.length || 0} cleanup candidates in DB:`);
    for (const r of data || []) {
        console.log(`- ID: ${r.id} | Status: ${r.status} | Net Amount: ${r.net_amount} | Entity: ${r.entity_type}`);
    }
}

main().catch(console.error);
