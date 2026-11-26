import { expect, test, type Page } from '@playwright/test';

const phone = '01099998888';
const authId = '82000000-0000-0000-0000-000000000099';
const doctorId = '81000000-0000-0000-0000-000000000099';
const authUser = { id: authId, aud: 'authenticated', role: 'authenticated', email: 'doctor@local.test' };

async function mockBackend(page: Page, status: 'not_found' | 'pending_approval' | 'auto_linked' | 'wrong_code') {
    const claims: Record<string, unknown>[] = [];
    await page.route('http://127.0.0.1:56431/**', async route => {
        const url = new URL(route.request().url());
        let response: unknown = [];
        if (url.pathname.endsWith('/request_doctor_phone_otp')) {
            response = { success: true, normalized_phone: '201099998888', channel: 'mock', otp_code: '654321' };
        } else if (url.pathname.endsWith('/verify_and_link_doctor')) {
            response = {
                success: status !== 'wrong_code', status,
                message: status === 'wrong_code' ? 'رمز التحقق غير صحيح.' : 'تم التحقق من الهاتف.',
                claim_token: status === 'not_found' ? 'local-verified-phone-proof' : undefined,
                email: status === 'auto_linked' ? authUser.email : undefined,
                session_token: status === 'auto_linked' ? 'local-session-password' : undefined,
                doctor_name: 'طبيب الاختبار',
            };
        } else if (url.pathname.endsWith('/claim_doctor_code')) {
            claims.push(route.request().postDataJSON());
            response = { success: true, status: 'pending_approval', message: 'تم استلام طلب الربط للمراجعة.' };
        } else if (url.pathname === '/auth/v1/token') {
            const jwt = [
                Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
                Buffer.from(JSON.stringify({ sub: authId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
                'local-fixture-signature',
            ].join('.');
            response = { access_token: jwt, token_type: 'bearer', expires_in: 3600, refresh_token: 'local-refresh-token', user: authUser };
        } else if (url.pathname === '/auth/v1/user') {
            response = authUser;
        } else if (url.pathname === '/rest/v1/users') {
            response = { id: authId, auth_id: authId, username: 'local_doctor', name: 'طبيب الاختبار', role: 'doctor', entity_id: doctorId, is_active: true };
        } else if (url.pathname === '/rest/v1/doctors') {
            response = { id: doctorId, name: 'طبيب الاختبار', doctor_code: 'DOC-TEST', phone };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    return claims;
}

async function requestAndFillOtp(page: Page) {
    await page.goto('/login');
    await page.getByPlaceholder('01012345678').fill(phone);
    await page.getByRole('button', { name: 'دخول عبر رمز واتساب' }).click();
    await expect(page.getByText('رمز اختبار محلي؛ لم يتم إرسال رسالة واتساب.')).toBeVisible();
    await page.getByRole('button', { name: 'ملء تلقائي' }).click();
}

test('verified unknown phone can claim a code with its possession proof', async ({ page }) => {
    const claims = await mockBackend(page, 'not_found');
    await requestAndFillOtp(page);
    await page.getByRole('button', { name: 'تأكيد الدخول' }).click();
    await expect(page.getByText('طلب ربط حساب طبيب مسجل', { exact: true })).toBeVisible();
    await page.getByPlaceholder('مثال: DOC-102 أو 102').fill('DOC-TEST');
    await page.getByRole('button', { name: 'إرسال طلب الاعتماد' }).click();
    await expect(page.getByText('تم استلام طلب الربط للمراجعة.')).toBeVisible();
    expect(claims).toEqual([{ p_phone: phone, p_doctor_code: 'DOC-TEST', p_claim_token: 'local-verified-phone-proof' }]);
});

test('wrong OTP stays on login with an actionable error', async ({ page }) => {
    await mockBackend(page, 'wrong_code');
    await requestAndFillOtp(page);
    await page.getByRole('button', { name: 'تأكيد الدخول' }).click();
    await expect(page.getByText('رمز التحقق غير صحيح.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: /إعادة الإرسال بعد/ })).toBeDisabled();
});

test('pasting an Arabic six-digit OTP fills all boxes in order', async ({ page }) => {
    await mockBackend(page, 'wrong_code');
    await requestAndFillOtp(page);
    const firstDigit = page.getByRole('textbox', { name: 'الرقم 1 من رمز التحقق', exact: true });
    await firstDigit.evaluate(element => {
        const clipboard = new DataTransfer();
        clipboard.setData('text', '١٢٣٤٥٦');
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true }));
    });
    for (let index = 0; index < 6; index++) {
        await expect(page.getByRole('textbox', { name: `الرقم ${index + 1} من رمز التحقق`, exact: true })).toHaveValue(String(index + 1));
    }
    await expect(page.getByRole('button', { name: 'تأكيد الدخول' })).toBeEnabled();
});

test('shared account remains pending without entering the portal', async ({ page }) => {
    await mockBackend(page, 'pending_approval');
    await requestAndFillOtp(page);
    await page.getByRole('button', { name: 'تأكيد الدخول' }).click();
    await expect(page.getByText(/طلب ربط رقمك قيد مراجعة الإدارة/)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
});

test('linked doctor opens the protected portal and can log out', async ({ page }) => {
    await mockBackend(page, 'auto_linked');
    await requestAndFillOtp(page);
    await page.getByRole('button', { name: 'تأكيد الدخول' }).click();
    await expect(page).toHaveURL(/\/doctor\/my-orders$/);
    await expect(page.getByRole('navigation', { name: 'قائمة التنقل السفلية للطبيب' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.getByTitle('تسجيل الخروج').click();
    await expect(page).toHaveURL(/\/login$/);
});
