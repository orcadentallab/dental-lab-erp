import { test, expect } from '@playwright/test';

// Mock Data
const mockAdmin = {
    id: 'admin-uuid',
    username: 'admin',
    email: 'admin@dental.com',
    role: 'admin',
    name: 'مدير النظام',
    employee_type: 'admin',
    base_salary: 8000,
    is_active: true
};

const mockAccountant = {
    id: 'accountant-uuid',
    username: 'accountant_joe',
    email: 'joe@dental.com',
    role: 'accountant',
    name: 'المحاسب جو',
    employee_type: 'accountant',
    base_salary: 6000,
    is_active: true
};

const mockRep = {
    id: 'rep-uuid',
    username: 'sales_rep_1',
    email: 'rep1@dental.com',
    role: 'representative',
    name: 'مندوب المبيعات أحمد',
    employee_type: 'sales_rep',
    base_salary: 4000,
    is_active: true
};

const mockUsers = [mockAdmin, mockAccountant, mockRep];

// Mock Advances
const mockAdvances = [
    {
        id: 'adv-1',
        employee_id: 'rep-uuid',
        amount: 1500,
        reason: 'سلفة تصليح سيارة',
        date: '2026-06-15', // Older than 30 days
        status: 'pending',
        created_by: 'admin-uuid',
        created_at: '2026-06-15T12:00:00.000Z'
    }
];

// Mock Custodies
const mockCustodies = [
    {
        id: 'cust-1',
        employee_id: 'rep-uuid',
        description: 'عهدة تابلت للعمل',
        amount: null,
        item: 'Samsung Tab A8',
        date_given: '2026-06-01', // Older than 30 days
        status: 'open',
        created_by: 'admin-uuid',
        created_at: '2026-06-01T10:00:00.000Z'
    }
];

// Mock Commissions
const mockCommissions = [
    {
        id: 'comm-1',
        employee_id: 'rep-uuid',
        amount: 800,
        date: '2026-07-02',
        period: '2026-07',
        note: 'عمولة مبيعات أولى',
        created_by: 'admin-uuid',
        created_at: '2026-07-02T11:00:00.000Z'
    }
];

// Helper to log in
async function loginAs(page: any, username: string) {
    await page.goto('/login');
    await page.locator('input[type="text"]').fill(username);
    await page.locator('input[type="password"]').fill('password123');
    await page.click('button[type="submit"]');
    // Wait for URL redirect (either dashboard or orders)
    await expect(page).toHaveURL(/\/dashboard|doctor\/my-orders/);
}

test.describe('Employee Management & Detail Flows', () => {

    test.beforeEach(async ({ page }) => {
        // Pipe browser console/exceptions to standard output
        page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
        page.on('pageerror', err => console.log('BROWSER EXCEPTION:', err.message));

        // Intercept Supabase Auth Token Calls
        await page.route('**/auth/v1/token*', async (route) => {
            const body = route.request().postDataJSON();
            let matchedUser = mockAdmin;
            if (body?.email?.includes('rep')) {
                matchedUser = mockRep;
            } else if (body?.email?.includes('accountant')) {
                matchedUser = mockAccountant;
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    access_token: 'fake-token',
                    refresh_token: 'fake-refresh-token',
                    token_type: 'bearer',
                    expires_in: 3600,
                    user: {
                        id: matchedUser.id + '-auth',
                        email: matchedUser.email,
                        aud: 'authenticated',
                        user_metadata: { role: matchedUser.role }
                    }
                })
            });
        });

        // Intercept Supabase Auth SignUp Call
        await page.route('**/auth/v1/signup*', async (route) => {
            const body = route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    user: {
                        id: 'new-user-auth-uuid',
                        email: body?.email || 'new@company.com',
                        aud: 'authenticated'
                    },
                    session: null
                })
            });
        });

        // Intercept Supabase RPC get_email_by_username
        await page.route('**/rest/v1/rpc/get_email_by_username', async (route) => {
            const body = route.request().postDataJSON();
            let email = 'admin@dental.com';
            if (body?.uname?.includes('rep')) {
                email = 'rep1@dental.com';
            } else if (body?.uname?.includes('accountant')) {
                email = 'joe@dental.com';
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(email)
            });
        });

        // Intercept Supabase REST API requests
        await page.route('**/rest/v1/**', async (route) => {
            const url = route.request().url();
            const method = route.request().method();

            // 1. Get current logged in user profile (single match)
            if (url.includes('users') && url.includes('auth_id=eq.')) {
                let userProfile = mockAdmin;
                if (url.includes('rep-uuid')) {
                    userProfile = mockRep;
                } else if (url.includes('accountant-uuid')) {
                    userProfile = mockAccountant;
                }
                const responseProfile = {
                    ...userProfile,
                    auth_id: url.split('auth_id=eq.')[1]?.split('&')[0]
                };
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(responseProfile)
                });
                return;
            }

            // 2. Fetching all users
            if (url.includes('users?select=*') && method === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(mockUsers)
                });
                return;
            }

            // Creating a new user row
            if (url.includes('users') && method === 'POST') {
                await route.fulfill({ status: 201 });
                return;
            }

            // 3. Advances CRUD
            if (url.includes('employee_advances') && method === 'GET') {
                const filtered = url.includes('employee_id=eq.')
                    ? mockAdvances.filter(a => a.employee_id === url.split('employee_id=eq.')[1]?.split('&')[0])
                    : mockAdvances;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(filtered)
                });
                return;
            }

            if (url.includes('employee_advances') && method === 'POST') {
                await route.fulfill({ status: 201 });
                return;
            }

            if (url.includes('employee_advances') && method === 'PATCH') {
                await route.fulfill({ status: 200 });
                return;
            }

            // 4. Custody CRUD
            if (url.includes('employee_custody') && method === 'GET') {
                const filtered = url.includes('employee_id=eq.')
                    ? mockCustodies.filter(c => c.employee_id === url.split('employee_id=eq.')[1]?.split('&')[0])
                    : mockCustodies;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(filtered)
                });
                return;
            }

            if (url.includes('employee_custody') && method === 'POST') {
                await route.fulfill({ status: 201 });
                return;
            }

            if (url.includes('employee_custody') && method === 'PATCH') {
                await route.fulfill({ status: 200 });
                return;
            }

            // 5. Commissions CRUD
            if (url.includes('employee_commissions') && method === 'GET') {
                const filtered = url.includes('employee_id=eq.')
                    ? mockCommissions.filter(c => c.employee_id === url.split('employee_id=eq.')[1]?.split('&')[0])
                    : mockCommissions;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(filtered)
                });
                return;
            }

            if (url.includes('employee_commissions') && method === 'POST') {
                await route.fulfill({ status: 201 });
                return;
            }

            if (url.includes('employee_commissions') && method === 'DELETE') {
                await route.fulfill({ status: 200 });
                return;
            }

            // 6. Generic transactions (for monthly payroll checks)
            if (url.includes('transactions')) {
                if (method === 'GET') {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify([])
                    });
                } else {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ success: true })
                    });
                }
                return;
            }

            // Fallback: fulfill with empty arrays or success
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([])
            });
        });
    });

    test('Admin can view dashboard, add employee, see overdue alerts, and navigate to details', async ({ page }) => {
        // Login as Admin
        await loginAs(page, 'admin');

        // Go to employees
        await page.goto('/employees');

        // Check summary card elements exist
        await expect(page.locator('text=إجمالي الموظفين').first()).toBeVisible();
        await expect(page.locator('text=إجمالي السلف القائمة').first()).toBeVisible();

        // Check overdue alert badge in the table row
        await expect(page.locator('text=تأخير > 30 يوم').first()).toBeVisible();

        // Add New Employee Modal
        await page.click('text=إضافة موظف جديد');
        await page.locator('input[placeholder="مثال: أحمد محمد علي"]').fill('الموظف الجديد');
        await page.locator('input[placeholder="user_ahmed"]').fill('new_employee');
        await page.locator('input[placeholder="ahmed@company.com"]').fill('new@company.com');
        await page.locator('input[placeholder="8 أرقام أو حروف على الأقل"]').fill('mypass123');
        await page.locator('input[placeholder="مثال: 5000"]').fill('4500');

        // Save
        await page.click('button[type="submit"]');
        await expect(page.locator('h2:has-text("إضافة موظف جديد")')).not.toBeVisible(); // Modal closed

        // Navigate to احمد's profile
        await page.locator('tr:has-text("مندوب المبيعات أحمد")').locator('text=عرض الملف').click();
        await expect(page).toHaveURL(/\/employees\/rep-uuid/);

        // Check profile stats
        await expect(page.locator('text=صافي الرصيد الحالي')).toBeVisible();
        await expect(page.locator('text=سجل إدخال العمولات اليدوي')).toBeVisible();
    });

    test('Advances and Custody manuals settle/close flows', async ({ page }) => {
        // Login and goto rep detail directly
        await loginAs(page, 'admin');

        await page.goto('/employees/rep-uuid');

        // Settle Advance
        await expect(page.getByRole('button', { name: 'تسوية' })).toBeVisible();
        
        // Mock window.confirm to always return true
        page.on('dialog', async (dialog) => {
            if (dialog.message().includes('تسوية هذه السلفة')) {
                await dialog.accept();
            } else if (dialog.message().includes('إرجاع/إغلاق هذه العهدة')) {
                await dialog.accept();
            }
        });

        await page.getByRole('button', { name: 'تسوية' }).click();

        // Close Custody
        await page.click('text=استلام');
    });

    test('Commissions manual inputs are only visible to sales reps', async ({ page }) => {
        // Login
        await loginAs(page, 'admin');

        // View representative (sales rep) - commissions should be visible
        await page.goto('/employees/rep-uuid');
        await expect(page.locator('text=سجل إدخال العمولات اليدوي')).toBeVisible();

        // View accountant - commissions should be hidden
        await page.goto('/employees/accountant-uuid');
        await expect(page.locator('text=سجل إدخال العمولات اليدوي')).not.toBeVisible();
    });

    test('Sales Rep is redirected from employees dashboard and blocked from other profiles', async ({ page }) => {
        // Login as representative
        await loginAs(page, 'sales_rep_1');

        // 1. Visit /employees dashboard -> should redirect to own profile (/employees/rep-uuid)
        await page.goto('/employees');
        await expect(page).toHaveURL(/\/employees\/rep-uuid/);

        // 2. Try to directly navigate to accountant profile -> should block and redirect to dashboard
        await page.goto('/employees/accountant-uuid');
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.locator('text=غير مصرح لك بعرض بيانات موظف آخر').first()).toBeVisible();
    });
});
