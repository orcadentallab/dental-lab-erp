# خطة استكمال نظام مشاكل الطلبات V2 وتقاعد `orders.status`

> تاريخ نقطة الأساس: 2026-08-12  
> استخدم هذا الملف كنقطة البداية في شات جديد. لا تعِد تنفيذ migrations أو backfills المكتملة.

## الهدف المتبقي

أصبح `production_status` و`issue_state` هما محورا دورة العمل والمشاكل. المتبقي هو إزالة اعتماد النظام تدريجيًا على `orders.status` القديم، ثم إيقاف مرآته وحذف العمود في migration نهائية منفصلة، بدون تغيير تاريخ الطلبات أو حساب أي طبيب/معمل/مصمم.

## الوضع المثبت حاليًا

- نظام Issue Workflow V2 والـRPCs والـDB guards مطبقة على الإنتاج.
- `workflow_issue_v2_shadow_read=on`.
- `workflow_issue_v2_write=on`.
- `workflow_issue_v2_enforce=on`.
- `workflow_finance_v2=on`.
- `workflow_accounting_audit_v2=on`.
- `workflow_status_legacy_mirror=on` وما زال مطلوبًا للـcompatibility الحالي.
- migration `20260808005000_order_issue_v2_client_cutover.sql` مطبقة ومسجلة remote:
  - سياسات الطبيب المباشرة على `orders` أزيلت.
  - INSERT المباشر لـ`authenticated` على `order_events` أُلغي.
  - تطبيق الطبيب يستخدم RPCs ذات allow-list.
- migration `20260812003000_repair_accounting_queue_after_lifecycle_backfill.sql` مطبقة ومسجلة remote.
- طابور التسجيل صُحح يدويًا ثم ثُبتت الحماية الدائمة:
  - وقت التحقق كان 20 طلبًا بعلم إعادة المراجعة، منها 16 ظاهرة.
  - كان هناك 7 طلبات تسجيل جديد، لذلك عرضت الواجهة 23.
  - الرقم تشغيلي ويتغير مع العمل اليومي؛ لا يُستخدم لاحقًا كـassertion ثابت.
- الحالتان `6009-260611-501` و`3003-260729-524` بقيتا مراجعتين حقيقيتين عمدًا.
- unresolved lifecycle timing = 0.
- unresolved legacy rejection = 0.
- commitان أساسيان لهذه النقطة:
  - `7893e1b` إصلاح طابور المراجعة المحاسبية.
  - `6c82114` حواجز client cutover النهائية.
- آخر تحقق:
  - V2 + RLS database tests: 73/73.
  - TypeScript typecheck: ناجح.
  - production build: ناجح.
  - Vercel deployment: ناجح.

## ملاحظات لا يجب فقدها

- لا تشغّل `build_order_accounting_snapshot` جماعيًا على production. استدعاؤه على نحو ألف طلب تسبب في إنهاك قاعدة Supabase وconnection timeouts.
- أي فحص إنتاجي كبير يجب أن يحتوي `statement_timeout` و`lock_timeout` قصيرين.
- لا تستخدم `ALTER TABLE ... DISABLE TRIGGER` في إصلاح metadata حي؛ يأخذ `ACCESS EXCLUSIVE` lock. عند الضرورة المراجعة استخدمت `SET LOCAL session_replication_role=replica` داخل transaction محمية، لكن لا يُعاد استخدامها بلا assertions دقيقة.
- لا تعِد تشغيل إصلاح الـ1018 صفًا؛ تم بالفعل، والـmigration الحالية ترى صفر candidates.
- لا تغير التزامات مالية أثناء تقاعد `status`. كل مرحلة تحفظ baseline داخل transaction وتقارن قبل/بعد.
- فرق الالتزامات الذي ظهر أثناء العمل كان بسبب انتقال حقيقي للطلب `3003-260729-524` نفذته Azza كـredo، وليس بسبب إصلاح الطابور.
- اترك `supabase/.temp/cli-latest` خارج أي commit؛ هو تغيير محلي غير متعلق بالمشروع.

## المرحلة 0: استعادة test baseline قابل للتكرار

قبل تعديل `status`:

1. شغّل العمل في branch جديد باسم يبدأ بـ`codex/`.
2. أنشئ قاعدة Docker نظيفة أو أصلح مسار reset بدون تخطي صامت لم migrations إنتاجية.
3. سجّل failures الحالية قبل تعديلها:
   - targeted V2/RLS ناجحة.
   - full DB suite على قاعدة Docker الحالية ملوثة بحالة reset سابقة وflags متروكة.
   - unit tests القديمة بها assertions مرتبطة بنسخ/placeholder migrations قديمة؛ لا تعدلها فقط لجعل اللون أخضر.
4. المطلوب هو baseline موثوق: إما fresh database تعيد كل migrations بنجاح، أو test bootstrap صريح يضبط flags المطلوبة داخل transaction كل اختبار.
5. ممنوع اعتبار فشل قديم نجاحًا، وممنوع توسيع نطاق إصلاح tests المالية بدون تقرير سبب منفصل.

بوابة الخروج:

- V2/RLS المستهدفة ناجحة.
- typecheck وbuild ناجحان.
- قائمة failures غير المتعلقة موثقة ومفصولة، أو full suite نظيفة.

## المرحلة 1: جرد كل اعتماد على `status`

### جرد الكود

استخدم `rg` على الأقل في:

- `src/`
- `supabase/migrations/`
- `supabase/tests/`
- SQL/RPC names والتقارير والخدمات المالية.

صنّف كل occurrence إلى:

1. كتابة business state قديمة.
2. قراءة لاتخاذ قرار business.
3. presentation label فقط.
4. filter/report/accounting.
5. legacy compatibility أو historical import.
6. test fixture.

### جرد قاعدة البيانات الحية

نفّذ read-only catalog audit للدوال والـviews والـtriggers والسياسات التي تعتمد على العمود، مثل:

```sql
SELECT dependent_ns.nspname,
       dependent.relname,
       pg_get_viewdef(dependent.oid, true)
FROM pg_depend dependency
JOIN pg_rewrite rewrite ON rewrite.oid = dependency.objid
JOIN pg_class dependent ON dependent.oid = rewrite.ev_class
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent.relnamespace
WHERE dependency.refobjid = 'public.orders'::regclass
  AND dependency.refobjsubid = (
      SELECT ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'status'
  );
```

وأضف فحصًا نصيًا لتعريفات `pg_proc` و`pg_trigger` و`pg_policies` لأن بعض الاعتمادات الديناميكية لا تظهر كـdependency مباشر.

بوابة الخروج:

- ملف inventory يحتوي كل قراءة وكتابة ومالكها وخطة استبدالها.
- لا يبدأ حذف أو إيقاف mirror قبل إغلاق كل عناصر inventory.

## المرحلة 2: تعريف مشتق واحد للحالة القديمة

أنشئ helper مركزيًا في SQL وTypeScript يشتق العرض القديم من:

- `production_status`
- `issue_state`
- أدلة lifecycle عند الحاجة فقط.

لا تفترض mapping من الذاكرة. استخرج أولًا كل القيم الحية لـ`production_status`, `issue_state`, `status` وتقاطعها، ثم اعتمد mapping مراجَعًا.

قواعد ثابتة معروفة:

- `cancelled` يمثل الإلغاء قبل أول تسليم.
- `lab_rejected` يمثل رفض المعمل قبل تسليم التصميم/التسليم النهائي.
- `doctor_rejected` و`redo` حالات لاحقة للتسليم.
- `returned` رجوع للتعديل بعد التسليم.
- عرض `redo` يجب أن يظل «إعادة إنتاج» حتى لو كانت قيمة legacy سابقًا `Doctor Rejected`.
- لا تُخترع تواريخ تسليم للحالات legacy المؤكدة بـ`legacy_delivery_confirmed`.

بوابة الخروج:

- helper واحدة لكل طبقة بدل شروط متناثرة.
- tests تغطي كل تركيبة مسموحة ومحظورة.

## المرحلة 3: إزالة قراءات وكتابات runtime القديمة

بالترتيب:

1. RPCs وtriggers التي ما زالت تكتب `status` مباشرة.
2. خدمات الطلبات في TypeScript.
3. قرارات المحاسبة والالتزامات والتقارير.
4. filters والـbadges والعرض.
5. imports والتوافق التاريخي.
6. fixtures والاختبارات.

أثناء هذه المرحلة يظل `workflow_status_legacy_mirror=on`، لكن:

- لا يوجد business decision يعتمد على `status` وحده.
- الكتابة الأصلية تكون للمحورين الجديدين فقط.
- mirror هي المالك الوحيد المؤقت لقيمة `status`.
- لا تستخدم `status='Rejected'` لتحديد النوع المالي؛ النوع يأتي من `issue_state` والأدلة التاريخية المعتمدة.

قبول مالي إلزامي:

- `cancelled` و`lab_rejected` لا يتركان التزامًا نشطًا.
- `doctor_rejected` و`redo` يحافظان على القرار المالي المراجع.
- `decide_later` يبقي الطبيب متحملًا كامل السعر مؤقتًا حسب قرار المنتج الحالي، ولا يُغيّر هذا السلوك أثناء تقاعد `status`.
- `manual_design_price` يظل المصدر اليدوي الفعلي.
- `is_archived` وحده لا يغير الالتزامات.

## المرحلة 4: parity audit قبل إيقاف المرآة

أنشئ report/read-only view تعرض لكل طلب:

- `order_id`, `case_id`
- `status` الحالي
- القيمة المشتقة من المحورين الجديدين
- mismatch reason
- هل الحالة legacy مؤكدة بدون تاريخ
- هل يوجد أثر مالي متوقع مختلف

قواعد التشغيل:

- لا تستخدم bulk accounting snapshot function.
- شغّل التقارير بدفعات صغيرة وبـtimeouts.
- أي حالة غير قابلة للاستنتاج تذهب إلى review table؛ لا يوجد تحويل افتراضي.
- افصل mismatch presentation عن mismatch مالي.

بوابة الإيقاف يجب أن تعود بصفر:

- runtime writes المباشرة إلى `status`.
- runtime business reads من `status`.
- dependencies غير المعالجة في views/functions/triggers/RLS.
- parity mismatches غير المفسرة.
- unresolved legacy rows.
- فروق مالية غير مفسرة.

## المرحلة 5: إيقاف `workflow_status_legacy_mirror`

تُنفذ كمرحلة مستقلة قابلة للrollback:

1. staging أولًا.
2. admin pilot.
3. representative pilot.
4. مراقبة logs وRPC 400s وتقارير parity.
5. production full rollout.

قبل الإيقاف:

- وثّق SQL لإعادة flag إلى `on`.
- تأكد أن إعادة التشغيل لا تصطدم constraints جديدة.
- خذ counts وfinancial reconciliation baseline.

بعد الإيقاف:

- اترك العمود موجودًا read-only لفترة مراقبة.
- لا تحذفه في نفس deployment.
- تأكد أن الطلبات الجديدة والانتقالات الخمس تعمل بدون أي كتابة له.

## المرحلة 6: حذف `orders.status` نهائيًا

Migration منفصلة بعد فترة المراقبة، وتُنفذ يدويًا عبر Supabase SQL Editor.

Preflight إلزامي:

```sql
-- يجب أن تكون نتائج dependency/parity/runtime audits صفرًا.
-- التقط تعريفات كل الدوال والـtriggers المالية قبل DDL.
```

قواعد DDL:

- `BEGIN`.
- `SET LOCAL statement_timeout='15s'` و`lock_timeout='3s'` أو قيم أقل مناسبة.
- assertions ترفع exception عند أي dependency أو mismatch.
- `DROP COLUMN status RESTRICT` فقط.
- ممنوع `CASCADE`.
- postflight يعيد فحص columns/functions/views/triggers/RLS.
- لا تصلح بيانات مالية في نفس migration.
- بعد نجاح SQL Editor، زامن migration history للرقم والـchecksum فقط.

Postflight أساسي:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name = 'status';
```

يجب ألا يعيد صفوفًا.

## اختبارات القبول النهائية

- كل انتقال Issue V2 يعمل للمندوب/الأدمن وفق التوقيت الصحيح.
- رفض المعمل لا يظهر في قائمة المشاكل، لكن admin tech-status path يعمل حتى مع مصمم داخلي.
- المصمم يطلب الرفض ولا يعتمد `lab_rejected` بنفسه.
- الإلغاء قبل التسليم فقط.
- returned/doctor_rejected/redo بعد التسليم أو legacy confirmation المعتمدة.
- redo replacement لا يرث delivery/submission timestamps.
- idempotency/retry لا تنشئ events أو obligations مكررة.
- doctor JWT لا يقرأ `order_events` أو staff metadata.
- doctor RPCs للقراءة/الإنشاء/feedback تعمل بعد حذف العمود.
- المحاسب يرى كل تغيير حقيقي بعد التسجيل، ولا يرى lifecycle metadata وحدها.
- الطلبان `6009-260611-501` و`3003-260729-524` لا يختفيان من المراجعة قبل اعتماد المحاسب.
- لا يتغير مجموع أو عدد الالتزامات النشطة بسبب mirror-off أو drop-status transaction.
- direct dependency audit وparity audit كلاهما صفر.

## ترتيب النشر لكل مرحلة

1. migration/code في المستودع للمراجعة.
2. local targeted tests.
3. clean/staging database tests.
4. typecheck + build.
5. commit محدد النطاق، مع استبعاد `.temp/cli-latest`.
6. push ومراقبة Vercel.
7. production preflight read-only.
8. SQL Editor transaction يدويًا.
9. postflight مستقل.
10. migration history repair لنفس migration فقط.
11. smoke tests بأدوار admin/representative/designer/doctor/accountant.

## تعريف الاكتمال

لا يعتبر تقاعد `status` مكتملًا إلا عندما:

- `orders.status` غير موجود.
- لا توجد references نصية أو dependencies حية له.
- كل الواجهات والتقارير تعمل من `production_status` و`issue_state`.
- legacy cases ما زالت مفهومة ومراجعة بدون اختلاق timestamps.
- لا توجد فروق مالية غير مفسرة.
- rollback runbook وdeployment log محفوظان.

## Prompt مقترح للشات الجديد

```text
اقرأ docs/ORDER_WORKFLOW_V2_REMAINING_PLAN.md بالكامل ثم ابدأ بالمرحلة 0 والمرحلة 1 فقط. لا تطفئ workflow_status_legacy_mirror ولا تحذف orders.status. أريد inventory مثبتًا بالكود وكتالوج PostgreSQL، مع targeted tests وبدون أي production writes قبل مراجعة النتائج معي.
```
