import { test, expect } from '@playwright/test';

// Offline UI checks only: the dedicated configuration uses a loopback API,
// and every API request is fulfilled locally. No real financial records.
for (const role of ['admin', 'accountant', 'coordinator']) {
    test(`${role}: old registration bookmark redirects to actual cash recording`, async ({ page }) => {
        const apiRequests: string[] = [];
        await page.route('http://127.0.0.1:54321/**', async route => {
            const url = route.request().url();
            apiRequests.push(url);
            const profile = { id: 'qa-user', auth_id: 'qa-auth', username: 'Sleem', name: 'Local QA', role, is_active: true };
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
                url.includes('/rest/v1/users') && url.includes('auth_id=') ? profile : []
            ), headers: { 'content-range': '0-0/0' } });
        });
        await page.addInitScript(() => {
            localStorage.setItem('sb-127-auth-token', JSON.stringify({
                access_token: 'offline-test-session', refresh_token: 'offline-test-refresh',
                token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600,
                user: { id: 'qa-auth', aud: 'authenticated', email: 'qa@local.test' },
            }));
        });
        await page.goto('/case-registration', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/finance\/ledgers$/);
        await expect(page.locator('a[href="/case-registration"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'تسجيل', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'تسجيل التحصيل', exact: true })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'الحالة', exact: true })).toHaveCount(0);
        await page.goto('/finance/transactions', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('button', { name: 'تسجيل المصروف', exact: true })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'الحالة', exact: true })).toHaveCount(0);
        expect(apiRequests.some(url => url.includes('needs_accounting_reregistration'))).toBe(false);
    });
}
