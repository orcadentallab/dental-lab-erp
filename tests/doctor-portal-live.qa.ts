import { expect, test } from '@playwright/test';

// Opt-in: only the dedicated disposable project on port 56431 is supported.
test.skip(!process.env.DOCTOR_PORTAL_QA_ANON_KEY, 'Seed the disposable local project and provide its anon key.');

test('real local OTP opens a doctor session and protected account pages', async ({ page }, testInfo) => {
    const phone = testInfo.project.name === 'mobile' ? '01066000002' : '01066000001';
    await page.goto('/login');
    await page.getByPlaceholder('01012345678').fill(phone);
    await page.getByRole('button', { name: 'دخول عبر رمز واتساب' }).click();
    await page.getByRole('button', { name: 'ملء تلقائي' }).click();
    await page.getByRole('button', { name: 'تأكيد الدخول' }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
    await expect(page.getByRole('navigation', { name: 'قائمة التنقل السفلية للطبيب' })).toBeVisible();
    await page.getByRole('link', { name: 'الحسابات', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'كشف الحساب والماليات' })).toBeVisible();
    await page.getByTitle('تسجيل الخروج').click();
    await expect(page).toHaveURL(/\/login$/);
});

test('new center registers doctors and branches, then selects shipping destination for digital intake', async ({ page }, testInfo) => {
    const phone = `010${String(80000000 + Math.floor(Math.random() * 9999999))}`;
    await page.goto('/login');
    await page.getByLabel('لا، أول تعامل — تسجيل طبيب جديد').check();
    await page.getByPlaceholder('01012345678').fill(phone);
    await page.getByRole('button', { name: 'دخول عبر رمز واتساب' }).click();
    await page.getByRole('button', { name: 'ملء تلقائي' }).click();
    await page.getByRole('button', { name: 'تأكيد الدخول' }).click();
    await expect(page.getByRole('heading', { name: 'تسجيل طبيب جديد' })).toBeVisible();
    await page.getByLabel('اسم الطبيب أو المركز').fill(testInfo.project.name === 'mobile' ? 'مركز اختبار الهاتف' : 'مركز اختبار الكمبيوتر');
    await page.getByLabel('منطقة العيادة الرئيسية').selectOption('east_cairo');
    await page.getByLabel('عنوان العيادة الرئيسي').fill('عنوان المركز الرئيسي التجريبي');
    await page.getByLabel('أنا مركز طبي يعمل به أكثر من طبيب').check();
    await page.getByRole('button', { name: 'إضافة طبيب للمركز' }).click();
    await page.getByLabel('اسم طبيب المركز 1').fill('طبيب المركز التجريبي');
    await page.getByLabel('لدي فروع إضافية أريد تسجيل عناوينها').check();
    await page.getByLabel('اسم الفرع 1').fill('فرع التجمع');
    await page.getByLabel('عنوان الفرع 1').fill('عنوان فرع التجمع التجريبي');
    await page.getByRole('button', { name: 'تسجيل الحساب والدخول' }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
    await page.goto('/doctor/new-request');
    await expect(page.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان المركز الرئيسي التجريبي');
    await expect(page.getByLabel('نوع الخدمة').locator('option')).not.toHaveCount(1);
    await page.getByLabel('اختر العيادة أو الفرع').selectOption({ label: 'فرع التجمع' });
    await expect(page.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان فرع التجمع التجريبي');
    await page.getByRole('button', { name: 'حالة ديجيتال (STL)' }).click();
    await expect(page.getByLabel('اختر العيادة أو الفرع')).toBeVisible();
    await expect(page.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان فرع التجمع التجريبي');
    await page.getByLabel('عنوان العيادة / الشحن التفصيلي').fill('عنوان شحن معدل لهذا الطلب');
    await page.getByLabel('نوع الخدمة').selectOption({ label: 'زيركون — تجربة محلية' });
    await expect(page.getByRole('button', { name: 'إرسال الحالة للمعمل' })).toBeEnabled();
});

test('lab staff saves a new doctor with a regional code and removes the title', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'طاقم العمل', exact: true }).click();
    await page.getByPlaceholder('اسم المستخدم أو البريد الإلكتروني').fill('doctor-codes-qa@local.test');
    await page.locator('input[type="password"]').fill('local-qa-codes-only');
    await page.getByRole('button', { name: 'تسجيل دخول طاقم العمل' }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    await page.goto('/doctors');
    await page.getByRole('button', { name: /إضافة طبيب/ }).first().click();
    const letters = 'ابتجحخسشصضطظعغفقكلمنهوي';
    const suffix = Array.from({ length: 6 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    const name = `${testInfo.project.name === 'mobile' ? 'أحمد اختبار الهاتف' : 'أحمد اختبار الكمبيوتر'} ${suffix}`;
    await page.getByLabel('اسم الطبيب', { exact: true }).fill(`د. ${name}`);
    await page.getByLabel('رقم الهاتف', { exact: true }).fill(`010${80000000 + Math.floor(Math.random() * 9999999)}`);
    await page.getByLabel('منطقة العيادة الرئيسية').selectOption('cairo');
    await page.getByLabel('العنوان', { exact: true }).fill('القاهرة عنوان العيادة التجريبي');
    await page.getByRole('button', { name: /حفظ/ }).last().click();
    const heading = page.getByRole('heading', { name, exact: true });
    await expect(heading).toBeVisible();
    const details = heading.locator('../..');
    await expect(details).toContainText(/1\d{3}/);
    await expect(details).not.toContainText(`د. ${name}`);
});
