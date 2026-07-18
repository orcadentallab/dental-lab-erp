# ملخص المشروع — Dental Lab ERP

آخر تحديث: 2026-07-18

## الهدف والحالة الحالية

`Dental Lab ERP` هو تطبيق ويب عربي RTL لإدارة معمل أسنان: الحالات والإنتاج، الأطباء وفروعهم، المعامل الخارجية، الحسابات، شؤون الموظفين، التقارير، ومتابعة الأطباء. يضم موقعاً تسويقياً عاماً على `/`، وERP داخلياً حسب الدور، وبوابة للطبيب.

التطبيق الأساسي مبني بـ React ويتصل مباشرةً بـ Supabase للمصادقة وPostgreSQL وRLS وTriggers وRPCs. فولدر `backend/` يحتوي خدمة Express مستقلة، لكنه ليس الـ backend الرئيسي للتطبيق.

## التقنيات

- React 19 وTypeScript 5.9 وVite 7 وReact Router 7 وTailwind CSS.
- Supabase JS للمصادقة والبيانات؛ منطق قاعدة البيانات في `supabase/migrations/`.
- Zod وFramer Motion وLucide وXLSX وjsPDF/html2canvas/react-to-print.
- Vitest (`npm test`) وPlaywright، مع إعدادات نشر Vercel وNetlify.

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

## مجالات النظام

- **الأوردرات والإنتاج:** تسجيل الحالات، الخدمات والأسنان، التصميم والمعمل الخارجي، الملفات، مواعيد التسليم، التعليقات، التاريخ، والتدقيق.
- **الأطباء:** ملفات CRM، دعم الفروع، الحسابات، تحليل الاحتفاظ، الشرائح، والمتابعة المجدولة.
- **المالية:** الحركات وكشوف الحسابات والأعمار واللقطات المالية وإعدادات الفوترة والالتزامات والتوزيع والمطابقة والتصدير والطباعة.
- **الخزن ووسائل التحصيل:** نقدي وبنوك وVodafone Cash وInstaPay وغيرها، تحويلات داخلية، مطابقة الأرصدة، ورسوم اختيارية.
- **الموظفون:** ملفات الموظفين والرواتب والعمولات والسلف والعهد والتسويات والحركات المرتبطة.
- **التقارير:** Dashboard والجودة والتحليلات وتقارير المشاكل وإحصاءات المصممين وAI والتحليلات التسويقية.

## الصلاحيات والمسارات

الأدوار هي: `admin` و`lab` و`representative` و`accountant` و`designer` و`doctor`. حماية المسارات في `src/App.tsx`، كما أن RLS وTriggers وRPCs جزء من الحماية الفعلية.

| المجال | المسارات | الوصول المعتاد |
| --- | --- | --- |
| التشغيل | `/dashboard`, `/orders`, `/quality` | أدمن ومعمل ومندوب؛ المصمم على Dashboard/Orders |
| الأطباء | `/doctors`, `/doctors/retention` | أدمن ومندوب |
| الحسابات والإعدادات | `/accounts`, `/settings` | حسب الدور؛ المصمم له accounts |
| الموظفون | `/employees`, `/employees/:id` | أدمن ومحاسب ومندوب |
| المالية | `/finance`, `/suppliers`, `/case-registration`, `/balance-snapshot`, `/statements`, `/aging-report` | أدمن ومحاسب |
| الإدارة | `/analytics`, `/ai-analytics`, `/users`, `/services`, `/issues-report`, `/marketing-analytics`, `/designer-stats` | أدمن |
| بوابة الطبيب | `/doctor/new-request`, `/doctor/my-orders`, `/doctor/account` | طبيب |

`/staff` يعيد التوجيه إلى `/employees`.

## الـ Workflow وبيانات الأوردر

حقل `orders.status` القديم ما زال مستخدماً، بجانب `production_status` و`issue_state`. تم تعديل مزامنة الـ workflow والـ guards بعد مرحلة WF-1 التوافقية.

- حالات الإنتاج تشمل `not_started` و`designing` و`in_production` و`try_in_ready` و`waiting_doctor` و`finalization` و`final_ready` و`final_delivered`.
- حالات المشاكل تفرق الآن بين الإرجاع والإلغاء ورفض الطبيب ورفض المعمل ومسارات redo. تم تحديث مزامنة status مع workflow في يوليو 2026.
- تعديلات المندوبين مدققة وتخضع لطبقة workflow permissions. اقرأ `docs/orders-field-permissions.md` قبل تعديل الأوردرات.
- الأوردرات تدعم روابط redo والتكاليف اليدوية/تكلفة التصميم/تكلفة رفض المعمل، وسجل الأحداث والتاريخ، واسم فرع الطبيب، والأرشفة والحذف الناعم (`is_deleted`).

الأوردرات والمالية مرتبطان بقوة: التسليم أو الإرجاع أو الرفض أو الإلغاء قد يؤثر في الالتزامات والأرصدة، لذلك أي تغيير في الـ workflow يحتاج مراجعة مالية.

## المالية والخزن

`financial_obligations` هو النموذج المنظم الأساسي لمستحقات الأطباء ومبالغ المعامل/الموردين، بجانب transactions. توجد إعدادات فوترة وتوقعات توزيع FIFO وbackfill تاريخي وreconciliation.

دعم الخزن (يوليو 2026) أضاف جداول `cashboxes` و`cashbox_transfers` و`cashbox_reconciliations`. يمكن ربط الحركات بخزنة أو بحركة رسوم مرتبطة. الأدمن يدير الخزن، والأدمن والمحاسب يمكنهما عرضها والتحويل والمطابقة حسب سياسات RLS.

## حالة قاعدة البيانات

الـ migrations تبدأ من `001_initial_schema.sql` وتمتد إلى migrations المؤرخة في يوليو 2026. أهم الإضافات الحديثة:

- 087–098: توسعة تدقيق الأوردرات، تشديد تعديلات المندوب، RLS للمالية، حالات الرفض، فروع الأطباء، analytics، وإصلاحات workflow.
- 2026-07-01: الحذف الناعم للأوردرات.
- 2026-07-05–06: إدارة الموظفين، إعدادات وتحليلات الاحتفاظ بالأطباء، RPC للمتابعة، وإصلاحات أمان/رؤية مرتبطة.
- 2026-07-11: تحديث ذري للأوردر، مزامنة redo/workflow، توسعة حقول الـ audit، وguards للمصممين.
- 2026-07-13: الخزن وأنواعها وإعدادات الرسوم/الادخار وتحديثاتها.

ملفات migrations الحالية هي المرجع؛ لا تعتمد على الملخص القديم الذي كان يعتبر migration 086 آخر migration.

## خريطة المستودع

- `src/App.tsx`: المسارات وصلاحيات الوصول.
- `src/pages/` و`src/pages/doctor/`: صفحات ERP وبوابة الطبيب.
- `src/components/orders/` و`src/components/finance/`: واجهات المزايا.
- `src/services/supabase/`: Queries وRPC wrappers.
- `src/services/db.ts` و`src/services/supabase/types.ts`: الأنواع والتحويل بين النطاق وقاعدة البيانات.
- `src/constants/` و`src/lib/` و`src/context/`: الثوابت والمنفعة والـ contexts.
- `supabase/migrations/`: schema وRLS والـ functions والـ triggers.
- `docs/`: أدلة الإعداد والنشر والأمان والـ workflow والتدقيق.
- `tests/` و`testsprite_tests/`: الاختبارات ومخرجاتها.

## التشغيل والتطوير

أضف `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` إلى `.env` ثم شغّل `npm run dev` (عادةً على `http://localhost:5173`). قبل النشر شغّل typecheck وlint والاختبارات المناسبة وbuild، وتأكد من تطبيق migrations وسياسات RLS المطلوبة.

للبدء في فهم المشروع:

1. `src/App.tsx` لفهم الصفحات والصلاحيات.
2. `src/services/db.ts` و`src/services/supabase/` لفهم حدود البيانات.
3. `docs/orders-field-permissions.md` وثوابت workflow قبل تعديل الأوردرات.
4. خدمات financial obligations والخزن قبل تغيير التسليم أو المدفوعات أو الأرصدة.
