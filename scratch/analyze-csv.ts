import * as fs from 'fs';

const csvPath = './historical-allocation-preview.csv';
if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
}

const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n');
const headers = lines[0].split(',').map(h => h.trim());

const matchingRows: any[] = [];

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const cells = line.split(',');
    const entityName = cells[4];
    
    if (entityName && (entityName.includes('سمارت دنتل') || entityName.includes('حازم البلتاجى'))) {
        const rowObj: any = {};
        headers.forEach((h, idx) => {
            rowObj[h] = cells[idx] ? cells[idx].trim() : '';
        });
        matchingRows.push(rowObj);
    }
}

console.log(`Total rows for doctor: ${matchingRows.length}`);

// Let's summarize the unique cases and their total allocated amounts, transaction IDs, etc.
const casesMap = new Map<string, any>();
const transactionsMap = new Map<string, any>();

matchingRows.forEach(row => {
    // Collect case info
    const caseId = row.case_id;
    if (caseId) {
        if (!casesMap.has(caseId)) {
            casesMap.set(caseId, {
                caseId,
                patientName: row.patient_name,
                allocatedTotal: 0,
                allocations: []
            });
        }
        const c = casesMap.get(caseId);
        c.allocatedTotal += parseFloat(row.allocated_amount || '0');
        c.allocations.push({
            transactionId: row.transaction_id,
            transactionDate: row.transaction_date,
            transactionAmount: parseFloat(row.transaction_amount || '0'),
            allocatedAmount: parseFloat(row.allocated_amount || '0')
        });
    }
    
    // Collect transaction info
    const txId = row.transaction_id;
    if (txId) {
        if (!transactionsMap.has(txId)) {
            transactionsMap.set(txId, {
                transactionId: txId,
                date: row.transaction_date,
                amount: parseFloat(row.transaction_amount || '0'),
                allocatedTotal: 0
            });
        }
        transactionsMap.get(txId).allocatedTotal += parseFloat(row.allocated_amount || '0');
    }
});

console.log('\n--- TRANSACTIONS FOUND ---');
Array.from(transactionsMap.values()).forEach(t => {
    console.log(`Tx ID: ${t.transactionId} | Date: ${t.date} | Amount: ${t.amount} | Total Allocated: ${t.allocatedTotal}`);
});

console.log('\n--- CASES FOUND (Sorted by case ID) ---');
const sortedCases = Array.from(casesMap.values()).sort((a, b) => a.caseId.localeCompare(b.caseId));
sortedCases.forEach(c => {
    console.log(`Case: ${c.caseId} | Patient: ${c.patientName} | Total Allocated: ${c.allocatedTotal}`);
    c.allocations.forEach((al: any) => {
        console.log(`  -> Tx: ${al.transactionId} (${al.transactionDate}) | TxAmt: ${al.transactionAmount} | Allocated: ${al.allocatedAmount}`);
    });
});
