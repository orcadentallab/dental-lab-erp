import * as fs from 'fs';

const csvPath = './historical-allocation-preview.csv';
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n');
const headers = lines[0].split(',').map(h => h.trim());

// Find the entity IDs associated with Smart Dental or Hazem Beltagy
const entityIds = new Set<string>();
const caseIdsFromCsv = new Set<string>();

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',');
    const entityId = cells[3];
    const entityName = cells[4];
    const caseId = cells[8];
    
    if (entityName && (entityName.includes('سمارت دنتل') || entityName.includes('حازم البلتاجى'))) {
        if (entityId) entityIds.add(entityId);
    }
    
    // Also, case IDs starting with 1019- (doctor code)
    if (caseId && (caseId.startsWith('1019-') || caseId.startsWith('CASE-177040290783'))) {
        caseIdsFromCsv.add(caseId);
        if (entityId) entityIds.add(entityId);
    }
}

console.log('Detected Entity IDs:', Array.from(entityIds));

// Now select ALL rows in the CSV where entity_id is in entityIds
const matchedRows: any[] = [];
for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',');
    const entityId = cells[3];
    const caseId = cells[8];
    
    if (entityIds.has(entityId) || (caseId && (caseId.startsWith('1019-') || caseId.startsWith('CASE-177040290783')))) {
        const rowObj: any = {};
        headers.forEach((h, idx) => {
            rowObj[h] = cells[idx] ? cells[idx].trim() : '';
        });
        matchedRows.push(rowObj);
    }
}

console.log(`Matched rows with ID filter: ${matchedRows.length}`);

// Group by transaction
const transactions = new Map<string, any>();
matchedRows.forEach(row => {
    const txId = row.transaction_id;
    if (txId) {
        if (!transactions.has(txId)) {
            transactions.set(txId, {
                txId,
                date: row.transaction_date,
                amount: parseFloat(row.transaction_amount || '0'),
                entityName: row.entity_name,
                allocatedTotal: 0,
                allocations: []
            });
        }
        const t = transactions.get(txId);
        t.allocatedTotal += parseFloat(row.allocated_amount || '0');
        t.allocations.push(row);
    }
});

console.log('\n--- ALL TRANSACTIONS ---');
Array.from(transactions.values()).forEach(t => {
    console.log(`Tx ID: ${t.txId} | Date: ${t.date} | Amount: ${t.amount} | Entity: ${t.entityName} | Allocated Total: ${t.allocatedTotal}`);
});

// Group by case
const cases = new Map<string, any>();
matchedRows.forEach(row => {
    const caseId = row.case_id;
    if (caseId) {
        if (!cases.has(caseId)) {
            cases.set(caseId, {
                caseId,
                patientName: row.patient_name,
                entityName: row.entity_name,
                allocatedTotal: 0,
                rows: []
            });
        }
        const c = cases.get(caseId);
        c.allocatedTotal += parseFloat(row.allocated_amount || '0');
        c.rows.push(row);
    }
});

console.log(`\n--- ALL CASES FOUND IN CSV (${cases.size} total) ---`);
const sortedCases = Array.from(cases.values()).sort((a, b) => a.caseId.localeCompare(b.caseId));
sortedCases.forEach(c => {
    console.log(`Case: ${c.caseId} | Patient: ${c.patientName} | Entity: ${c.entityName} | Allocated: ${c.allocatedTotal}`);
});
