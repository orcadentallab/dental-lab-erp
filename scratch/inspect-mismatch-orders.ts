import * as fs from 'fs';

const sqlPath = './prod-public-data.sql';
const content = fs.readFileSync(sqlPath, 'utf-8');
const lines = content.split('\n');

const casesToInspect = [
    '1019-2503-1357',
    '1019-192-2104-2123',
    '1019-192-2304-1348',
    '1019-192-2304-1347',
    '1019-1504-2124'
];

let currentTable = '';
let currentInsertBuffer = '';

for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const line = lines[lineNum - 1];
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('INSERT INTO "public"."orders"')) {
        currentTable = 'orders';
        currentInsertBuffer = line;
        continue;
    } else if (trimmed.startsWith('INSERT INTO')) {
        currentTable = '';
        currentInsertBuffer = '';
        continue;
    }
    
    if (currentTable === 'orders') {
        currentInsertBuffer += ' ' + line;
        if (trimmed.endsWith(';')) {
            inspectInsertBlock(currentInsertBuffer);
            currentTable = '';
            currentInsertBuffer = '';
        }
    }
}

function inspectInsertBlock(block: string) {
    const valuesIndex = block.indexOf('VALUES');
    if (valuesIndex === -1) return;
    
    let valuesPart = block.substring(valuesIndex + 6).trim();
    if (valuesPart.endsWith(';')) {
        valuesPart = valuesPart.slice(0, -1).trim();
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
                        
                        const caseId = tupleValues[1];
                        if (caseId && casesToInspect.includes(caseId)) {
                            console.log(`\n--- INSPECTING ORDER: ${caseId} ---`);
                            console.log(`Patient: ${tupleValues[3]}`);
                            console.log(`Items: ${tupleValues[4]}`);
                            console.log(`Discount: ${tupleValues[5]}`);
                            console.log(`Total Price: ${tupleValues[6]}`);
                            console.log(`Status: ${tupleValues[8]}`);
                            console.log(`Delivery Date: ${tupleValues[9]}`);
                            console.log(`Created At: ${tupleValues[29]}`);
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
