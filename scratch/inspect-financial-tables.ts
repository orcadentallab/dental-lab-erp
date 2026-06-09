import * as fs from 'fs';

const sqlPath = './prod-public-data.sql';
const content = fs.readFileSync(sqlPath, 'utf-8');
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('INSERT INTO "public"."financial_obligations"')) {
        console.log(`financial_obligations line: "${line.substring(0, 250)}..."`);
    }
    if (line.includes('INSERT INTO "public"."payment_allocations"')) {
        console.log(`payment_allocations line: "${line.substring(0, 250)}..."`);
    }
    if (line.includes('INSERT INTO "public"."adjustments"')) {
        console.log(`adjustments line: "${line.substring(0, 250)}..."`);
    }
}
