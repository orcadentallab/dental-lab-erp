# إعداد Preview منفصل عن Production

## الهدف

- رابط الموظفين يستمر من فرع `master` بدون تغيير.
- التجارب المشتركة تُرفع إلى فرع ثابت اسمه `preview`.
- ملف Preview لا يشغّل `supabase db push` ولا يرفع إلى `master`.
- بيانات Preview يجب أن تكون في مشروع Supabase Staging منفصل، وليس قاعدة الإنتاج.

## الإعداد الحالي المنفذ (27 أكتوبر 2026)

- Production Vercel: مشروع `orca` والرابط `orcalab.vercel.app` ويتابع `master`.
- Staging Vercel: مشروع `orca-staging` والرابط الأساسي
  `orca-dental-lab-staging.vercel.app` ويتابع `preview`.
- الرابط القديم `dental-lab-demo.vercel.app` ما زال Alias مؤقتًا لنفس مشروع
  Staging لتجنب كسر أي رابط محفوظ، وليس مشروع Demo منفصلًا.
- Production Supabase: مشروع `Orca ERP` ومرجعه يبدأ بـ `piui`.
- Staging Supabase: مشروع `Dental Lab ERP` ومرجعه يبدأ بـ `qutnam`.
- جميع migrations الحالية مطبقة على Staging، وآخر فحص رجع أن القاعدة up to date.
- متغيرا `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` في مشروع Vercel
  في مشروع Staging مسجلان كـConfig لنطاق Production الخاص بمشروع Staging، ويشيران
  إلى Staging فقط.

يمكن تغيير اسم مشروع Vercel Staging أو الدومين لاحقًا بدون تغيير فصل قواعد
البيانات، بشرط عدم نقل متغيرات Production من مشروع `orca` إليه.

## الخيار الأول: تجربة محلية فورية

شغّل:

`START_LOCAL_PREVIEW.bat`

الملف يشغّل Supabase المحلي، يطبق migrations محليًا، ثم يفتح Vite على:

`http://127.0.0.1:5173`

متغيرات Supabase تُمرر للعملية فقط ولا تُكتب في ملف ولا تُطبع المفاتيح. قاعدة
البيانات المحلية معزولة وقد تكون فارغة؛ إنشاء حسابات وبيانات اختبار محلية خطوة
منفصلة. لا تستخدم `.env` الحالي للاختبار إذا كان يشير إلى Production.

## الخيار الثاني: رابط Preview مشترك

### إعداد الاستضافة مرة واحدة

في Vercel:

1. اترك Production Branch = `master`.
2. أنشئ مشروع Supabase مستقلًا للـStaging وطبّق عليه migrations.
3. من Project Settings → Environment Variables أضف لقسم **Preview فقط**:
   - `VITE_SUPABASE_URL`: رابط مشروع Supabase Staging.
   - `VITE_SUPABASE_ANON_KEY`: anon key الخاص بـStaging.
4. تأكد أن قيم Production الحالية لا تزال مخصصة لـProduction.
5. لا تضع service-role key في Vercel أو في ملفات المشروع.

إذا كانت المتغيرات الحالية مفعلة لكل البيئات، افصل نطاقها أولًا؛ وإلا فرع
Preview سيتصل ببيانات الموظفين الحقيقية.

### النشر

1. تأكد أنك على فرع `preview`.
2. شغّل `CLICK_TO_DEPLOY_PREVIEW.bat`.
3. الملف ينفذ typecheck وlint وunit tests وbuild.
4. يعرض الملفات، ويطلب كتابة `DEPLOY PREVIEW` قبل staging/commit.
5. يستبعد مجلدات النتائج والنسخ المؤقتة.
6. يدمج آخر `origin/master` ثم يعيد typecheck/build.
7. يدفع إلى `origin/preview` فقط.

بعد الـpush ستنشئ Vercel أو Netlify رابطًا غير إنتاجي للفرع. خذ الرابط من
صفحة Deployments ولا تضف له production domain.

## الفرق عن ملف Production الحالي

`CLICK_TO_DEPLOY.bat` الحالي يشغّل migrations ثم يدفع إلى `master`، ولذلك لا
يُستخدم للتجربة. ملف Preview الجديد لا يلمس قاعدة Production أو فرع `master`.

## ترتيب Workflow V2 الآمن

1. اختبر الكود والمigrations محليًا.
2. طبّق migrations على Supabase Staging.
3. ارفع الكود إلى فرع `preview` واختبر الرابط المشترك.
4. بعد نجاح الاختبارات، انشر كود Production وم migrations بالتسلسل المتفق عليه.
5. لا تُطفئ `workflow_status_legacy_mirror` أثناء Preview.
