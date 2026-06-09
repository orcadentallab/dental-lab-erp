import * as fs from 'fs';

const db = JSON.parse(fs.readFileSync('./scratch/parsed_hazem_all.json', 'utf-8'));

console.log('--- ALL TARGET ORDERS IN DATABASE ---');
const sorted = db.orders.sort((a: any, b: any) => new Date(a.delivery_date || a.created_at).getTime() - new Date(b.delivery_date || b.created_at).getTime());
sorted.forEach((o: any) => {
    console.log(`CaseID: ${o.case_id} | Patient: ${o.patient_name} | Price: ${o.total_price} | Status: ${o.status} | Date: ${o.delivery_date}`);
});
