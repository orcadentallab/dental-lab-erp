import { chromium } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// List of converted test files to run
const testFiles = [
    'node_test_login.js',
    'node_test_dashboard.js',
    'node_test_orders.js',
    'node_test_logout.js',
];

async function runAllTests() {
    console.log('🚀 Starting Full Test Suite Execution...\n');

    let passed = 0;
    let failed = 0;

    for (const file of testFiles) {
        const filePath = path.join(process.cwd(), 'testsprite_tests', file);
        if (!fs.existsSync(filePath)) {
            console.log(`⚠️  Skipping ${file}: File not found.`);
            continue;
        }

        console.log(`--------------------------------------------------`);
        console.log(`Running: ${file}`);
        console.log(`--------------------------------------------------`);

        try {
            // Run the Node.js script synchronously
            execSync(`node "${filePath}"`, { stdio: 'inherit' });
            console.log(`\n✅ ${file} COMPLETED\n`);
            passed++;
        } catch (error) {
            console.error(`\n❌ ${file} FAILED`);
            console.error(error.message);
            failed++;
        }
    }

    console.log(`==================================================`);
    console.log(`Test Summary:`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`==================================================`);
}

runAllTests();
