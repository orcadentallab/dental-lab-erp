import {test,expect,type Page,type Browser} from '@playwright/test';
import {isolatedDesignHtml} from '../src/lib/designPreview';
const orderId=process.env.DESIGN_QC_ORDER_ID!;
const caseId=`QC-BROWSER-${orderId}`;
async function signIn(browser:Browser,n:number){
 const context=await browser.newContext({baseURL:'http://127.0.0.1:5192',viewport:{width:1280,height:850}});
 const page=await context.newPage();
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
 await page.goto('/login');
 await page.getByRole('button',{name:'طاقم العمل',exact:true}).click();
 await page.locator('input[type="text"],input[type="email"]').first().fill(`qc_browser_${n}`);
 await page.locator('input[type="password"]').fill('Local-QC-Only-2026!');
 await page.locator('button[type="submit"]').click();
 await expect(page).not.toHaveURL(/\/login$/);
 await page.goto(`/design-qc?order=${orderId}`);
 await expect(page.getByRole('heading',{name:'ملفات التصميم وDesign QC',level:1,exact:true})).toBeVisible();
 return {page,context};
}
function zip(comment:string){const header=Buffer.alloc(22);header.writeUInt32LE(0x06054b50,0);header.writeUInt16LE(Buffer.byteLength(comment),20);return Buffer.concat([header,Buffer.from(comment)]);}
async function submit(page:Page,version:number){
 await page.getByLabel('رابط حزمة التنفيذ الكاملة',{exact:true}).fill('https://files.example.test/reference-only');
 await page.getByLabel('نسخة ZIP ثابتة من ملفات التنفيذ',{exact:true}).setInputFiles({name:'execution.zip',mimeType:'application/zip',buffer:zip(`synthetic revision ${version}`)});
 await page.getByLabel('معاينة HTML مستقلة',{exact:true}).setInputFiles({name:'preview.html',mimeType:'text/html',buffer:Buffer.from('<html><body><h1>معاينة اصطناعية</h1><script>document.body.dataset.rendered="yes"</script></body></html>')});
 await page.getByRole('button',{name:'حفظ نسخة الملفات',exact:true}).click();
 await expect(page.getByRole('heading',{name:`النسخة الحالية ${version}`,exact:true})).toBeVisible();
}
async function localApi(page:Page,path:string,method='POST',body:unknown={},contentType='application/json'){
 return page.evaluate(async args=>{
  const key=Object.keys(localStorage).find(k=>k.endsWith('-auth-token'));
  if(!key)throw new Error('Missing local test session');
  const session=JSON.parse(localStorage.getItem(key)!);
  const response=await fetch(`http://127.0.0.1:56501/${args.path}`,{method:args.method,headers:{Authorization:`Bearer ${session.access_token}`,apikey:args.anon,'Content-Type':args.contentType},...(args.method==='GET'?{}:{body:args.contentType==='application/zip'?new Uint8Array(args.body as number[]):JSON.stringify(args.body)})});
  const text=await response.text();let data:unknown;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data};
 },{path,method,body,contentType,anon:process.env.DESIGN_QC_ANON_KEY!});
}
test('real local API: switch, immutable upload, approval, rejection, bypass and priced handoff',async({browser})=>{
 const admin=await signIn(browser,1);const page=admin.page;
 await expect(page.getByText('Design QC موقوف حتى يعيد الأدمن تشغيله',{exact:true})).toBeVisible();
 await page.getByLabel('سبب تشغيل أو إيقاف المراجعة').fill('Synthetic local acceptance');
 await page.getByRole('button',{name:'تشغيل Design QC',exact:true}).click();
 await expect(page.getByText('Design QC مفعّل',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByText('Design QC مفعّل',{exact:true})).toBeVisible();
 await submit(page,1);
 await page.getByRole('button',{name:'فتح المعاينة المعزولة',exact:true}).click();
 await expect(page.frameLocator('iframe[title="معاينة التصميم المعزولة"]').getByRole('heading',{name:'معاينة اصطناعية'})).toBeVisible();
 await expect(page.locator('iframe')).toHaveAttribute('sandbox','allow-scripts');
 await page.getByRole('button',{name:'إغلاق المعاينة',exact:true}).click();
 await page.getByRole('button',{name:'موافقة على النسخة',exact:true}).click();
 await expect(page.getByRole('button',{name:`${caseId} · معتمد`,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'إرسال للتنفيذ',exact:true}).click();
 await submit(page,2);
 await page.getByLabel('ملاحظات القرار أو سبب التجاوز').fill('Contacts require amendment');
 await page.getByRole('button',{name:'رفض النسخة',exact:true}).click();
 await expect(page.getByRole('button',{name:`${caseId} · مرفوض — متابعة مطلوبة`,exact:true})).toBeVisible();
 const coordinator=await signIn(browser,2);
 await expect(coordinator.page.getByRole('button',{name:'تشغيل Design QC',exact:true})).toHaveCount(0);
 await coordinator.page.getByLabel('ملاحظات القرار أو سبب التجاوز').fill('Cannot bypass rejected bytes');
 await coordinator.page.getByRole('button',{name:'تجاوز موثّق',exact:true}).click();
 await expect(coordinator.page.getByRole('alert')).toContainText('لا يمكن تجاوز ملفات سبق رفضها');
 await submit(page,3);
 await coordinator.page.reload();
 await coordinator.page.getByLabel('ملاحظات القرار أو سبب التجاوز').fill('Documented urgent exception');
 await coordinator.page.getByRole('button',{name:'تجاوز موثّق',exact:true}).click();
 await expect(coordinator.page.getByRole('button',{name:`${caseId} · تجاوز ينتظر مراجعة الأدمن`,exact:true})).toBeVisible();
 await page.reload();
 await page.getByLabel('ملاحظات القرار أو سبب التجاوز').fill('Later admin review rejection');
 await page.getByRole('button',{name:'رفض النسخة',exact:true}).click();
 await expect(page.getByText('رفض بعد تجاوز: مطلوب متابعة المنسق. لم يتم إيقاف الإنتاج تلقائيًا.',{exact:true})).toBeVisible();
 const filePath=await localApi(page,'rest/v1/rpc/get_design_execution_path','POST',{p_order_id:orderId});
 expect(filePath.status).toBe(200);
 const overwrite=await localApi(page,`storage/v1/object/design-qc-files/${String(filePath.data)}`,'PUT',Array.from(zip('attempt overwrite approved bytes')),'application/zip');
 expect(overwrite.status).toBeGreaterThanOrEqual(400);
 expect(JSON.stringify(overwrite.data)).toMatch(/row-level security|not allowed|Unauthorized|permission/i);
 const existingFile=await localApi(page,`storage/v1/object/sign/design-qc-files/${String(filePath.data)}`,'POST',{expiresIn:60});
 expect(existingFile.status).toBe(200);
 await page.getByLabel('المصمم البديل',{exact:true}).selectOption('fc000000-0000-0000-0000-000000000004');
 await page.getByLabel('المستحق النهائي للمصمم السابق (ج.م)',{exact:true}).fill('80');
 await page.getByLabel('تعديل أجر البديل (اختياري)',{exact:true}).fill('90');
 await page.getByRole('button',{name:'تأكيد التسوية وإعادة التكليف',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveCount(0);
 await page.screenshot({path:'.tmp/design-qc-admin.png',fullPage:true});
 await page.setViewportSize({width:375,height:812});
 await expect.poll(()=>page.locator('#dashboard-sidebar').evaluate(el=>el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(375);
 await page.locator('#dashboard-main').evaluate(el=>el.scrollTo(0,0));
 await expect(page.getByRole('heading',{name:'ملفات التصميم وDesign QC',level:1,exact:true})).toBeVisible();
 await page.screenshot({path:'.tmp/design-qc-mobile.png',fullPage:true,animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const former=await signIn(browser,3);
 await expect(former.page.getByRole('alert')).toContainText('لم يعد لديك صلاحية');
 const deniedFile=await localApi(former.page,`storage/v1/object/sign/design-qc-files/${String(filePath.data)}`,'POST',{expiresIn:60});
 expect(deniedFile.status).toBeGreaterThanOrEqual(400);
 await former.page.goto('/accounts?tab=designers&entity=fc000000-0000-0000-0000-000000000003&mode=detail');
 await expect(former.page.getByText(/تصميم سابق/).first()).toBeVisible().catch(async error=>{await former.page.screenshot({path:'.tmp/design-qc-former-account.png',fullPage:true});throw error;});
 await coordinator.context.close();await former.context.close();await admin.context.close();
});
for(const width of [375,1280])test(`opaque HTML sandbox protects ERP credentials at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:812});
 await page.goto('/login');
 await page.evaluate(()=>localStorage.setItem('qc-session-canary','private-session-value'));
 const leaks:string[]=[];page.on('request',r=>{if(r.url().includes('qc-leak'))leaks.push(r.url());});
 await page.evaluate(html=>{const frame=document.createElement('iframe');frame.title='isolation probe';frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=html;document.body.appendChild(frame);},isolatedDesignHtml('<html><body><script>try{document.body.textContent=parent.localStorage.getItem("qc-session-canary")}catch(e){document.body.textContent="parent blocked"}fetch("http://127.0.0.1:5192/qc-leak").catch(()=>{});</script></body></html>'));
 await expect(page.frameLocator('iframe[title="isolation probe"]').getByText('parent blocked',{exact:true})).toBeVisible();
 expect(leaks).toEqual([]);
});
