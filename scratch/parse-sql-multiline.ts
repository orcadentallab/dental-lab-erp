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

let currentTable = '';
let currentInsertBuffer = '';

console.log('Scanning SQL file...');
for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const line = lines[lineNum - 1];
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('INSERT INTO "public"."doctors"')) {
        currentTable = 'doctors';
        currentInsertBuffer = line; // include values header
        continue;
    } else if (trimmed.startsWith('INSERT INTO "public"."orders"')) {
        currentTable = 'orders';
        currentInsertBuffer = line;
        continue;
    } else if (trimmed.startsWith('INSERT INTO "public"."transactions"')) {
        currentTable = 'transactions';
        currentInsertBuffer = line;
        continue;
    } else if (trimmed.startsWith('INSERT INTO')) {
        currentTable = '';
        currentInsertBuffer = '';
        continue;
    }
    
    if (currentTable) {
        currentInsertBuffer += ' ' + line;
        if (trimmed.endsWith(';')) {
            // Process the full INSERT block
            parseInsertBlock(currentInsertBuffer, currentTable);
            currentTable = '';
            currentInsertBuffer = '';
        }
    }
}

function parseInsertBlock(block: string, tableName: string) {
    const valuesIndex = block.indexOf('VALUES');
    if (valuesIndex === -1) return;
    
    let valuesPart = block.substring(valuesIndex + 6).trim();
    if (valuesPart.endsWith(';')) {
        valuesPart = valuesPart.slice(0, -1).trim();
    }
    
    // Values are comma-separated tuples: ('val1', 'val2', ...), ('val1', 'val2', ...)
    // Let's parse them
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
                        
                        // Push to correct array
                        if (tableName === 'doctors') {
                            doctors.push({
                                id: tupleValues[0],
                                name: tupleValues[1],
                                phone: tupleValues[2],
                                doctor_code: tupleValues[5],
                                parent_id: tupleValues[12] === 'NULL' ? null : tupleValues[12]
                            });
                        } else if (tableName === 'orders') {
                            orders.push({
                                id: tupleValues[0],
                                case_id: tupleValues[1],
                                doctor_id: tupleValues[2],
                                patient_name: tupleValues[3],
                                total_price: parseFloat(tupleValues[6] || '0'),
                                status: tupleValues[8],
                                delivery_date: tupleValues[9],
                                created_at: tupleValues[29]
                            });
                        } else if (tableName === 'transactions') {
                            // "id" (0), "type" (1), "amount" (2), "category" (3), "date" (4), "description" (5), "entity_id" (6), "entity_type" (7)
                            transactions.push({
                                id: tupleValues[0],
                                type: tupleValues[1],
                                amount: parseFloat(tupleValues[2] || '0'),
                                category: tupleValues[3],
                                date: tupleValues[4],
                                description: tupleValues[5],
                                entity_id: tupleValues[6],
                                entity_type: tupleValues[7]
                            });
                        }
                        
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
