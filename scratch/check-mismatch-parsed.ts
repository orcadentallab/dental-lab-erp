import * as fs from 'fs';

const db = JSON.parse(fs.readFileSync('./scratch/parsed_hazem_all.json', 'utf-8'));

console.log('--- ALL ORDERS FOR داليا صديق ---');
db.orders.filter((o: any) => o.patient_name && o.patient_name.includes('داليا صديق')).forEach((o: any) => {
    console.log(`Order ID: ${o.id} | Case ID: ${o.case_id} | Patient: ${o.patient_name} | Price: ${o.total_price} | Status: ${o.status}`);
});

console.log('\n--- ALL ORDERS FOR مهتاب/مهيتاب ---');
db.orders.filter((o: any) => o.patient_name && (o.patient_name.includes('مهتاب') || o.patient_name.includes('مهيتاب'))).forEach((o: any) => {
    console.log(`Order ID: ${o.id} | Case ID: ${o.case_id} | Patient: ${o.patient_name} | Price: ${o.total_price} | Status: ${o.status}`);
});

console.log('\n--- ALL ORDERS FOR فكريه ---');
db.orders.filter((o: any) => o.patient_name && o.patient_name.includes('فكريه')).forEach((o: any) => {
    console.log(`Order ID: ${o.id} | Case ID: ${o.case_id} | Patient: ${o.patient_name} | Price: ${o.total_price} | Status: ${o.status}`);
});
