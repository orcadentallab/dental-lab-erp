import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Manually parse .env
const envFile = fs.readFileSync('.env', 'utf8');
const envConfig = {};
envFile.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        envConfig[key] = val;
    }
});

const supabaseUrl = envConfig.VITE_SUPABASE_URL;
const supabaseKey = envConfig.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('case_id', '1507-080226-001')
        .single();
    
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Order:', {
            id: data.id,
            caseId: data.case_id,
            patientName: data.patient_name,
            status: data.status,
            productionStatus: data.production_status,
            issueState: data.issue_state,
            isArchived: data.is_archived,
            technicianStatus: data.technician_status,
        });
    }
}

run();
