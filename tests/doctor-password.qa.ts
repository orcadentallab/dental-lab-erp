import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.skip(!process.env.DOCTOR_PORTAL_QA_ANON_KEY, 'Dedicated local QA database required.');
const password = 'Qatest08';
const uniquePhone = () => `010${70000000 + Math.floor(Math.random() * 9999999)}`;
const uniqueEmail = () => `doctor-password-${crypto.randomUUID()}@local.test`;
const client = () => createClient('http://127.0.0.1:56431', process.env.DOCTOR_PORTAL_QA_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function staffClient() {
    const staff = client();
    const { error } = await staff.auth.signInWithPassword({ email: 'doctor-codes-qa@local.test', password: 'local-qa-codes-only' });
    expect(error).toBeNull();
    return staff;
}
async function loginStaff(page: Page) {
    await page.goto('/login');
    await page.getByRole('button', { name: 'طاقم العمل', exact: true }).click();
    await page.getByPlaceholder('اسم المستخدم أو البريد الإلكتروني').fill('doctor-codes-qa@local.test');
    await page.locator('input[type="password"]').fill('local-qa-codes-only');
    await page.getByRole('button', { name: 'تسجيل دخول طاقم العمل' }).click();
    await expect(page).not.toHaveURL(/\/login$/);
}
async function credentials(page: Page, phone: string, email: string) {
    await page.getByLabel('رقم الموبايل', { exact: true }).fill(phone);
    await page.getByLabel('الإيميل', { exact: true }).fill(email);
    await page.getByLabel('كلمة المرور الجديدة', { exact: true }).fill(password);
    await page.getByLabel('تأكيد كلمة المرور', { exact: true }).fill(password);
}
async function profile(page: Page, name: string) {
    await page.getByRole('button', { name: 'استكمال بيانات العيادة', exact: true }).click();
    await page.getByLabel('اسم الطبيب أو المركز').fill(name);
    if (await page.getByLabel('منطقة العيادة الرئيسية').isEnabled()) await page.getByLabel('منطقة العيادة الرئيسية').selectOption('east_cairo');
    if (await page.getByLabel('عنوان العيادة الرئيسي', { exact: true }).getAttribute('readonly') === null) await page.getByLabel('عنوان العيادة الرئيسي', { exact: true }).fill('عنوان المركز التجريبي الرئيسي');
}

test('new center enters immediately and signs in from a fresh device with phone or email', async ({ page, browser }) => {
    const phone = uniquePhone(); const email = uniqueEmail();
    await page.goto('/login');
    await page.getByRole('button', { name: 'إنشاء حساب طبيب', exact: true }).click();
    await credentials(page, phone, email);
    await page.getByRole('button', { name: 'إظهار كلمة المرور الجديدة', exact: true }).click();
    await expect(page.getByLabel('كلمة المرور الجديدة', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'إخفاء كلمة المرور الجديدة', exact: true }).click();
    await expect(page.getByLabel('كلمة المرور الجديدة', { exact: true })).toHaveAttribute('type', 'password');
    await expect(page.getByText('8 أحرف على الأقل', { exact: true })).toBeVisible();
    await expect(page.getByText('يرجى إعادة إدخال كلمة المرور', { exact: true })).toBeVisible();
    await profile(page, 'د. مركز اختبار الباسوورد');
    await page.getByLabel('واتساب على رقم الدخول').check();
    await page.getByRole('button', { name: 'إضافة رقم تواصل', exact: true }).click();
    await page.getByLabel('رقم التواصل 2', { exact: true }).fill(uniquePhone());
    await page.getByLabel('صاحب رقم التواصل 2').selectOption('other_doctor');
    await page.getByLabel('اسم صاحب رقم التواصل 2').fill('د. محمد علي');
    await page.getByLabel('واتساب على رقم التواصل 2').check();
    await page.getByLabel('أنا مركز طبي يعمل به أكثر من طبيب').check();
    await page.getByRole('button', { name: 'إضافة طبيب للمركز' }).click();
    await page.getByLabel('اسم طبيب المركز 1').fill('محمد اختبار المركز');
    await page.getByLabel('هاتف طبيب المركز 1', { exact: true }).fill(uniquePhone());
    await page.getByLabel('واتساب على هاتف طبيب المركز 1').check();
    await page.getByLabel('لدي فروع إضافية أريد تسجيل عناوينها').check();
    await page.getByLabel('اسم الفرع 1').fill('فرع التجمع');
    await page.getByLabel('عنوان الفرع 1').fill('عنوان التجمع التجريبي');
    await page.getByLabel('رقم تليفون الفرع 1', { exact: true }).fill(uniquePhone());
    await page.getByLabel('صاحب رقم تليفون الفرع 1').selectOption('secretary');
    await page.getByLabel('واتساب على رقم تليفون الفرع 1').check();
    await page.getByRole('heading', { name: 'بيانات العيادة والحساب', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('clinic-registration.png') });
    await page.getByRole('button', { name: 'إنشاء الحساب والدخول', exact: true }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
    const staff = await staffClient();
    const { data: savedUser } = await staff.from('users').select('entity_id').eq('email', email).single();
    const { data: savedDoctor } = await staff.from('doctors').select('contact_phones,branches').eq('id', savedUser!.entity_id).single();
    expect(savedDoctor!.contact_phones[1]).toMatchObject({ ownerRole: 'other_doctor', ownerName: 'محمد علي', hasWhatsapp: true });
    expect(savedDoctor!.branches[0]).toMatchObject({ phoneOwnerRole: 'secretary', phoneHasWhatsapp: true });
    const { data: childDoctor } = await staff.from('doctors').select('contact_phones').eq('parent_id', savedUser!.entity_id).single();
    expect(childDoctor!.contact_phones[0]).toMatchObject({ ownerRole: 'doctor', ownerName: 'محمد اختبار المركز', hasWhatsapp: true });
    await staff.auth.signOut();
    await page.goto('/doctor/new-request');
    await expect(page.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان المركز التجريبي الرئيسي');
    await page.getByLabel('اختر العيادة أو الفرع').selectOption({ label: 'فرع التجمع' });
    await expect(page.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان التجمع التجريبي');
    await page.getByTitle('تسجيل الخروج', { exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    const freshContext = await browser.newContext();
    try {
        const fresh = await freshContext.newPage();
        await fresh.goto('http://127.0.0.1:5187/login');
        await fresh.getByLabel('الإيميل أو رقم الموبايل', { exact: true }).fill(phone);
        await fresh.getByLabel('كلمة المرور', { exact: true }).fill('wrong-password');
        await fresh.getByRole('button', { name: 'دخول الطبيب', exact: true }).click();
        await expect(fresh.getByRole('alert')).toContainText('بيانات الدخول غير صحيحة');
        await fresh.getByLabel('كلمة المرور', { exact: true }).fill(password);
        await fresh.getByRole('button', { name: 'دخول الطبيب', exact: true }).click();
        await expect(fresh).toHaveURL(/\/doctor\/my-orders$/);
    } finally { await freshContext.close(); }
    await page.getByLabel('الإيميل أو رقم الموبايل', { exact: true }).fill(email);
    await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'دخول الطبيب', exact: true }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
});

test('old doctor finds their name, waits for review, then uses the same password', async ({ page, browser }) => {
    const staff = await staffClient(); const phone = uniquePhone(); const email = uniqueEmail();
    const { data: doctor, error } = await staff.rpc('create_doctor_with_region_code', { p_profile: { name: 'طبيب اختبار الربط', phone, address: 'عنوان الطبيب القديم', code_region: 'other' } }).single();
    expect(error).toBeNull();
    await page.goto('/login');
    await page.getByRole('button', { name: 'إنشاء حساب طبيب', exact: true }).click();
    await page.getByLabel('نعم، لدي سجل عند المعمل').check();
    await credentials(page, phone, email);
    await page.getByRole('button', { name: 'البحث عن سجلي', exact: true }).click();
    await expect(page.getByLabel('اختر اسمك')).toHaveValue(doctor.id);
    await expect(page.getByText('سيتم تأكيد الربط بعد مراجعة المعمل', { exact: true })).toBeVisible();
    await profile(page, 'طبيب اختبار الربط');
    await expect(page.getByLabel('عنوان العيادة الرئيسي', { exact: true })).toHaveValue('عنوان الطبيب القديم');
    await expect(page.getByLabel('عنوان العيادة الرئيسي', { exact: true })).toHaveAttribute('readonly', '');
    await page.getByLabel('طلب تعديل عنوان العيادة الرئيسي').check();
    await page.getByLabel('العنوان المطلوب', { exact: true }).fill('عنوان جديد بعد مراجعة المعمل');
    await page.getByRole('button', { name: 'تسجيل الحساب وإرسال طلب الربط', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('قيد مراجعة المعمل');
    await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'دخول الطبيب', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('مراجعة');
    await expect(page).toHaveURL(/\/login$/);
    const { data: pending } = await staff.rpc('get_pending_doctor_password_registrations');
    const request = pending.find((item: { phone: string }) => item.phone === `2${phone}`);
    expect(request).toBeTruthy();
    expect(JSON.stringify(pending)).not.toContain(password);
    const staffContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5187' });
    try {
        const staffPage = await staffContext.newPage(); await loginStaff(staffPage);
        await staffPage.goto('/doctors');
        await staffPage.getByTitle('طلبات ربط أرقام الأطباء المعلقة').click();
        const card = staffPage.getByTestId(`doctor-link-request-${request.id}`);
        await expect(card).toContainText('طبيب اختبار الربط');
        await card.getByRole('button', { name: 'اعتماد الربط', exact: true }).click();
        await expect(card).toHaveCount(0);
        const { data: afterLink } = await staff.from('doctors').select('address').eq('id', doctor.id).single();
        expect(afterLink!.address).toBe('عنوان الطبيب القديم');
        const { data: queue } = await staff.rpc('get_pending_doctor_password_registrations');
        const addressRequest = queue.find((item: { address_update?: boolean; target_doctor_id: string }) => item.address_update && item.target_doctor_id === doctor.id);
        const addressCard = staffPage.getByTestId(`doctor-link-request-${addressRequest.id}`);
        await expect(addressCard).toContainText('عنوان جديد بعد مراجعة المعمل');
        await addressCard.getByRole('button', { name: 'اعتماد العنوان', exact: true }).click();
        await expect(addressCard).toHaveCount(0);
    } finally { await staffContext.close(); }
    await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'دخول الطبيب', exact: true }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
    await page.goto('/doctor/new-request');
    await expect(page.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان جديد بعد مراجعة المعمل');
    await staff.auth.signOut();
});

test('staff invitation links directly and cannot be reused', async ({ page, browser }) => {
    const staff = await staffClient(); const phone = uniquePhone(); const email = uniqueEmail();
    const letters = 'ابتجحخسشصضطظعغفقكلمنهوي';
    const suffix = Array.from({ length: 7 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    const name = `طبيب اختبار الدعوة ${suffix}`;
    const { error } = await staff.rpc('create_doctor_with_region_code', { p_profile: { name, phone, address: 'عنوان الطبيب المدعو', code_region: 'cairo' } });
    expect(error).toBeNull();
    await loginStaff(page); await page.goto('/doctors');
    await page.getByRole('button', { name: `دعوة تفعيل حساب ${name}`, exact: true }).click();
    const url = await page.getByLabel('رابط دعوة الطبيب', { exact: true }).inputValue();
    expect(url).toContain('doctor_invite=');
    const context = await browser.newContext();
    try {
        const doctorPage = await context.newPage(); await doctorPage.goto(url);
        await expect(doctorPage.getByText(`دعوة من ORCA لتفعيل حساب ${name}. التسجيل يربطك بسجلك مباشرة.`)).toBeVisible();
        await credentials(doctorPage, phone, email); await profile(doctorPage, name);
        await doctorPage.getByRole('button', { name: 'إنشاء الحساب والدخول', exact: true }).click();
        await expect(doctorPage).toHaveURL(/\/doctor\/my-orders$/);
        await doctorPage.goto('http://127.0.0.1:5187/doctor/new-request');
        await expect(doctorPage.getByLabel('عنوان العيادة / الشحن التفصيلي')).toHaveValue('عنوان الطبيب المدعو');
    } finally { await context.close(); }
    const reuseContext = await browser.newContext();
    try {
        const reuse = await reuseContext.newPage(); await reuse.goto(url);
        await expect(reuse.getByRole('alert')).toContainText('الدعوة غير صالحة');
    } finally { await reuseContext.close(); }
    await staff.auth.signOut();
});

test('raw Auth signup cannot bypass the reviewed registration flow', async () => {
    const api = client();
    const { data, error } = await api.auth.signUp({ email: uniqueEmail(), password });
    expect(error).not.toBeNull(); expect(data.session).toBeNull();
});

test('center child isolation, scan retry, private photos, monthly view and lab replies', async ({ page, browser }) => {
    const center = client(); const phone = uniquePhone(); const email = uniqueEmail(); const childPhone = uniquePhone(); const childEmail = uniqueEmail();
    const signup = await center.rpc('register_doctor_password_account', { p_phone: phone, p_email: email, p_password: password, p_intent: 'new', p_profile: { name: 'مركز اختبار العزل', address: 'عنوان مركز اختبار العزل', code_region: 'other', is_center: true, branches: [{ name: 'فرع العزل', address: 'عنوان فرع اختبار العزل', phone: uniquePhone() }], doctors: [{ name: 'أحمد اختبار العزل', phone: childPhone }, { name: 'محمد اختبار العزل', phone: uniquePhone() }] } });
    expect(signup.error).toBeNull(); expect(signup.data.status).toBe('approved');
    expect((await center.auth.signInWithPassword({ email, password })).error).toBeNull();
    const { data: ctx } = await center.rpc('get_doctor_portal_context');
    const child = ctx.members.find((member: { name: string }) => member.name === 'أحمد اختبار العزل');
    const sibling = ctx.members.find((member: { name: string }) => member.name === 'محمد اختبار العزل');
    const { data: invite, error: invitationError } = await center.rpc('create_doctor_portal_invitation', { p_doctor_id: child.id });
    expect(invitationError).toBeNull();
    const childApi = client();
    const linked = await childApi.rpc('register_doctor_password_account', { p_phone: childPhone, p_email: childEmail, p_password: password, p_intent: 'invited', p_invitation_token: invite.token, p_profile: { name: child.name, address: ctx.address, code_region: 'other' } });
    expect(linked.error).toBeNull(); expect(linked.data.status).toBe('approved');
    expect((await childApi.auth.signInWithPassword({ email: childEmail, password })).error).toBeNull();
    const payload = { doctor_id: sibling.id, patient_name: 'حالة الطبيب الآخر', intake_type: 'pickup', branch_id: ctx.branches[0].id, delivery_address: ctx.branches[0].address, contact_phone: ctx.branches[0].phone, items: [{ serviceType: 'زيركون — تجربة محلية', teethNumbers: ['11'], price: 1 }] };
    const other = await center.rpc('submit_doctor_portal_case', { p_request_key: crypto.randomUUID(), p_payload: payload });
    expect(other.error).toBeNull();
    await page.goto('/login'); await page.getByLabel('الإيميل أو رقم الموبايل', { exact: true }).fill(childPhone); await page.getByLabel('كلمة المرور', { exact: true }).fill(password); await page.getByRole('button', { name: 'دخول الطبيب', exact: true }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
    await expect(page.getByText('حالة الطبيب الآخر', { exact: true })).toHaveCount(0);
    await page.goto('/doctor/new-request');
    await page.getByRole('button', { name: 'حالة ديجيتال (STL)', exact: true }).click();
    await page.getByLabel('اختر العيادة أو الفرع').selectOption({ label: 'فرع العزل' });
    await page.getByLabel('اسم المريض / الحالة', { exact: true }).fill('حالة السكان الخاصة بي');
    await page.getByLabel('نوع الخدمة', { exact: true }).selectOption({ label: 'زيركون — تجربة محلية' });
    await page.getByLabel('أرقام الأسنان', { exact: true }).fill('11,12');
    await page.getByLabel('رفع ملفات السكان', { exact: true }).setInputFiles({ name: 'scan.stl', mimeType: 'application/octet-stream', buffer: Buffer.from('solid qa\nendsolid qa') });
    await page.locator('input[type=file][accept^="image/"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHf8AAAAASUVORK5CYII=', 'base64') });
    let failedOnce = false;
    await page.route('**/storage/v1/object/**', async route => { if (!failedOnce && route.request().method() === 'POST' && route.request().url().endsWith('_scan.stl')) { failedOnce = true; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"temporary test failure"}' }); } else await route.continue(); });
    await page.getByRole('button', { name: 'إرسال الحالة للمعمل', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('الحالة محفوظة');
    await page.getByRole('button', { name: 'إعادة رفع الملفات وإكمال الطلب', exact: true }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
    const ownCases = await childApi.rpc('get_doctor_portal_cases');
    expect(ownCases.data).toHaveLength(1); expect(ownCases.data[0].patient_name).toBe('حالة السكان الخاصة بي');
    const centerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5187' });
    try { const centerPage = await centerContext.newPage(); await centerPage.goto('/login'); await centerPage.getByLabel('الإيميل أو رقم الموبايل', { exact: true }).fill(email); await centerPage.getByLabel('كلمة المرور', { exact: true }).fill(password); await centerPage.getByRole('button', { name: 'دخول الطبيب', exact: true }).click(); await expect(centerPage.getByText('حالة الطبيب الآخر', { exact: true })).toBeVisible(); await expect(centerPage.getByText('حالة السكان الخاصة بي', { exact: true })).toBeVisible(); await centerPage.goto('/doctor/team'); await centerPage.getByRole('button', { name: 'دعوة الطبيب', exact: true }).click(); await expect(centerPage.getByLabel('رابط دعوة الطبيب', { exact: true })).toHaveValue(/doctor_invite=/); } finally { await centerContext.close(); }

    const centerCases = await center.rpc('get_doctor_portal_cases'); expect(centerCases.data).toHaveLength(2);
    expect(JSON.stringify(ownCases.data)).not.toContain('delivery_date'); expect(JSON.stringify(ownCases.data)).not.toContain('total_price');
    const { data: files, error: filesError } = await childApi.from('order_attachments').select('storage_path,storage_bucket').eq('order_id', ownCases.data[0].id);
    expect(filesError).toBeNull(); expect(files).toHaveLength(2);
    expect((await childApi.storage.from(files![0].storage_bucket).createSignedUrl(files![0].storage_path, 60)).error).toBeNull();
    const stranger = client(); const outsiderEmail = uniqueEmail();
    expect((await stranger.rpc('register_doctor_password_account', { p_phone: uniquePhone(), p_email: outsiderEmail, p_password: password, p_intent: 'new', p_profile: { name: 'طبيب غريب اختبار', address: 'عنوان طبيب غريب اختبار', code_region: 'other' } })).error).toBeNull();
    await stranger.auth.signInWithPassword({ email: outsiderEmail, password });
    expect((await stranger.storage.from(files![0].storage_bucket).createSignedUrl(files![0].storage_path, 60)).error).not.toBeNull();
    await page.goto('/doctor/account'); await expect(page.getByRole('button', { name: 'الشهر الحالي', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'الشهر السابق', exact: true }).click(); await expect(page.getByText('لا توجد حالات مسجلة محاسبيًا في هذا الشهر.', { exact: true })).toBeVisible();
    await page.goto(`/doctor/support?case=${ownCases.data[0].id}`); await page.getByLabel('رسالتك للمعمل').fill('استفسار اختبار السكان'); await page.getByRole('button', { name: 'إرسال الرسالة', exact: true }).click(); await expect(page.getByText('رسالتك وصلت، وبانتظار رد المعمل.', { exact: true })).toBeVisible();
    const staff = await staffClient(); const { data: inbox } = await staff.rpc('get_doctor_portal_staff_inbox'); const message = inbox.messages.find((item: { body: string }) => item.body === 'استفسار اختبار السكان');
    const staffContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5187' });
    try { const staffPage = await staffContext.newPage(); await loginStaff(staffPage); await staffPage.goto('/doctor-inbox'); await staffPage.getByLabel(`رد ${message.id}`).fill('الملفات وصلت وجاري مراجعة الحالة'); const form = staffPage.getByLabel(`رد ${message.id}`).locator('xpath=ancestor::form'); await form.getByRole('button', { name: 'إرسال الرد للطبيب' }).click(); await expect(staffPage.getByLabel(`رد ${message.id}`)).toHaveCount(0); } finally { await staffContext.close(); }
    await page.getByRole('button', { name: 'تحديث الردود' }).click(); await expect(page.getByText('رد المعمل: الملفات وصلت وجاري مراجعة الحالة', { exact: true })).toBeVisible();
    await Promise.all([center.auth.signOut(), childApi.auth.signOut(), staff.auth.signOut(), stranger.auth.signOut()]);
});

test('admin can still create staff and reset a doctor password with public signup disabled', async () => {
    const admin = await staffClient(); const staffEmail = uniqueEmail();
    const { data: authId, error: createError } = await admin.rpc('admin_create_password_auth_user', { p_email: staffEmail, p_password: password });
    expect(createError).toBeNull();
    const staff = client();
    const orphan = await staff.auth.signInWithPassword({ email: staffEmail, password });
    expect(orphan.error).not.toBeNull();
    const { error: insertError } = await admin.from('users').insert({ id: crypto.randomUUID(), auth_id: authId,
        username: `qa_staff_${crypto.randomUUID()}`, email: staffEmail, role: 'coordinator', name: 'موظف اختبار الباسوورد', is_active: true });
    expect(insertError).toBeNull();
    const { error: activationError } = await admin.rpc('admin_activate_password_auth_user', { p_auth_id: authId });
    expect(activationError).toBeNull();
    expect((await staff.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();
    const email = uniqueEmail(); const phone = uniquePhone();
    const { data: registration, error } = await admin.rpc('register_doctor_password_account', { p_phone: phone, p_email: email, p_password: password,
        p_profile: { name: 'طبيب اختبار الاستعادة', address: 'عنوان اختبار الاستعادة', code_region: 'other' }, p_intent: 'new' });
    expect(error).toBeNull(); expect(registration.status).toBe('approved');
    const { data: user } = await admin.from('users').select('id').eq('email', email).single();
    const nextPassword = 'local-reset-password-123';
    expect((await admin.rpc('admin_reset_password', { target_user_id: user!.id, new_password: nextPassword })).error).toBeNull();
    const doctor = client();
    expect((await doctor.auth.signInWithPassword({ email, password })).error).not.toBeNull();
    expect((await doctor.auth.signInWithPassword({ email, password: nextPassword })).error).toBeNull();
    expect((await admin.rpc('resolve_doctor_password_login', { p_phone: phone, p_password: nextPassword })).data.success).toBe(true);
    await Promise.all([admin.auth.signOut(), staff.auth.signOut(), doctor.auth.signOut()]);
});
