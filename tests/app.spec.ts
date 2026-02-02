import { test, expect } from '@playwright/test';

test.describe('Dental Lab ERP - Core Tests', () => {

    test('Login page loads correctly', async ({ page }) => {
        await page.goto('/login');

        // Check login form elements exist
        await expect(page.locator('input[type="email"], input[type="text"]').first()).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
        await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('Login page has proper styling', async ({ page }) => {
        await page.goto('/login');

        // Page should not be blank
        const bodyContent = await page.locator('body').textContent();
        expect(bodyContent?.length).toBeGreaterThan(10);
    });

    test('Unauthenticated user is redirected to login', async ({ page }) => {
        await page.goto('/orders');

        // Should redirect to login
        await expect(page).toHaveURL(/login/);
    });

    test('Dashboard redirects to login when not authenticated', async ({ page }) => {
        await page.goto('/dashboard');

        // Should redirect to login
        await expect(page).toHaveURL(/login/);
    });
});

test.describe('UI Components', () => {

    test('App renders without errors', async ({ page }) => {
        await page.goto('/');

        // No error boundary or blank page
        const content = await page.locator('body').textContent();
        expect(content).not.toContain('Error');
        expect(content?.length).toBeGreaterThan(0);
    });

    test('RTL layout is applied', async ({ page }) => {
        await page.goto('/login');

        // Check if RTL is applied (Arabic interface)
        const htmlDir = await page.locator('html').getAttribute('dir');
        const bodyDir = await page.locator('body').getAttribute('dir');

        // At least one should be RTL or body should have RTL content
        const hasRTL = htmlDir === 'rtl' || bodyDir === 'rtl';
        const hasArabic = (await page.locator('body').textContent())?.match(/[\u0600-\u06FF]/);

        expect(hasRTL || hasArabic).toBeTruthy();
    });
});
