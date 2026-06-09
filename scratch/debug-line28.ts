import * as fs from 'fs';

const sqlPath = './prod-public-data.sql';
const content = fs.readFileSync(sqlPath, 'utf-8');
const lines = content.split('\n');

const line28 = lines[27]; // 28th line is index 27
console.log('Line 28 length:', line28.length);
console.log('Line 28 content:', JSON.stringify(line28));
console.log('Line 28 starts with "INSERT INTO \\"public\\".\\"doctors\\"":', line28.startsWith('INSERT INTO "public"."doctors"'));
console.log('Line 28 trimmed starts with "INSERT INTO \\"public\\".\\"doctors\\"":', line28.trim().startsWith('INSERT INTO "public"."doctors"'));

// Let's print the first 50 character codes of line 28
const charCodes: number[] = [];
for (let i = 0; i < 50 && i < line28.length; i++) {
    charCodes.push(line28.charCodeAt(i));
}
console.log('Char codes of first 50 chars of line 28:', charCodes);
