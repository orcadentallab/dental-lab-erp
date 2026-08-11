# تشغيل نظام مشاكل الطلبات V2 على Production

ملفات المستودع هي المصدر القابل للمراجعة، لكن التنفيذ على Production يتم يدويًا من Supabase SQL Editor. لا تشغّل `supabase db push` لهذه المجموعة، ولا تسجل migration في history قبل نجاح فحوص ما بعد التنفيذ.

## ترتيب الملفات

1. Schema: `20260808000000_order_issue_workflow_v2.sql`
2. Guard compatibility: `20260808000500_order_role_field_guard_v2.sql`
3. Dry-run/redo definitions: `20260808002000_redo_v2_and_backfill_dry_run.sql`
4. Finance activation فقط بعد reconciliation: `20260808003000_order_issue_v2_finance_and_accounting.sql`
5. Rollout-compatible constraints: `20260808004000_order_issue_v2_rollout_compatibility.sql`
6. Final client cutover فقط بعد نشر الواجهة وتفعيل enforcement:
   `20260808005000_order_issue_v2_client_cutover.sql`

احسب SHA-256 لكل ملف قبل التنفيذ واحتفظ به. كل ملف يعمل داخل transaction؛ أي assertion فاشل يعني rollback كامل.

Checksums للنسخة الحالية (أعد حسابها وقارن قبل Production):

| Migration | SHA-256 |
|---|---|
| `20260808000000_order_issue_workflow_v2.sql` | `013C93848BF5335DACC130D1D6752D4BF053DF39A3DF5F3BCBA88811521D24DA` |
| `20260808000500_order_role_field_guard_v2.sql` | `2FBB4C21F0E75B510E099ABCC8C605D7C8597B3C1399D9B83A5CEAEF41E1DBEF` |
| `20260808002000_redo_v2_and_backfill_dry_run.sql` | `5C7885491BBCA2FC3F318B6202901F9020CCF34CFE2D609E5BE771A33E6D7D6D` |
| `20260808003000_order_issue_v2_finance_and_accounting.sql` | `5C0D6DE3EC4B1EF99E5B0EDEEFEEA5626BE16BCAA33E57392728F7D6A0A7346F` |
| `20260808004000_order_issue_v2_rollout_compatibility.sql` | `A60BB72DB0AE0E98FC095E667A2104BE86A3C4D62B0FB083389639C42454B8D7` |
| `20260808005000_order_issue_v2_client_cutover.sql` | `57DA7AC261F20B0C1A7F60462DC735CB8967B2ADC726DF96F40038F5CCCC849F` |

قاعدة مالية ثابتة: اختيار `decide_later` في مرتجع الطبيب أو إعادة الإنتاج يسجل كامل
`total_price` على الطبيب كمبلغ مؤقت لحماية المعمل، مع إبقاء
`rejection_financial_review_status='pending'`. يظهر المبلغ في الرصيد والتقارير بوصفه
مؤقتًا، بينما يظل الاعتماد المحاسبي النهائي ممنوعًا حتى حسم القرار.

رفض المعمل له مساران معتمدان فقط: اعتماد طلب رفض `pending` أنشأه المصمم بواسطة
الأدمن أو المندوب، أو رفض مباشر من الأدمن عبر `Tech Status = Rejected`. المسار
المباشر يعمل سواء وُجد مصمم داخلي مسند أم لا، ويغلق أي طلب رفض مصمم `pending`
إن وُجد. يظل ممنوعًا بعد تسليم التصميم أو أول تسليم نهائي، ويصفّر كل الحقول
والالتزامات المالية ذريًا.

## Preflight إلزامي

نفّذ واحفظ النتائج خارج قاعدة البيانات:

```sql
SELECT pg_get_functiondef('public.sync_order_financial_obligations()'::regprocedure);

SELECT trigger.tgname, pg_get_triggerdef(trigger.oid)
FROM pg_trigger trigger
WHERE trigger.tgrelid = 'public.orders'::regclass
  AND NOT trigger.tgisinternal
ORDER BY trigger.tgname;

SELECT indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'financial_obligations';

SELECT status, production_status, issue_state, count(*)
FROM public.orders
GROUP BY status, production_status, issue_state
ORDER BY count(*) DESC;
```

أوقف التنفيذ إذا كان `manual_design_price` يشغّل المزامنة ولا يدخل في الصيغة، أو كان `is_archived` يشغّلها، أو وُجد أكثر من trigger يكتب الالتزامات، أو لم يوجد مفتاح أعمال فريد يمنع تكرار `order_id + entity_type + trigger_type`.

## التدرج

- مرحلة التوافق الأولى تنفّذ `00000` ثم `00500` ثم `02000` ثم `04000` فقط،
  وتترك كل flags مغلقة و`workflow_status_legacy_mirror=on`. هذه المرحلة لا تسحب
  سياسات الطبيب القديمة ولا صلاحية إدخال `order_events` حتى تظل الواجهة الحالية عاملة.
- انشر الواجهة الجديدة بعد نجاح مرحلة التوافق الأولى؛ عندها تستخدم RPCs الجديدة بينما
  تبقى المسارات القديمة متاحة كـrollback مؤقت.
- شغّل تقرير `workflow_v2_backfill_dry_run` من SQL Editor فقط. لا تمنح التطبيق صلاحية قراءته.
- عالج `unresolved_legacy_rejection` يدويًا. لا تعدّل التزاماتها.
- عالج كل صف له `timing_review_reason` يدويًا. دالة التطبيق ترفض أي mutation
  طالما يوجد إلغاء بعد دليل تسليم، أو مشكلة لاحقة للتسليم بلا دليل تسليم، أو
  رفض معمل بعد دليل تسليم/تسليم تصميم.
- بعد حفظ نسخة من التقرير ومراجعة الأثر المالي، نفّذ فقط:
  `SELECT public.apply_workflow_v2_backfill('APPLY_REVIEWED_WORKFLOW_V2_BACKFILL');`
  والدالة سترفض العمل إذا لم يكن Finance V2 مثبتًا، أو كان trigger المالي متعددًا، أو غاب مفتاح الأعمال الفريد.
- فعّل `workflow_issue_v2_shadow_read` وراجع parity.
- فعّل audit المحاسبي، ثم pilot الأدمن، ثم المندوبين، ثم الكتابة الكاملة.
- لا تفعّل `workflow_issue_v2_enforce` قبل إثبات أن كل runtime writes تستخدم RPCs الجديدة.
- بعد تفعيل `workflow_issue_v2_enforce` ونجاح JWT smoke tests لكل الأدوار، نفّذ
  `20260808005000_order_issue_v2_client_cutover.sql` لسحب وصول الطبيب المباشر
  وإدخال الأحداث المباشر. لا تنفّذ هذا الملف أثناء مرحلة schema الأولى.
- لا تفعّل `workflow_finance_v2` قبل reconciliation الطبيب/المورد/المصمم على staging وproduction preview. ملف finance نفسه يفشل بوضوح لو الـflag غير مسلح؛ فعّل الـflag ثم نفّذ الملف فورًا في نافذة الصيانة نفسها.

تغيير flag يدويًا:

```sql
UPDATE public.app_settings
SET value = 'on'
WHERE key = 'workflow_issue_v2_write';
```

الرجوع يكون بعكس flag الخاص بالمرحلة فقط. لا ترجع لمسار legacy إذا أصبحت قيوده غير متوافقة؛ اختبر rollback قبل كل تفعيل.

## Postflight

```sql
SELECT conname, convalidated, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.orders'::regclass
  AND conname IN (
    'orders_first_delivered_source_check',
    'orders_lifecycle_timestamp_check',
    'orders_issue_timing_v2_check',
    'orders_zero_issue_financial_fields_check',
    'orders_pending_doctor_decision_check'
  );

SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.orders'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

SELECT key, value
FROM public.app_settings
WHERE key LIKE 'workflow_%v2%' OR key = 'workflow_status_legacy_mirror';
```

سجل migration بعد النجاح فقط:

```sql
INSERT INTO public.schema_deployment_log(
  migration_id, checksum, executed_by, assertion_results,
  row_counts_before, row_counts_after
) VALUES (
  'MIGRATION_ID', 'SHA256', 'SQL_EDITOR_USER',
  '{"postflight":"passed"}'::jsonb,
  '{"orders":0}'::jsonb,
  '{"orders":0}'::jsonb
);
```

بعدها فقط زامن Supabase migration history بنفس migration id والـchecksum دون إعادة تشغيل SQL.

## بوابة حذف `status`

حذف العمود ليس ضمن هذه المجموعة. لا تنشئ migration الحذف قبل أن تكون النتائج التالية صفرًا: runtime reads، runtime writes، dependencies في views/functions/triggers/RLS، parity differences، unresolved backfill، والفروق المالية غير المفسرة. الحذف النهائي يكون `DROP COLUMN status RESTRICT`، ثم يعاد فحص dependencies. لا تستخدم `CASCADE`.
