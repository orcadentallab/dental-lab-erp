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

    // Perform Logout
    console.log('Attempting to logout...');
    try {
        // Click on logout button (usually in sidebar or settings)
        const logoutButton = page.locator('button:has-text("خروج"), button:has-text("تسجيل الخروج")').first();
        if (await logoutButton.isVisible()) {
            await logoutButton.click();
            await page.waitForTimeout(2000);

            // Verify we're back at login page
            const loginForm = await page.locator('input[type="text"]').isVisible();
            if (loginForm) {
                console.log('✅ Logout successful - returned to login page');
            } else {
                console.log('⚠️ Logout clicked but login page not visible');
            }
        } else {
            console.log('⚠️ Logout button not found');
        }
    } catch (error) {
        console.error('❌ Logout failed:', error.message);
    }

    await page.waitForTimeout(2000);
    await browser.close();
}

runTest();
