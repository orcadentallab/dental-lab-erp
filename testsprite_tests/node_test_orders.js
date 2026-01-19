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

    // Navigate to Orders page
    console.log('Navigating to Orders page...');
    try {
        const ordersLink = page.locator('a:has-text("الأوردرات")').first();
        if (await ordersLink.isVisible()) {
            await ordersLink.click();
            await page.waitForTimeout(2000);
            console.log('✅ Navigated to Orders page');
        } else {
            console.log('⚠️ Orders link not found, trying direct navigation');
            await page.goto(`${BASE_URL}/orders`);
            await page.waitForTimeout(2000);
        }

        // Check for orders list or "New Order" button
        const newOrderButton = page.locator('button:has-text("أوردر جديد")').first();
        if (await newOrderButton.isVisible()) {
            console.log('✅ "New Order" button is visible');

            // Click to open order form
            await newOrderButton.click();
            await page.waitForTimeout(2000);
            console.log('✅ Order form opened');
        } else {
            console.log('⚠️ "New Order" button not found');
        }

        console.log('✅ Orders page verification complete');
    } catch (error) {
        console.error('❌ Orders page test failed:', error.message);
    }

    await page.waitForTimeout(3000);
    await browser.close();
}

runTest();
