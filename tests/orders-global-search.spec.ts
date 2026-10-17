import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    // Keep the real search, Orders page and cards; isolate authentication and IO.
    await page.route('**/src/context/AuthContext.tsx', route => route.fulfill({
        contentType: 'application/javascript',
        body: `export const useAuth = () => ({ user: { id: 'search-admin', role: 'admin', name: 'Admin' }, hasPermission: () => true });`,
    }));
    await page.route('**/rest/v1/**', route => route.fulfill({
        contentType: 'application/json', body: '[]',
    }));
    await page.goto('/tests/fixtures/orders-search.html');
});

test('selecting a delivered case replaces existing search, filters, page and board view', async ({ page }) => {
    const search = page.getByRole('textbox', { name: 'بحث شامل' });
    await search.fill('وسام');
    await page.getByRole('button').filter({ hasText: '1043-260709-506' }).click();
    await expect(page.getByTestId('location')).toHaveText('?q=1043-260709-506&highlight=delivered-search&hideDelivered=0');
    await expect(page.getByText('وسام', { exact: true })).toBeVisible();

    // URL replacements (including highlight expiry) must keep the selected page.
    await expect(page.getByTestId('location')).not.toContainText('highlight', { timeout: 8000 });
    await expect(page.getByText('وسام', { exact: true })).toBeVisible();
    const localSearch = page.locator('input[value="1043-260709-506"]:visible');
    await localSearch.fill('missing');
    await page.locator('input[value="missing"]:visible').press('Enter');
    await expect(page.getByText('وسام', { exact: true })).not.toBeVisible();
    // A fresh selection of the same case must reset the edited local search too.
    await search.fill('وسام');
    await page.getByRole('button').filter({ hasText: '1043-260709-506' }).click();
    await expect(page.getByText('وسام', { exact: true })).toBeVisible();
    await search.fill('وسام');
    await page.getByRole('button').filter({ hasText: '1043-260709-507' }).click();
    await expect(page.getByTestId('location')).toContainText('archived=1');
    await expect(page.getByText('وسام مؤرشف', { exact: true })).toBeVisible();
});

test('selecting a doctor clears the previous order filters on the same page', async ({ page }) => {
    await page.getByRole('textbox', { name: 'بحث شامل' }).fill('حسام');
    await page.getByRole('button', { name: 'عرض الحالات' }).click();
    await expect(page.getByTestId('location')).toHaveText('?doctor=doctor-search&hideDelivered=0');
    await expect(page.getByText('وسام', { exact: true })).toBeVisible();
});
