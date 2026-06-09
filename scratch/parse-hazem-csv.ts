import * as fs from 'fs';
import * as path from 'path';

const csvPath = './historical-allocation-preview.csv';
if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
}

const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n');

const headers = lines[0].split(',');
console.log('Headers:', headers);

const matchingRows: any[] = [];

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Simple CSV parser that handles commas inside quotes (if any, though here it looks like plain commas)
    // Let's just split by comma
    const cells = line.split(',');
    const entityName = cells[4];
    
    if (entityName && entityName.includes('سمارت دنتل')) {
        const rowObj: any = {};
        headers.forEach((h, idx) => {
            rowObj[h.trim()] = cells[idx] ? cells[idx].trim() : '';
        });
        matchingRows.push(rowObj);
    }
}

console.log(`Found ${matchingRows.length} matching rows in CSV.`);

// Let's group by case_id/patient_name and see what they are
const cases = new Map<string, any>();
matchingRows.forEach(row => {
    const caseId = row.case_id;
    if (!cases.has(caseId)) {
        cases.set(caseId, {
            caseId: row.case_id,
            patientName: row.patient_name,
            allocatedAmount: 0,
            transactionDates: []
        });
    }
    const cObj = cases.get(caseId);
    cObj.allocatedAmount += parseFloat(row.allocated_amount || '0');
    if (row.transaction_date && !cObj.transactionDates.includes(row.transaction_date)) {
        cObj.transactionDates.push(row.transaction_date);
    }
});

console.log('\n--- CASES AND THEIR ALLOCATED PAYMENTS ---');
Array.from(cases.values()).forEach(c => {
    console.log(`${c.caseId} | ${c.patientName} | Total Allocated: ${c.allocatedAmount} | Dates: ${c.transactionDates.join(', ')}`);
});
