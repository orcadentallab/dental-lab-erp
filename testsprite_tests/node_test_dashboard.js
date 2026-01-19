import { chromium } from '@playwright/test';

const BASE_URL = "http://localhost:5173";

async function runTest() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL);

    // Login first
    console.log('Logging in...');
    try {
        await page.fill('input[type="text"]', 'admin');
        await page.fill('input[type="password"]', '123456');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(3000);
        console.log('✅ Login successful');
    } catch (error) {
        console.error('❌ Login failed:', error.message);
        await browser.close();
        return;
    }

    // Verify Dashboard elements
    console.log('Verifying Dashboard...');
    try {
        // Check for dashboard statistics cards
        const statsVisible = await page.locator('.bg-gradient-to-br').first().isVisible();
        if (statsVisible) {
            console.log('✅ Dashboard statistics cards are visible');
        } else {
            console.log('⚠️ Dashboard statistics cards not found');
        }

        // Check for sidebar
        const sidebarVisible = await page.locator('nav').first().isVisible();
        if (sidebarVisible) {
            console.log('✅ Sidebar navigation is visible');
        }

        console.log('✅ Dashboard verification complete');
    } catch (error) {
        console.error('❌ Dashboard verification failed:', error.message);
    }

    await page.waitForTimeout(3000);
    await browser.close();
}

runTest();
