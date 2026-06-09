import * as fs from 'fs';

const sqlPath = './prod-public-data.sql';
if (!fs.existsSync(sqlPath)) {
    console.error(`File not found: ${sqlPath}`);
    process.exit(1);
}

const content = fs.readFileSync(sqlPath, 'utf-8');
const lines = content.split('\n');

const doctors: any[] = [];
const orders: any[] = [];
const transactions: any[] = [];

function parseInsertLine(line: string): any[] {
    const records: any[] = [];
    const valuesIndex = line.indexOf('VALUES');
    if (valuesIndex === -1) return [];
    
    let valuesPart = line.substring(valuesIndex + 6).trim();
    if (valuesPart.endsWith(';')) {
        valuesPart = valuesPart.slice(0, -1);
    }
    
    let i = 0;
    while (i < valuesPart.length) {
        if (valuesPart[i] === '(') {
            i++;
            const tupleValues: string[] = [];
            let currentVal = '';
            let inQuotes = false;
            let quoteChar = '';
            let escaped = false;
            
            while (i < valuesPart.length) {
                const char = valuesPart[i];
                if (escaped) {
                    currentVal += char;
                    escaped = false;
                    i++;
                    continue;
                }
                if (char === '\\') {
                    escaped = true;
                    i++;
                    continue;
                }
                if (inQuotes) {
                    if (char === quoteChar) {
                        if (valuesPart[i + 1] === quoteChar) {
                            currentVal += quoteChar;
                            i += 2;
                            continue;
                        }
                        inQuotes = false;
                    } else {
                        currentVal += char;
                    }
                } else {
                    if (char === "'" || char === '"') {
                        inQuotes = true;
                        quoteChar = char;
                    } else if (char === ',') {
                        tupleValues.push(currentVal.trim());
                        currentVal = '';
                    } else if (char === ')') {
                        tupleValues.push(currentVal.trim());
                        records.push(tupleValues);
                        break;
                    } else {
                        currentVal += char;
                    }
                }
                i++;
            }
        }
        i++;
    }
    return records;
}

console.log('Scanning SQL file...');
for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const line = lines[lineNum - 1].trim();
    if (!line) continue;
    
    if (line.startsWith('INSERT INTO "public"."doctors"')) {
        const parsed = parseInsertLine(line);
        parsed.forEach(p => {
            doctors.push({
                id: p[0],
                name: p[1],
                phone: p[2],
                doctor_code: p[5],
                parent_id: p[12] === 'NULL' ? null : p[12]
            });
        });
    } else if (line.startsWith('INSERT INTO "public"."orders"')) {
        const parsed = parseInsertLine(line);
        parsed.forEach(p => {
            orders.push({
                id: p[0],
                case_id: p[1],
                doctor_id: p[2],
                patient_name: p[3],
                total_price: parseFloat(p[6] || '0'),
                status: p[8],
                delivery_date: p[9],
                created_at: p[29]
            });
        });
    } else if (line.startsWith('INSERT INTO "public"."transactions"')) {
        const parsed = parseInsertLine(line);
        parsed.forEach(p => {
            // "id" (0), "type" (1), "amount" (2), "category" (3), "date" (4), "description" (5), "entity_id" (6), "entity_type" (7)
            transactions.push({
                id: p[0],
                type: p[1],
                amount: parseFloat(p[2] || '0'),
                category: p[3],
                date: p[4],
                description: p[5],
                entity_id: p[6],
                entity_type: p[7]
            });
        });
    }
}

console.log(`Parsed ${doctors.length} doctors, ${orders.length} orders, ${transactions.length} transactions.`);

const targetParentId = '5bcce6de-74c1-4505-87d9-c68dac58c55e';
const targetDoctors = doctors.filter(d => d.id === targetParentId || d.parent_id === targetParentId);
const targetDocIds = targetDoctors.map(d => d.id);
console.log('Target doctors:', targetDoctors.map(d => `${d.name} (${d.doctor_code})`));

const targetOrders = orders.filter(o => targetDocIds.includes(o.doctor_id));
const targetTransactions = transactions.filter(t => targetDocIds.includes(t.entity_id));

console.log(`Found ${targetOrders.length} orders and ${targetTransactions.length} transactions for these doctors.`);

fs.writeFileSync('./scratch/parsed_hazem.json', JSON.stringify({
    doctors: targetDoctors,
    orders: targetOrders,
    transactions: targetTransactions
}, null, 2));

console.log('Saved target data to ./scratch/parsed_hazem.json');
