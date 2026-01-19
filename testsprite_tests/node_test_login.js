import { chromium, expect } from '@playwright/test';

// You can change this to your online URL
const BASE_URL = "http://localhost:5173";

async function runTest() {
    const browser = await chromium.launch({ headless: false }); // Headless: false to see the browser
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL);

    // Example Login Flow (Adjust selectors based on your actual app)
    console.log('Attempting login...');

    // Fill in login form (Update selectors if needed)
    try {
        // Updated selector to match Login.tsx (input[type="text"] for username/email)
        await page.fill('input[type="text"]', 'admin');
        await page.fill('input[type="password"]', '123456');         // Update with valid password
        await page.click('button[type="submit"]');

        // Wait for navigation or success element
        await page.waitForTimeout(3000);

        console.log('Login attempt finished. Check browser for result.');
    } catch (error) {
        console.error('Error during test:', error);
    }

    // Keep browser open for a few seconds to see result
    await page.waitForTimeout(5000);

    await browser.close();
}

runTest();
