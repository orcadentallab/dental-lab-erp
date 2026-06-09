import * as fs from 'fs';

const sqlPath = './prod-public-data.sql';
const content = fs.readFileSync(sqlPath, 'utf-8');
const lines = content.split('\n');

const tableNames = new Set<string>();

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('INSERT INTO "public"')) {
        const match = line.match(/INSERT INTO "public"\."([^"]+)"/);
        if (match) {
            tableNames.add(match[1]);
        }
    }
}

console.log('Tables found in dump:', Array.from(tableNames));
