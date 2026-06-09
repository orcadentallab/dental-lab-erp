import * as fs from 'fs';

const statement1 = [
    { caseId: 'CASE-1770402907834-56', patient: 'وجيهه عبد الله', date: '2026-02-06', price: 750 },
    { caseId: 'CASE-1770402907833-24', patient: 'ندي محمد', date: '2026-02-06', price: 750 },
    { caseId: 'CASE-1770402907831-3', patient: 'نازله', date: '2026-02-06', price: 750 },
    { caseId: '1019-100226-002', patient: 'محمد حامد', date: '2026-02-12', price: 750 },
    { caseId: '1019-100226-001', patient: 'احمد صالح', date: '2026-02-12', price: 1500 },
    { caseId: '1019-150226-001', patient: 'محمد سند', date: '2026-02-18', price: 750 },
    { caseId: '1019-2502-2036', patient: 'سعاد', date: '2026-02-28', price: 2250 },
    { caseId: '1019-2502-1336', patient: 'شيماء محمد', date: '2026-02-28', price: 750 },
    { caseId: '1019-2602-2029', patient: 'احمد نبيل', date: '2026-03-01', price: 750 },
    { caseId: '1019-2602-1208', patient: 'داليا صديق', date: '2026-03-01', price: 750 },
    { caseId: '1019-2602-1206', patient: 'محمد ابراهيم', date: '2026-03-01', price: 750 },
    { caseId: '1019-2602-1147', patient: 'محمد حمادة', date: '2026-03-01', price: 750 },
    { caseId: '1019-1715-2802-1019', patient: 'ايمان', date: '2026-03-03', price: 1500 },
    { caseId: '1019-1713-2802-1019', patient: 'عبد العاطى', date: '2026-03-03', price: 750 },
    { caseId: '1019-1712-2802-1019', patient: 'جورج صامويل', date: '2026-03-03', price: 750 },
    { caseId: '1019-0103-1352', patient: 'نعمة يوسف', date: '2026-03-04', price: 1000 },
    { caseId: '1019-0403-1435', patient: 'محمد مصطفى', date: '2026-03-07', price: 900 },
    { caseId: '1019-0703-1543', patient: 'وائل', date: '2026-03-08', price: 900 },
    { caseId: '1019-0703-1540', patient: 'داليا', date: '2026-03-08', price: 750 },
    { caseId: '1019-1203-1436', patient: 'ريهام أحمد', date: '2026-03-15', price: 1500 },
    { caseId: '1019-1203-1316', patient: 'نور عزت', date: '2026-03-15', price: 750 },
    { caseId: '1019-1203-1314', patient: 'عمر', date: '2026-03-15', price: 750 },
    { caseId: '1019-1850-1403-1019', patient: 'احمد عمرو نصار', date: '2026-03-17', price: 750 },
    { caseId: '1019-2126-1603-1019', patient: 'حازم فاروق', date: '2026-03-19', price: 750 },
    { caseId: '1019-1351-1803-1019', patient: 'حازم عبد القادر', date: '2026-03-23', price: 750 },
    { caseId: '1019-1349-1803-1019', patient: 'سهير أحمد', date: '2026-03-23', price: 750 },
    { caseId: '1019-2015-2303-1019', patient: 'ياسمين', date: '2026-03-26', price: 2000 },
    { caseId: '1019-1604-2303-1019', patient: 'هدى', date: '2026-03-26', price: 750 },
    { caseId: '1019-1355-2503-1019', patient: 'محمد كريم', date: '2026-03-28', price: 750 },
    { caseId: '1019-1404-2503-1019', patient: 'عبد الرحمن وائل', date: '2026-03-30', price: 750 },
    { caseId: '1019-1359-2503-1019', patient: 'وائل سعيد', date: '2026-03-30', price: 750 },
    { caseId: '1019-1357-2503-1019', patient: 'شريف يحيى', date: '2026-03-30', price: 750 },
    { caseId: '1019-2216-2403-1019', patient: 'ليلى', date: '2026-03-30', price: 1500 },
    { caseId: '1019-2136-2603-1019', patient: 'مرينا', date: '2026-03-31', price: 750 },
    { caseId: '1019-1948-2503-1019', patient: 'حنين أحمد', date: '2026-03-31', price: 750 },
    { caseId: '1019-2043-2803-1019', patient: 'منه الله', date: '2026-04-01', price: 750 }
];

const statement2 = [
    { caseId: '1019-2043-2803-1019', patient: 'منه الله', date: '2026-04-01', price: 750 },
    { caseId: '1019-1211-3103-1019', patient: 'بسمه', date: '2026-04-03', price: 900 },
    { caseId: '1019-1448-3103-1019', patient: 'محمد العادل', date: '2026-04-04', price: 725 },
    { caseId: '1019-1350-0104-1019', patient: 'محمد محمد', date: '2026-04-05', price: 725 },
    { caseId: '1019-2111-0104-1019', patient: 'محمد حسام', date: '2026-04-06', price: 725 },
    { caseId: '1019-2058-0104-1019', patient: 'الاء عاطف', date: '2026-04-06', price: 725 },
    { caseId: '1019-2056-0104-1019', patient: 'عصام بدوى', date: '2026-04-06', price: 1450 },
    { caseId: '1019-2149-3103-1019', patient: 'سامح ممدوح', date: '2026-04-06', price: 725 },
    { caseId: '1019-2147-3103-1019', patient: 'نانسي سمير', date: '2026-04-06', price: 1450 },
    { caseId: '1019-1732-0404-1019', patient: 'فاطمه محمد', date: '2026-04-07', price: 900 },
    { caseId: '1019-1156-0404-1019', patient: 'ساندرا اشرف', date: '2026-04-07', price: 725 },
    { caseId: '1019-1354-0804-1019', patient: 'السيد شاكر', date: '2026-04-11', price: 725 },
    { caseId: '1019-1307-1004-1019', patient: 'شرين يسرى', date: '2026-04-13', price: 900 },
    { caseId: '1019-1841-0904-1019', patient: 'مى سيد', date: '2026-04-13', price: 2175 },
    { caseId: '1019-2124-1504-1019', patient: 'داليا امين', date: '2026-04-14', price: 0 },
    
    // Payment at 15/04/2026: 33,300 (credits)
    
    { caseId: '1019-1311-1304-1019', patient: 'ليلى طلعت', date: '2026-04-16', price: 1450 },
    { caseId: '1019-1503-1504-1019', patient: 'داليا عمار', date: '2026-04-18', price: 725 },
    { caseId: '1019-1501-1504-1019', patient: 'نوريهان محمد', date: '2026-04-18', price: 725 },
    { caseId: '1019-1458-1504-1019', patient: 'ساميه', date: '2026-04-18', price: 725 },
    { caseId: '1019-1454-1504-1019', patient: 'ريم عباس', date: '2026-04-18', price: 725 },
    { caseId: '1019-1453-1504-1019', patient: 'محمد عبد العزيز', date: '2026-04-18', price: 725 },
    { caseId: '1019-1555-1804-1019', patient: 'محمد على', date: '2026-04-21', price: 725 },
    { caseId: '1019-2127-1504-1019', patient: 'داليا امين', date: '2026-04-21', price: 725 },
    { caseId: '1019-2126-1504-1019', patient: 'احمد على', date: '2026-04-21', price: 725 },
    { caseId: '1019-1943-1904-1019', patient: 'ساره محمد', date: '2026-04-22', price: 1450 },
    { caseId: '1019-1941-1904-1019', patient: 'سمر على', date: '2026-04-22', price: 725 },
    { caseId: '1019-2143-2004-1019', patient: 'هدى جودة', date: '2026-04-23', price: 725 },
    { caseId: '1019-2141-2004-1019', patient: 'سمر سمر', date: '2026-04-23', price: 725 },
    { caseId: '1019-2139-2004-1019', patient: 'عبد العزيز', date: '2026-04-23', price: 725 },
    { caseId: '1019-1603-2004-1019', patient: 'مصطفى', date: '2026-04-23', price: 725 },
    { caseId: '1019-2129-2104-192-1019', patient: 'نيفين محمد', date: '2026-04-24', price: 950 },
    { caseId: '1019-2126-2104-1019', patient: 'سالي عبد الحافظ', date: '2026-04-24', price: 725 },
    { caseId: '1019-2123-2104-192-1019', patient: 'فكريه ابراهيم', date: '2026-04-24', price: 750 },
    { caseId: '1019-2120-2104-1019', patient: 'حازم محمد', date: '2026-04-24', price: 725 },
    { caseId: '1019-2117-2104-1019', patient: 'سما كمال', date: '2026-04-24', price: 725 },
    { caseId: '1019-1157-2204-1019', patient: 'عمر يوسف', date: '2026-04-25', price: 725 },
    { caseId: '1019-1348-2304-192-1019', patient: 'مهتاب مسعد', date: '2026-04-26', price: 725 },
    { caseId: '1019-1347-2304-192-1019', patient: 'داليا صديق', date: '2026-04-26', price: 725 },
    { caseId: '1019-1346-2304-1019', patient: 'يمام وائل', date: '2026-04-26', price: 1450 },
    { caseId: '1019-1344-2304-758-1019', patient: 'آيه عبد الغفار', date: '2026-04-26', price: 1450 },
    { caseId: '1019-1342-2304-246-1019', patient: 'منى عبد الحميد', date: '2026-04-26', price: 725 },
    { caseId: '1019-579-260425-1019', patient: 'رينا عواسي', date: '2026-04-27', price: 725 },
    { caseId: '1019-581-260425-1019', patient: 'عبد الرحمن محمد', date: '2026-04-28', price: 1200 },
    { caseId: '1019-580-260425-1019', patient: 'مروة سيد', date: '2026-04-28', price: 725 },
    { caseId: '1019-578-260423-1019', patient: 'تقى كريم', date: '2026-04-29', price: 725 },
    { caseId: '1019-584-260428-1019', patient: 'محمد بحيرى', date: '2026-05-01', price: 725 },
    { caseId: '1019-585-260428-1019', patient: 'ندى أسامه', date: '2026-05-02', price: 725 },
    { caseId: '1019-583-260428-1019', patient: 'وائل سمير', date: '2026-05-02', price: 1450 },
    { caseId: '1019-582-260428-1019', patient: 'نعمات وهبه', date: '2026-05-02', price: 725 }
];

const db = JSON.parse(fs.readFileSync('./scratch/parsed_hazem_all.json', 'utf-8'));

console.log('Target doctors codes/IDs:');
db.doctors.forEach((d: any) => console.log(` - ${d.name}: Code ${d.doctor_code}, ID ${d.id}`));

// Helper to normalize and match Case IDs
function findDbOrder(caseId: string, patientName: string) {
    // Exact match
    let found = db.orders.find((o: any) => o.case_id === caseId);
    if (found) return found;
    
    // Let's normalize parts
    const parts = caseId.split('-');
    // Try to find by numbers
    const numbers = parts.filter((p: any) => !isNaN(Number(p)) && p !== '1019');
    
    found = db.orders.find((o: any) => {
        const oParts = o.case_id.split('-');
        const oNumbers = oParts.filter((p: any) => !isNaN(Number(p)) && p !== '1019');
        // If they have same numbers and patient name matches or starts with same
        const common = numbers.filter((n: any) => oNumbers.includes(n));
        if (common.length >= 2) {
            return true;
        }
        return false;
    });
    
    if (found) return found;
    
    // Try by patient name
    found = db.orders.find((o: any) => {
        if (!o.patient_name || !patientName) return false;
        const p1 = o.patient_name.trim();
        const p2 = patientName.trim();
        return p1.includes(p2) || p2.includes(p1);
    });
    
    return found;
}

console.log('\n--- RECONCILING STATEMENT 1 CASES ---');
let stmt1PriceChanges: any[] = [];
let stmt1Unmatched: any[] = [];
let stmt1Found: any[] = [];

statement1.forEach(c => {
    const dbOrder = findDbOrder(c.caseId, c.patient);
    if (!dbOrder) {
        stmt1Unmatched.push(c);
        console.log(`❌ Unmatched Statement 1 Case: ${c.caseId} (${c.patient}) | Statement Price: ${c.price}`);
    } else {
        stmt1Found.push({ stmt: c, db: dbOrder });
        const priceDiff = c.price - dbOrder.total_price;
        if (priceDiff !== 0) {
            stmt1PriceChanges.push({ stmt: c, db: dbOrder, diff: priceDiff });
            console.log(`⚠️ Price Discrepancy: ${c.caseId} (${c.patient}) | Statement: ${c.price} | DB: ${dbOrder.total_price} | Diff: ${priceDiff}`);
        }
    }
});

console.log('\n--- RECONCILING STATEMENT 2 CASES ---');
let stmt2PriceChanges: any[] = [];
let stmt2Unmatched: any[] = [];
let stmt2Found: any[] = [];

statement2.forEach(c => {
    const dbOrder = findDbOrder(c.caseId, c.patient);
    if (!dbOrder) {
        stmt2Unmatched.push(c);
        console.log(`❌ Unmatched Statement 2 Case: ${c.caseId} (${c.patient}) | Statement Price: ${c.price}`);
    } else {
        stmt2Found.push({ stmt: c, db: dbOrder });
        const priceDiff = c.price - dbOrder.total_price;
        if (priceDiff !== 0) {
            stmt2PriceChanges.push({ stmt: c, db: dbOrder, diff: priceDiff });
            console.log(`⚠️ Price Discrepancy: ${c.caseId} (${c.patient}) | Statement: ${c.price} | DB: ${dbOrder.total_price} | Diff: ${priceDiff}`);
        }
    }
});

console.log('\n--- OBLIGATIONS & ALLOCATIONS STATUS FOR ALL FOUND ORDERS ---');
// Let's print the obligation and allocation for each matched order
const allFound = [...stmt1Found, ...stmt2Found];
const processedOrders = new Set<string>();

allFound.forEach(f => {
    const order = f.db;
    const stmtCase = f.stmt;
    if (processedOrders.has(order.id)) return;
    processedOrders.add(order.id);
    
    // Find financial obligations
    const orderObligations = db.obligations.filter((o: any) => o.order_id === order.id);
    console.log(`Order: ${order.case_id} (${order.patient_name}) | DB Price: ${order.total_price} | Status: ${order.status}`);
    if (orderObligations.length === 0) {
        console.log('   No obligations found!');
    } else {
        orderObligations.forEach((ob: any) => {
            // Find allocations for this obligation
            const obAllocations = db.allocations.filter((a: any) => a.obligation_id === ob.id);
            console.log(`   Obligation: Net ${ob.net_amount} | Allocated ${ob.allocated_amount} | Status ${ob.status}`);
            obAllocations.forEach((al: any) => {
                console.log(`      Allocation: Amount ${al.allocated_amount} | Status ${al.status} | Method ${al.allocation_method} | Tx ${al.payment_transaction_id}`);
            });
        });
    }
});
