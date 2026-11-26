import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test('registration has no OTP and persists only its device request before approval', async ({ page }) => {
    const submissions: Record<string, unknown>[] = [];
    let status = 'pending';
    await page.route('http://127.0.0.1:56431/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let data: unknown = [];
        if (path.endsWith('/submit_doctor_manual_access')) {
            submissions.push(route.request().postDataJSON());
            data = { success: true, request_id: '82000000-0000-0000-0000-000000000011', status: 'pending' };
        } else if (path.endsWith('/open_doctor_manual_access')) data = { success: true, status };
        else if (path.includes('/auth/v1/token')) throw new Error('Pending or rejected request tried to sign in');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('/login');
    await page.getByLabel('رقم الموبايل', { exact: true }).fill('01077233333');
    await page.getByLabel('كود الطبيب لدى المعمل').fill('2003');
    await page.getByRole('button', { name: 'إرسال طلب ربط الحساب' }).click();
    await expect(page.getByRole('status')).toContainText('تم إرسال طلبك');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].p_token).toMatch(/^[a-f0-9]{64}$/);
    await page.reload();
    await page.getByRole('button', { name: 'متابعة طلبي / الدخول بعد الاعتماد' }).click();
    await expect(page.getByRole('status')).toHaveText('طلبك قيد مراجعة المعمل.');
    status = 'rejected';
    await page.getByRole('button', { name: 'متابعة طلبي / الدخول بعد الاعتماد' }).click();
    await expect(page.getByRole('status')).toContainText('لم يتم اعتماد طلبك');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('بوابة الأطباء (WhatsApp)', { exact: true })).toHaveCount(0);
});

test('real local staff approval creates a regional center and opens only the approved device', async ({ page, browser }) => {
    test.skip(!process.env.DOCTOR_PORTAL_QA_ANON_KEY, 'Dedicated local QA database is required.');
    const staff = createClient('http://127.0.0.1:56431', process.env.DOCTOR_PORTAL_QA_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const phone = `010${80000000 + Math.floor(Math.random() * 9999999)}`;
    await page.goto('/login');
    await page.getByLabel('لا، أول تعامل — تسجيل طبيب جديد').check();
    await page.getByLabel('رقم الموبايل', { exact: true }).fill(phone);
    await page.getByRole('button', { name: 'استكمال بيانات العيادة' }).click();
    await page.getByLabel('اسم الطبيب أو المركز').fill('د. مركز اختبار التسجيل');
    await page.getByLabel('منطقة العيادة الرئيسية').selectOption('east_cairo');
    await page.getByLabel('عنوان العيادة الرئيسي').fill('عنوان المركز التجريبي الرئيسي');
    await page.getByLabel('أنا مركز طبي يعمل به أكثر من طبيب').check();
    await page.getByRole('button', { name: 'إضافة طبيب للمركز' }).click();
    await page.getByLabel('اسم طبيب المركز 1').fill('محمد اختبار المركز');
    await page.getByLabel('لدي فروع إضافية أريد تسجيل عناوينها').check();
    await page.getByLabel('اسم الفرع 1').fill('فرع التجمع');
    await page.getByLabel('عنوان الفرع 1').fill('عنوان التجمع التجريبي');
    await page.getByRole('button', { name: 'إرسال التسجيل للمراجعة' }).click();
    await expect(page.getByRole('status')).toContainText('تم إرسال طلبك');
    await page.getByRole('button', { name: 'متابعة طلبي / الدخول بعد الاعتماد' }).click();
    await expect(page.getByRole('status')).toContainText('قيد مراجعة');
    const device = await page.evaluate(() => JSON.parse(localStorage.getItem('orca.doctor.manual-access.v1')!));
    const staffContext = await browser.newContext();
    try {
        const staffPage = await staffContext.newPage();
        await staffPage.goto('http://127.0.0.1:5187/login');
        await staffPage.getByRole('button', { name: 'طاقم العمل', exact: true }).click();
        await staffPage.getByPlaceholder('اسم المستخدم أو البريد الإلكتروني').fill('doctor-codes-qa@local.test');
        await staffPage.locator('input[type="password"]').fill('local-qa-codes-only');
        await staffPage.getByRole('button', { name: 'تسجيل دخول طاقم العمل' }).click();
        await expect(staffPage).not.toHaveURL(/\/login$/);
        await staffPage.goto('http://127.0.0.1:5187/doctors');
        await staffPage.getByTitle('طلبات ربط أرقام الأطباء المعلقة').click();
        const card = staffPage.getByTestId(`doctor-link-request-${device.id}`);
        await expect(card).toContainText('مركز اختبار التسجيل');
        await expect(card).toContainText('فرع التجمع');
        await expect(card).toContainText('محمد اختبار المركز');
        await card.getByRole('button', { name: 'اعتماد الربط', exact: true }).click();
        await expect(card).toHaveCount(0);
    } finally { await staffContext.close(); }
    const { data: impostor } = await staff.rpc('open_doctor_manual_access', { p_request_id: device.id, p_token: 'b'.repeat(64) });
    expect(impostor.success).toBe(false);
    await page.getByRole('button', { name: 'متابعة طلبي / الدخول بعد الاعتماد' }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
    await page.goto('/doctor/new-request');
    await expect(page.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان المركز التجريبي الرئيسي');
    await page.getByLabel('اختر العيادة أو الفرع').selectOption({ label: 'فرع التجمع' });
    await expect(page.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان التجمع التجريبي');
    await staff.auth.signOut();
});
