# Project Summary - Dental Lab ERP

آخر تحديث: 2026-05-24

## 1. الهدف من المشروع

`Dental Lab ERP` هو نظام إدارة كامل لمعمل أسنان. الهدف منه تنظيم دورة الشغل اليومية من أول تسجيل الحالة، مروراً بالتصميم والإنتاج والمعمل الخارجي، ثم التسليم، الحسابات، التقارير، والمتابعة.

النظام معمول كـ Web App بواجهة عربية RTL، وفيه Portal داخلي للموظفين حسب الدور، وPortal منفصل للطبيب، وصفحة تسويقية عامة على `/`.

## 2. الصورة العامة الحالية

المشروع حالياً مبني كواجهة React تعتمد أساساً على Supabase في المصادقة وقاعدة البيانات والصلاحيات. يوجد Backend Express بسيط داخل فولدر `backend/` لكنه موثق على أنه standalone وغير مربوط بالتطبيق الرئيسي.

يوجد شغل واضح ومتقدم على:

- إدارة الأوردرات ودورة حالاتها.
- صلاحيات مفصلة حسب الدور.
- نظام مالي أكثر نضجاً يعتمد على الالتزامات المالية `financial_obligations`.
- Audit trail للأحداث المهمة على الأوردرات.
- Migration history كبير في Supabase حتى migration رقم `086`.
- اختبارات Playwright/TypeScript لبعض مسارات الـ workflow والمالية.
- مستندات تشغيل وتحليل داخل `docs/` وملفات مراجعة مالية/تشغيلية في جذر المشروع.

## 3. التقنيات المستخدمة

- Frontend: React 19 + TypeScript.
- Build tool: Vite 7.
- Routing: React Router 7.
- Styling: Tailwind CSS.
- Backend/Data/Auth: Supabase.
- Icons: lucide-react.
- Animation: framer-motion.
- Validation: zod.
- Excel import/export: xlsx.
- PDF/printing: jspdf, jspdf-autotable, html2canvas-pro, react-to-print.
- Tests: Playwright.
- Deployment config: Vercel و Netlify موجودين.

أوامر التشغيل الأساسية من `package.json`:

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run preview
```

## 4. هيكل المشروع

- `src/App.tsx`: تعريف كل Routes وصلاحيات الوصول للصفحات.
- `src/pages/`: صفحات التطبيق الرئيسية مثل Dashboard, Orders, Finance, Doctors.
- `src/pages/doctor/`: صفحات Portal الطبيب.
- `src/components/`: مكونات UI ومكونات متخصصة للأوردرات والمالية.
- `src/services/`: طبقة التعامل مع Supabase والخدمات المالية والتقارير.
- `src/services/supabase/`: Queries و RPC wrappers الخاصة بقاعدة البيانات.
- `src/constants/`: ثوابت دورة العمل، الحالات، الفواتير، الأحداث.
- `src/lib/`: صلاحيات، validation، utilities، Supabase client.
- `src/context/`: Auth, Theme, Language, Toast.
- `src/marketing/`: الموقع التسويقي العام.
- `supabase/migrations/`: كل تطورات قاعدة البيانات والسياسات والـ RPCs.
- `tests/`: اختبارات Playwright/TypeScript.
- `testsprite_tests/`: اختبارات/مخرجات TestSprite.
- `docs/`: أدلة إعداد، مواصفات، مراجعات، وخطط تشغيل.
- `backend/`: Express API بسيط مستقل وغير مستخدم كتطبيق رئيسي.

## 5. الأدوار والصلاحيات

الأدوار المعرفة في النظام:

- `admin`: صلاحيات كاملة تقريباً، إدارة النظام، المستخدمين، الخدمات، التقارير، الصلاحيات، والعمليات الحساسة.
- `lab`: متابعة حالات المعمل والإنتاج والجودة وبعض تحديثات الأوردرات.
- `representative`: إنشاء ومتابعة أوردرات الأطباء وإدارة الأطباء، مع قيود على تعديل الحقول الحساسة.
- `accountant`: المالية، الحسابات، الموردين، التسجيلات، وبعض إعدادات النظام.
- `designer`: التعامل مع التصميمات وحالات التصميم والاطلاع على الأوردرات المرتبطة.
- `doctor`: Portal للطبيب لمتابعة أوردراته، طلب أوردر جديد، ومراجعة حسابه.

حماية المسارات موجودة عبر `ProtectedRoute` في `src/App.tsx`. بعض الصلاحيات الحقيقية موجودة أيضاً في Supabase RLS و Triggers، وليس فقط في الواجهة.

## 6. الصفحات والمسارات

### صفحات عامة

- `/`: صفحة تسويقية للمعمل.
- `/login`: تسجيل الدخول.

### صفحات داخلية

- `/dashboard`: لوحة التحكم الرئيسية.
- `/orders`: إدارة الأوردرات.
- `/doctors`: إدارة الأطباء، متاحة غالباً للأدمن والمندوب.
- `/quality`: متابعة الجودة.
- `/accounts`: كشوف وحسابات الجهات، متاحة لأدوار متعددة.
- `/settings`: إعدادات النظام.
- `/staff`: شؤون الموظفين.
- `/finance`: الإدارة المالية.
- `/suppliers`: إدارة الموردين/المعامل الخارجية.
- `/case-registration`: تسجيل حالات.
- `/analytics`: تقارير وتحليلات.
- `/ai-analytics`: تحليلات بالذكاء الاصطناعي.
- `/users`: إدارة المستخدمين.
- `/services`: إدارة الخدمات والأسعار.
- `/marketing-analytics`: تحليلات التسويق.

### Portal الطبيب

- `/doctor/new-request`: طلب أوردر جديد.
- `/doctor/my-orders`: أوردرات الطبيب.
- `/doctor/account`: حساب الطبيب.

## 7. موديول الأوردرات

الأوردر هو قلب النظام. أهم بياناته:

- `caseId`: رقم/كود الحالة.
- `doctorId`: الطبيب.
- `patientName`: اسم المريض.
- `items`: الخدمات والأسنان والأسعار.
- `totalPrice`, `discount`, `cost`, `manualCost`.
- `status`: الحالة القديمة/الرئيسية المستخدمة في أجزاء كبيرة من النظام.
- `productionStatus`: حالة إنتاج جديدة shadow column.
- `issueState`: حالة مشكلة/استثناء جديدة shadow column.
- `supplierId`, `designerId`, `representativeId`.
- روابط الملفات: `stlUrl`, `imagesUrl`, `designUrl`.
- تواريخ التسليم المخطط والفعلي.
- تعليقات، feedback، statusHistory، وأحداث audit.

الحالات القديمة المهمة تشمل:

- Pending Review
- New Case
- Under Design
- Waiting Dr Approval
- Under Production
- Try In
- Try In Approved
- Ready
- Delivered
- Completed
- Returned for Adjustments
- Rejected
- Cancelled

الحالة الأحدث مقسومة إلى محورين:

Production status:

- `not_started`
- `designing`
- `in_production`
- `try_in_ready`
- `waiting_doctor`
- `finalization`
- `final_ready`
- `final_delivered`

Issue state:

- `none`
- `returned`
- `rejected`
- `cancelled`
- `on_hold`

هذه المرحلة موثقة كـ WF-1/WF-2 compatibility phase: النظام ما زال يحافظ على `orders.status` كمصدر أساسي في أجزاء كثيرة، مع وجود أعمدة shadow جديدة لتطوير الـ workflow.

## 8. دورة العمل Workflow

الدورة العامة:

1. إنشاء أوردر من الأدمن/المندوب أو طلب من الطبيب.
2. مراجعة الحالة وتحديد الطبيب، الخدمة، الأسنان، السعر، التكلفة، الأولوية، وتاريخ التسليم.
3. في حالة split workflow يمكن إسناد Designer و Lab/Supplier.
4. التصميم ينتقل بين pending, accepted, in_progress, waiting_approval, completed, returned.
5. الإنتاج ينتقل من التصميم إلى الإنتاج ثم Try-In أو Final Ready حسب نوع التسليم.
6. عند الوصول إلى Ready/Delivered تبدأ قواعد مالية معينة.
7. أي رجوع/رفض/إلغاء يتم تسجيله كـ issue state أو status مرتبط.
8. الأحداث المهمة تسجل في `order_events` و/أو `order_history`.

يوجد ملف مهم جداً للصلاحيات:

- `docs/orders-field-permissions.md`

هذا الملف يشرح من يقدر يعدل أي حقل، وما هي قيود الحالة، وكيف يعمل RPC الخاص بتعديلات المندوب:

- `rep_update_order_fields_with_audit`

ويوجد feature flag في Postgres:

- `app.workflow_strict_rep`

عندما يكون off، مسار المندوب القديم مستمر. عندما يصبح on، تعديلات المندوب المباشرة على الأوردرات يتم منعها إلا من خلال RPC audit-gated.

## 9. الموديول المالي

المالية في المشروع ليست مجرد transactions فقط. توجد طبقة أحدث اسمها `financial_obligations` لتتبع المستحقات والمدفوعات بشكل أدق.

الكيانات المالية:

- Doctor: مستحقات على الطبيب `receivable`.
- External Lab/Supplier: مستحقات للمعمل الخارجي `payable`.
- Designer: مذكور في الأنواع، لكن payable designer candidate حالياً يرجع null في الكود.

أنواع الالتزامات:

- `doctor_delivered`: عند تسليم الحالة للطبيب.
- `external_lab_ready`: عند جاهزية الحالة النهائية للمعمل الخارجي.
- `external_lab_issue_settlement`: تسوية مشاكل المعمل الخارجي.
- `designer_approved`: مخطط/محجوز.
- `manual_adjustment`: تسوية يدوية.

حالات الالتزام:

- unpaid
- partially_paid
- paid
- void
- written_off

يوجد دعم لـ:

- إعدادات فواتير لكل جهة `entity_billing_settings`.
- Due dates حسب per order أو monthly cycle.
- Allocation preview بطريقة FIFO.
- Historical obligations preview/backfill.
- Financial reconciliation preview.
- كشوف حسابات للأطباء والموردين.
- Excel/PDF/Print في أجزاء من النظام.

ملفات مهمة:

- `src/constants/financialObligations.ts`
- `src/services/supabase/financialObligations.ts`
- `src/services/supabase/allocationPreview.ts`
- `src/services/supabase/historicalObligationsPreview.ts`
- `src/services/supabase/historicalObligationsBackfill.ts`
- `src/services/supabase/financialReconciliationPreview.ts`
- `src/components/finance/*`

## 10. قاعدة البيانات Supabase

المشروع يعتمد على Supabase في:

- Authentication.
- PostgreSQL database.
- RLS Policies.
- RPC functions.
- Triggers.
- Edge Functions للذكاء الاصطناعي.

أهم الجداول/المفاهيم من الكود والمigrations:

- `users`
- `doctors`
- `suppliers`
- `services`
- `orders`
- `transactions`
- `order_history`
- `order_events`
- `financial_obligations`
- `entity_billing_settings`
- جداول/سياسات AI conversations و analytics حسب migrations.

المigrations كثيرة ومتدرجة من:

- `001_initial_schema.sql`

حتى:

- `086_add_production_status_and_issue_state_to_orders.sql`

يوجد أيضاً ملفات manual rollback/obsolete داخل `supabase/manual/`.

## 11. الذكاء الاصطناعي والتحليلات

يوجد موديول AI Analytics وخدمات Gemini:

- `src/pages/AIAnalytics.tsx`
- `src/services/gemini.ts`
- `supabase/functions/gemini-chat/index.ts`
- `supabase/functions/gemini-analyze/index.ts`

الغرض الظاهر:

- تحليل بيانات النظام.
- عرض insights.
- Chat interface للردود التحليلية.

## 12. الموقع التسويقي

المسار `/` يفتح Marketing Page منفصلة عن لوحة التحكم. الملفات في:

- `src/marketing/MarketingPage.tsx`
- `src/marketing/layout/MarketingLayout.tsx`
- `src/marketing/components/*`
- `public/marketing/*`

المحتوى يعتمد على صور حالات الأسنان والخدمات، مثل Zirconia, Emax, Veneers, Full Arch وغيرها.

## 13. الاختبارات والجودة

يوجد اختبارات في:

- `tests/*.spec.ts`
- `testsprite_tests/*`

اختبارات المشروع تغطي أجزاء مثل:

- app smoke.
- order lifecycle.
- order events.
- order display.
- financial obligations.
- billing settings.
- allocation preview.
- workflow helpers.

توجد أيضاً ملفات ناتجة عن Playwright:

- `playwright-report/`
- `test-results/`

مهم: قبل أي Release جدي، الأفضل تشغيل:

```bash
npm run typecheck
npm run lint
npm run build
npx playwright test
```

## 14. التشغيل المحلي

خطوات تشغيل مختصرة:

1. تثبيت dependencies:

```bash
npm install
```

2. إعداد `.env`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

3. تشغيل التطبيق:

```bash
npm run dev
```

4. التطبيق غالباً يعمل على:

```text
http://localhost:5173
```

يوجد دليل إعداد عربي مفصل:

- `docs/SETUP_GUIDE.md`

## 15. النشر Deployment

يوجد إعدادات جاهزة لـ:

- Vercel: `vercel.json`
- Netlify: `netlify.toml`

ويوجد Scripts مساعدة:

- `deploy.ps1`
- `run-deploy.ps1`
- `CLICK_TO_DEPLOY.bat`

قبل النشر:

- تأكد من `.env.production`.
- شغل typecheck/build.
- تأكد من Supabase migrations مطبقة.
- تأكد من RLS والسياسات.
- لا ترفع مفاتيح سرية داخل الكود.

## 16. ملفات ومستندات مهمة

- `docs/PRODUCT_SPEC.md`: مواصفات المنتج الأساسية.
- `docs/SETUP_GUIDE.md`: إعداد Supabase.
- `docs/orders-field-permissions.md`: مرجع صلاحيات حقول الأوردر.
- `docs/SECURITY_IMPROVEMENTS.md`: تحسينات أمنية.
- `docs/DEPLOY_CHECKLIST.md`: Checklist نشر.
- `docs/PROJECT_REVIEW_AR.md`: مراجعة عربية شاملة قديمة نسبياً.
- `docs/IMPROVEMENTS_SUMMARY.md`: ملخص تحسينات.
- `docs/EXCEL_IMPORT_GUIDE_AR.md`: دليل استيراد Excel.
- `docs/wf-1.5-verification-runbook.md`: تشغيل/تحقق workflow.
- `docs/wf-1.5-real-data-audit-runbook.md`: Audit على بيانات حقيقية.

ملفات تحليل مالية/تشغيلية في الجذر:

- `manual-review-resolution-plan.md`
- `allocation-manual-review-analysis.md`
- `delivery-obligation-trace.md`
- `root-cause-yellow-group.md`
- `status-change-path-audit.md`
- `historical-allocation-preview.md`
- `account-totals-current-vs-proposed.md`
- `targeted-cleanup-preview.md`

## 17. ملاحظات على الحالة الحالية

- يوجد ملف `PROJECT_SUMMARY.md` هذا كمرجع عام.
- يوجد تعديلات غير ملتزمة حالياً في Git على عدة ملفات خاصة بالـ workflow/order UI، لذلك أي تعديل كودي جديد لازم يتعامل بحذر مع الشغل الموجود.
- `backend/` موجود لكنه ليس المصدر الأساسي للتطبيق.
- النظام في مرحلة انتقال workflow: أعمدة `production_status` و `issue_state` موجودة، لكن أجزاء كثيرة ما زالت تعتمد على `status` القديم مع helpers للربط.
- الموديول المالي متقدم وفيه backfill/reconciliation، ويحتاج أي تغيير فيه إلى اختبارات قوية لأنه يؤثر على أرصدة العملاء والموردين.
- بعض مستندات المراجعة القديمة قد لا تعكس الحالة الحالية بالكامل، خصوصاً بعد migrations الجديدة وإزالة/تغيير بعض مشاكل الأمان.

## 18. الخلاصة التنفيذية

المشروع عبارة عن ERP متخصص لمعمل أسنان، وصل لمرحلة كبيرة من النضج الوظيفي: أوردرات، أطباء، موردين، مالية، حسابات، صلاحيات، تتبع أحداث، Workflow، وAI Analytics. أهم نقطة في فهم المشروع أن `orders` و `finance` مرتبطين بقوة: تغيير حالة الأوردر قد ينتج أو يلغي التزامات مالية، لذلك أي تعديل في حالات الأوردرات أو التسليم أو الرفض يجب مراجعته مع قواعد `financial_obligations`.

أفضل مدخل لأي مطور جديد:

1. اقرأ `src/App.tsx` لفهم المسارات والصلاحيات.
2. اقرأ `src/services/db.ts` لفهم الـ domain types وواجهة الخدمات.
3. اقرأ `docs/orders-field-permissions.md` قبل تعديل الأوردرات.
4. اقرأ `src/constants/orderLifecycle.ts` و `src/constants/financialObligations.ts` قبل تعديل الحالات أو المالية.
5. شغل typecheck/build/tests بعد أي تعديل يمس workflow أو finance.
