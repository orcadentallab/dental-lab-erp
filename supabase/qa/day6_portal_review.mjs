// Run against the isolated stack after applying day6_portal_review.sql.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
const url = process.env.DAY6_QA_UI_URL ?? 'http://127.0.0.1:5181';
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:56501';
assert.match(supabaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/, 'QA must use a local Supabase instance');
assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/, 'QA must use a local ERP frontend');
const pass = 'Day6-Local-QA-Only!';
const parentOrder = 'da570000-0000-4000-8000-000000000021';
async function client(username) {
  const supabase = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {auth:{persistSession:false}});
  const {error} = await supabase.auth.signInWithPassword({email:username+'@example.test',password:pass});
  assert.ifError(error);
  return supabase;
}
const stl = 'solid sample\n facet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\n endfacet\n endsolid sample\n';
const ply = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n';
const child = await client('d6_child1');
for (const [name, content] of [['review.stl',stl],['review.ply',ply]]) {
  const path = parentOrder+'/instruction/'+name;
  const { data: found, error: lookup } = await child.from('order_attachments').select('id').eq('storage_path',path).maybeSingle();
  assert.ifError(lookup);
  if (found) continue;
  const {error: upload} = await child.storage.from('case-scans').upload(path,Buffer.from(content),{contentType:'application/octet-stream'});
  if (upload && !/already exists/i.test(upload.message)) throw upload;
  const {error: row} = await child.from('order_attachments').insert({order_id:parentOrder,kind:'instruction',storage_path:path,storage_bucket:'case-scans'});
  assert.ifError(row);
}
const sibling = await client('d6_child2');
const {error: denied} = await sibling.storage.from('case-scans').createSignedUrl(parentOrder+'/instruction/review.stl',120);
assert.ok(denied);
console.log('Sibling signed URL denied');
const inactive = await client('d6_inactive');
const {data: inactiveOrders, error: inactiveError} = await inactive.rpc('get_doctor_portal_cases');
assert.ok(inactiveError || inactiveOrders?.length === 0);
console.log('Inactive account sees no cases');
const browser = await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  async function open(username, mobile=false) {
    const page = await browser.newPage(mobile ? { viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true } : {});
    await page.goto(url+'/login?intent=staff');
    await page.locator('#staff-username').fill(username+'@example.test');
    await page.locator('#staff-password').fill(pass);
    await page.locator('form').filter({has:page.locator('#staff-username')}).locator('button[type=submit]').click();
    await page.waitForURL(u=>u.pathname !== '/login', {timeout:15000});
    if (username !== 'd6_admin') {
      await page.goto(url+'/doctor/my-orders');
      await page.locator('button[lang="ar"]').click();
      await page.getByRole('heading',{name:'حالاتي ومتابعة الإنتاج'}).waitFor({timeout:15000});
    }
    return page;
  }
  for (const mobile of [false,true]) {
    const page = await open('d6_child1',mobile);
    await page.getByText('D6-CHILD-TRIAL',{exact:true}).waitFor();
    await page.getByText('عند الطبيب (تراي إن)',{exact:true}).first().waitFor();
    assert.equal(await page.getByText('D6-CHILD-FINAL',{exact:true}).count(),0);
    const caseButton = page.getByText('D6-CHILD-TRIAL',{exact:true});
    const caseCard = page.locator('.portal-card').filter({has:caseButton}).last();
    await caseCard.getByRole('button',{name:'ملفات الحالة',exact:true}).click();
    const files = caseCard.getByRole('region',{name:'ملفات الحالة'});
    for (const name of ['review.stl','review.ply']) {
      await files.getByRole('button',{name:'معاينة '+name}).click();
      await page.locator('dialog canvas').waitFor();
      assert.ok(await page.locator('dialog canvas').evaluate(canvas => canvas.width>0 && canvas.height>0));
      await page.getByRole('button',{name:'إغلاق المعاينة'}).click();
    }
    await page.locator('button[lang="en"]').click();
    await page.getByRole('heading',{name:'My cases and production tracking'}).waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
    const openFiles = caseCard.getByRole('button',{name:'Case files',exact:true});
    if (await openFiles.getAttribute('aria-expanded') === 'false') await openFiles.click();
    await caseCard.getByRole('button',{name:'Preview review.stl'}).click();
    await page.getByRole('dialog',{name:'3D scan preview'}).locator('canvas').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.close();
    console.log('STL/PLY opened in '+(mobile?'mobile viewport':'desktop viewport'));
  }
  const center = await open('d6_center');
  await center.getByText('D6-CHILD-TRIAL',{exact:true}).waitFor();
  await center.getByText('D6-CHILD-FINAL',{exact:true}).waitFor();
  assert.equal(await center.getByText('D6-SOLO-FINAL',{exact:true}).count(),0);
  await center.goto(url+'/doctor/account');
  await center.getByText(/D6-CHILD-FINAL/).waitFor();
  assert.equal(await center.getByText(/D6-CHILD-TRIAL|D6-SOLO-FINAL/).count(),0);
  const previousMonthResponse = center.waitForResponse(response => response.url().includes('/rpc/get_my_doctor_month'));
  await center.getByRole('button',{name:'الشهر السابق'}).click();
  assert.ok((await previousMonthResponse).ok());
  await center.getByRole('heading',{name:'حالات الشهر'}).waitFor();
  assert.equal(await center.getByText(/D6-CHILD-FINAL/).count(),0);
  console.log('Center sees both child cases; only delivered case enters current month');
  await center.goto(url+'/doctor/team');
  await center.getByRole('heading',{name:'أطباء المركز',exact:true}).waitFor();
  await center.getByText('طبيب الفرع الأول',{exact:true}).waitFor();
  await center.goto(url+'/doctor/new-request');
  await center.getByRole('heading',{name:'طلب حالة جديدة',exact:true}).waitFor();
  await center.getByLabel('اسم المريض / الحالة',{exact:true}).waitFor();
  await center.goto(url+'/doctor/support');
  await center.getByRole('heading',{name:'تواصل مع المعمل',exact:true}).waitFor();
  console.log('The new center team, case form and support pages open');
  const solo = await open('d6_solo');
  await solo.getByText('D6-SOLO-FINAL',{exact:true}).waitFor();
  assert.equal(await solo.getByText(/D6-CHILD-/).count(),0);
  await solo.close();
  const admin = await open('d6_admin');
  admin.on('response', async response => {
    if (response.url().includes('/rest/v1/') && response.status() >= 400)
      console.error(response.status(), new URL(response.url()).pathname, await response.text());
  });
  await admin.goto(url+'/production/shipments');
  const parcel = admin.locator('div')
    .filter({has:admin.getByText('D6-PACK-BRANCH',{exact:true})})
    .filter({has:admin.getByRole('button',{name:'تغليف منفرد'})});
  await parcel.last().getByRole('button',{name:'تغليف منفرد'}).click();
  await admin.getByText('تفاصيل اختيارية', {exact:true}).click();
  assert.match(await admin.locator('#shipment-recipient').inputValue(), /الفرع التجريبي/);
  assert.equal(await admin.locator('#shipment-phone').inputValue(),'01099069010');
  assert.equal(await admin.locator('#shipment-address').inputValue(),'عنوان فرع اليوم السادس');
  await admin.locator('#shipment-address').fill('عنوان بديل للمراجعة');
  assert.equal(await admin.locator('#shipment-address').inputValue(),'عنوان بديل للمراجعة');
  console.log('Shipping chooses the center branch contact and allows editing it');
  await admin.goto(url+'/reports/production-costing');
  await admin.getByRole('button',{name:/تكلفة الجودة/}).click();
  await admin.getByRole('heading',{name:'نتائج الفحص الفعلي'}).waitFor();
  await admin.getByRole('heading',{name:'البروفة',exact:true}).waitFor();
  await admin.getByRole('heading',{name:'النهائي',exact:true}).waitFor();
  console.log('Physical QC report shows separate trial and final results');
} finally {
  await browser.close();
}
