import * as fs from 'fs';
import * as path from 'path';

const dataPath = './scratch/hazem_data.json';
if (!fs.existsSync(dataPath)) {
    console.error(`File does not exist: ${dataPath}`);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
console.log(`Doctors count: ${data.doctors.length}`);
console.log(`Orders count: ${data.orders.length}`);
console.log(`Transactions count: ${data.transactions.length}`);

// Print all transactions
console.log('\n--- TRANSACTIONS ---');
data.transactions.forEach((t: any) => {
    console.log(`${t.date.split('T')[0]} | ${t.type} | ${t.amount} | ${t.description}`);
});

// Let's summarize orders
console.log('\n--- ORDERS (First 20 and last 20) ---');
const sortedOrders = data.orders.sort((a: any, b: any) => new Date(a.delivery_date || a.created_at).getTime() - new Date(b.delivery_date || b.created_at).getTime());
console.log(`Total sorted orders: ${sortedOrders.length}`);

console.log('OLDEST 10 ORDERS:');
sortedOrders.slice(0, 10).forEach((o: any) => {
    console.log(`${o.case_id} | ${o.patient_name} | ${o.total_price} | ${o.status} | Delivery: ${o.delivery_date} | Created: ${o.created_at}`);
});

console.log('\nNEWEST 25 ORDERS:');
sortedOrders.slice(-25).forEach((o: any) => {
    console.log(`${o.case_id} | ${o.patient_name} | ${o.total_price} | ${o.status} | Delivery: ${o.delivery_date} | Created: ${o.created_at}`);
});

// Find duplicated or changed price cases
console.log('\n--- SEARCHING FOR "منه الله" (Menna Allah) ---');
const menna = sortedOrders.filter((o: any) => o.patient_name && o.patient_name.includes('منه'));
menna.forEach((o: any) => {
    console.log(`${o.case_id} | ${o.patient_name} | ${o.total_price} | ${o.status} | Delivery: ${o.delivery_date} | Created: ${o.created_at}`);
});
