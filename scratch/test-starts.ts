import * as fs from 'fs';

const sqlPath = './prod-public-data.sql';
const content = fs.readFileSync(sqlPath, 'utf-8');
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('INSERT INTO "public"."doctors"')) {
        console.log(`Line ${i + 1} doctors: "${line.substring(0, 100)}..."`);
    }
    if (line.includes('INSERT INTO "public"."orders"')) {
        console.log(`Line ${i + 1} orders: "${line.substring(0, 100)}..."`);
    }
    if (line.includes('INSERT INTO "public"."transactions"')) {
        console.log(`Line ${i + 1} transactions: "${line.substring(0, 100)}..."`);
    }
}
