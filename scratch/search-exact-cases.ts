import * as fs from 'fs';

const cases1 = [
    'CASE-1770402907834-56', 'CASE-1770402907833-24', 'CASE-1770402907831-3',
    '1019-100226-002', '1019-100226-001', '1019-150226-001', '1019-2502-2036',
    '1019-2502-1336', '1019-2602-2029', '1019-2602-1208', '1019-2602-1206',
    '1019-2602-1147', '1019-1715-2802-1019', '1019-1713-2802-1019', '1019-1712-2802-1019',
    '1019-0103-1352', '1019-0403-1435', '1019-0703-1543', '1019-0703-1540',
    '1019-1203-1436', '1019-1203-1316', '1019-1203-1314', '1019-1850-1403-1019',
    '1019-2126-1603-1019', '1019-1351-1803-1019', '1019-1349-1803-1019', '1019-2015-2303-1019',
    '1019-1604-2303-1019', '1019-1355-2503-1019', '1019-1404-2503-1019', '1019-1359-2503-1019',
    '1019-1357-2503-1019', '1019-2216-2403-1019', '1019-2136-2603-1019', '1019-1948-2503-1019',
    '1019-2043-2803-1019'
];

const cases2 = [
    '1019-2043-2803-1019', '1019-1211-3103-1019', '1019-1448-3103-1019', '1019-1350-0104-1019',
    '1019-2111-0104-1019', '1019-2058-0104-1019', '1019-2056-0104-1019', '1019-2149-3103-1019',
    '1019-2147-3103-1019', '1019-1732-0404-1019', '1019-1156-0404-1019', '1019-1354-0804-1019',
    '1019-1307-1004-1019', '1019-1841-0904-1019', '1019-2124-1504-1019', '1019-1311-1304-1019',
    '1019-1503-1504-1019', '1019-1501-1504-1019', '1019-1458-1504-1019', '1019-1454-1504-1019',
    '1019-1453-1504-1019', '1019-1555-1804-1019', '1019-2127-1504-1019', '1019-2126-1504-1019',
    '1019-1943-1904-1019', '1019-1941-1904-1019', '1019-2143-2004-1019', '1019-2141-2004-1019',
    '1019-2139-2004-1019', '1019-1603-2004-1019', '1019-2129-2104-192-1019', '1019-2126-2104-1019',
    '1019-2123-2104-192-1019', '1019-2120-2104-1019', '1019-2117-2104-1019', '1019-1157-2204-1019',
    '1019-1348-2304-192-1019', '1019-1347-2304-192-1019', '1019-1346-2304-1019', '1019-1344-2304-758-1019',
    '1019-1342-2304-246-1019', '1019-579-260425-1019', '1019-581-260425-1019', '1019-580-260425-1019',
    '1019-578-260423-1019', '1019-584-260428-1019', '1019-585-260428-1019', '1019-583-260428-1019',
    '1019-582-260428-1019'
];

const allSearchIds = Array.from(new Set([...cases1, ...cases2]));

const csvPath = './historical-allocation-preview.csv';
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n');
const headers = lines[0].split(',').map(h => h.trim());

const foundRows: any[] = [];

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',');
    const caseId = cells[8] ? cells[8].trim() : '';
    
    // Check for exact match or suffix/prefix match
    let match = false;
    for (const searchId of allSearchIds) {
        if (caseId === searchId) {
            match = true;
            break;
        }
        
        // Handle database normalizing, e.g. case ID differences in parts:
        // statement has 1019-1850-1403-1019, but database has 1019-1403-1850 (without prefix or rearranged parts)
        // Let's check if there are matches on parts
        const partsA = searchId.split('-');
        const partsB = caseId.split('-');
        
        // If they have the same numbers in their parts (e.g. 1019, 1403, 1850)
        if (partsA.includes('1019') && partsB.includes('1019')) {
            const numbersA = partsA.filter(p => !isNaN(Number(p)));
            const numbersB = partsB.filter(p => !isNaN(Number(p)));
            if (numbersA.length > 1 && numbersB.length > 1) {
                // Check if all numbers in A are in B or vice-versa
                const common = numbersA.filter(x => numbersB.includes(x));
                if (common.length >= 3 && common.includes('1019')) {
                    // console.log(`Potential fuzzy match: ${searchId} vs ${caseId}`);
                    match = true;
                    break;
                }
            }
        }
    }
    
    if (match) {
        const rowObj: any = {};
        headers.forEach((h, idx) => {
            rowObj[h] = cells[idx] ? cells[idx].trim() : '';
        });
        foundRows.push(rowObj);
    }
}

console.log(`Found ${foundRows.length} rows in CSV matching our cases.`);

// Group and output
const grouped = new Map<string, any[]>();
foundRows.forEach(row => {
    const cId = row.case_id;
    if (!grouped.has(cId)) {
        grouped.set(cId, []);
    }
    grouped.get(cId)!.push(row);
});

console.log('\n--- DETAILED CSV ENTRIES FOR STATEMENT CASES ---');
Array.from(grouped.entries()).forEach(([cId, rows]) => {
    console.log(`Case ID in CSV: ${cId}`);
    rows.forEach(r => {
        console.log(`  Patient: ${r.patient_name} | Entity: ${r.entity_name} | TxAmt: ${r.transaction_amount} | Allocated: ${r.allocated_amount} | Tx Date: ${r.transaction_date}`);
    });
});
