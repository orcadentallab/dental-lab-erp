import { createClient } from '@supabase/supabase-js';
// Synthetic local accounts only. No hosted URL or financial mutation path.
const url = 'http://127.0.0.1:56431';
if (!process.env.DOCTOR_PORTAL_QA_ANON_KEY) throw new Error('Local QA anon key is required');
const password = 'PortalQA8';
const api = () => createClient(url, process.env.DOCTOR_PORTAL_QA_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const center = api();
const centerEmail = 'portal-center-qa@local.test';
const centerName = 'مركز بوابة تجريبي';
const memberNames = ['أحمد طبيب تجريبي', 'محمد طبيب تجريبي'];
async function call(client, name, args = {}) { const { data, error } = await client.rpc(name, args); if (error) throw new Error(error.message); return data; }
if ((await center.auth.signInWithPassword({ email: centerEmail, password })).error) {
    const result = await call(center, 'register_doctor_password_account', { p_phone: '01066001000', p_email: centerEmail, p_password: password, p_intent: 'new',
        p_profile: { name: centerName, address: 'عنوان تجريبي للعيادة الرئيسية', code_region: 'other', is_center: true,
            branches: [{ name: 'فرع تجريبي', address: 'عنوان تجريبي لفرع المركز', phone: '01066001003', phoneOwnerRole: 'secretary', phoneHasWhatsapp: true }],
            doctors: [{ name: memberNames[0], phone: '01066001001' }, { name: memberNames[1], phone: '01066001002' }] } });
    if (!result.success) throw new Error(result.message);
    const login = await center.auth.signInWithPassword({ email: centerEmail, password }); if (login.error) throw new Error(login.error.message);
}
const context = await call(center, 'get_doctor_portal_context');
if (context.name !== centerName || !context.is_center) throw new Error('Unexpected local demo identity');
for (let index = 0; index < memberNames.length; index++) {
    const member = context.members.find(item => item.name === memberNames[index]);
    if (!member) throw new Error('Missing demo child');
    const child = api(); const email = index === 0 ? 'portal-ahmed-qa@local.test' : 'portal-mohamed-qa@local.test';
    if ((await child.auth.signInWithPassword({ email, password })).error) {
        const invitation = await call(center, 'create_doctor_portal_invitation', { p_doctor_id: member.id });
        const result = await call(child, 'register_doctor_password_account', { p_phone: member.phone, p_email: email, p_password: password, p_intent: 'invited', p_invitation_token: invitation.token,
            p_profile: { name: member.name, address: context.address, code_region: 'other' } });
        if (!result.success) throw new Error(result.message);
        const login = await child.auth.signInWithPassword({ email, password }); if (login.error) throw new Error(login.error.message);
    }
    if ((await call(child, 'get_doctor_portal_context')).doctor_id !== member.id) throw new Error('Unexpected child identity');
    await call(center, 'submit_doctor_portal_case', { p_request_key: `b0000000-0000-0000-0000-00000000000${index + 1}`, p_payload: {
        doctor_id: member.id, patient_name: index === 0 ? 'حالة أحمد التجريبية' : 'حالة محمد التجريبية', intake_type: index === 0 ? 'pickup' : 'digital',
        branch_id: context.branches[0].id, delivery_address: context.branches[0].address, contact_phone: context.branches[0].phone,
        pickup_timing: 'من 5 إلى 8 مساءً', trays_details: 'مقاس واحد وعضة', has_bite_record: true,
        stl_url: index === 1 ? 'https://example.test/demo-scan.stl' : '',
        items: [{ serviceType: 'زيركون — تجربة محلية', teethNumbers: ['11'], price: 0 }],
    } });
    await child.auth.signOut();
}
await center.auth.signOut();
process.stdout.write('Local demo ready: portal-center-qa@local.test, portal-ahmed-qa@local.test, portal-mohamed-qa@local.test. Password: PortalQA8\n');
