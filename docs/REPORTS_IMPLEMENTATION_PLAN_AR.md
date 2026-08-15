# خطة تنفيذ قسم التقارير — دليل عمل تفصيلي

> **الجمهور:** أي مطوّر أو AI agent ينفّذ من غير ما يبحث في الكود.
> **القرارات والأسباب:** في `REPORTS_REORG_PLAN_AR.md`. الملف ده **تنفيذ** بس.
>
> **آخر تحديث:** 2026-08-16 — المراحل 0 لـ 4 خلصت. الباقي: 5 و6.

---

## ⛔ القواعد الملزمة — اقرأها قبل أي سطر كود

1. **ممنوع أرقام متخيّلة.** أي تحليل داتاه ناقصة ← واجهة + حالة فاضية تشرح الناقص. ممنوع `Math.random()` أو أرقام تجريبية.
2. **ممنوع تشيل أي route.** المسار القديم يفضل ويعمل `<Navigate replace />`.
3. **أي SQL جديد في `supabase/migrations/` فقط.** ممنوع `temp_migrations/` أو `manual/` — الملفات دي بره سلسلة الترحيل، اتنسيت في مراجعة الأمان، وسببت تسريب بيانات.
4. **أي RPC جديدة لازم تتقفل على admin** — الصيغة الحرفية في «قوالب جاهزة».
5. **مصدر المشاكل = `order_issues` فقط.** ممنوع تحسب مشاكل من `orders.status`.
6. **ممنوع `git push` أو `supabase db push`.** المالك بينشر بنفسه.
7. **بعد كل مرحلة:** `npm run lint && npm run typecheck && npm run test:unit`. لو فيه SQL: `npm run test:db`.

---

## 📚 مرجع سريع — كل اللي محتاجه (متبحثش)

### الملفات

| الملف | الدور |
|---|---|
| `src/pages/Analytics.tsx` | صفحة التقارير (1455 سطر، 4 تبويبات) |
| `src/pages/IssuesReport.tsx` | تقرير المشكلات (367 سطر) |
| `src/pages/Quality.tsx` | الجودة (516 سطر) — **هتتشال** |
| `src/pages/DesignerStats.tsx` | إحصائيات المصممين (472 سطر) |
| `src/pages/AIAnalytics.tsx` | التحليلات الذكية (561 سطر) |
| `src/pages/MarketingAnalytics.tsx` | تحليلات التسويق (398 سطر) |
| `src/components/finance/StatementTab.tsx` | تبويبات تحليل الخدمات/المصروفات (1311 سطر) |
| `src/components/Sidebar.tsx` | القائمة الجانبية — مجموعة `reports` تبدأ سطر 80 |
| `src/App.tsx` | المسارات — سطور 68، 113-119 |
| `src/services/supabase/analyticsService.ts` | استدعاءات RPC |
| `src/constants/expenseCategories.ts` | فئات المصروفات |
| `src/utils/orderUtils.tsx` | `wasRejected()` سطر 4 |

### الجداول والأعمدة (من الإنتاج)

**`orders`** — الأعمدة المهمة:
```
id, case_id, doctor_id, patient_name, total_price, cost, discount, status,
delivery_date, actual_delivery_date, supplier_id, designer_id, representative_id,
is_redo, original_order_id, is_archived, is_deleted, is_urgent,
rejected_lab_cost, rejected_designer_cost, rejected_doctor_amount,
production_status, issue_state, design_submitted_at, first_delivered_at,
delivery_type, feedback, status_history, created_at
```

**`order_issues`**:
```
id, order_id, issue_type, cause_category, notes,
reporter_id, reporter_name, resolved_at, resolution_notes, created_at
```
- `issue_type` القيم: `returned` · `doctor_rejected` · `lab_rejected` · `cancelled` · `redo`
- `cause_category` عليه **CHECK constraint** بالقيم: `lab, doctor, scan, design, communication, other`
  (معرّف في `001_initial_schema.sql:154`)

**`order_items`**: `id, order_id, product_type, teeth_numbers, shade, price, count, created_at`
> ⚠️ `product_type` **نص حر** — مش FK لـ `services`.

**`services`**: `id, name, selling_price, cost_price, milling_price, designer_price, sort_order`

**`doctors`**: `id, name, phone, doctor_code, representative_id, is_center, parent_id, custom_prices, created_at`
> الأطباء الأبناء ليهم `parent_id` بيشاور على المركز. التجميع المالي على `COALESCE(parent_id, id)`.

**`transactions`**: `id, type, amount, category, date, description, entity_id, entity_type, is_approved, status, effective_date, cashbox_id`
- `type`: `income` أو `expense`

**`users`**: `id, username, role, name, entity_id, base_salary, unit_rate, auth_id, email, is_active, employee_type, designer_service_prices`
> ⚠️ `id` ≠ `auth_id`. أي فحص صلاحية لازم يستخدم `auth_id = auth.uid()` أو `public.get_my_role()`.

**`entity_billing_settings`**: `id, entity_type, entity_id, billing_mode, billing_day, per_order_due_days, payment_terms_notes, auto_apply_credit`

### فئات المصروفات (نص عربي حرفي)
```
'مرتبات وأجور' · 'شحن وتوصيل' · 'انتقالات ووقود' · 'دعاية وتسويق' ·
'ضيافة واجتماعات' · 'خامات ومستهلكات' · 'عمولات ورسوم بنكية' ·
'إيجارات ومرافق' · 'صيانة وإصلاحات' · 'مصروفات أخرى'
```
> استخدم `normalizeExpenseCategory()` من `src/constants/expenseCategories.ts` — البيانات القديمة فيها تنويعات إملائية.

### الـ RPCs الموجودة
| الاسم | المعاملات |
|---|---|
| `get_analytics_summary` | `(p_start_date DATE, p_end_date DATE)` |
| `get_top_doctors` | `(DATE, DATE, INTEGER)` |
| `get_top_services` | `(DATE, DATE, INTEGER)` |
| `get_top_expense_categories` | `(DATE, DATE, INTEGER)` |
| `get_doctor_receivables_breakdown` | `()` |
| `get_order_issues_summary` | `(DATE, DATE)` |
| `correct_order_issue_cause` | `(UUID, TEXT, TEXT, TEXT)` |
| `void_order_issue` | `(UUID, TEXT)` |
| `get_doctor_service_profitability` | `(DATE, DATE)` |
| `get_doctor_segmentation_inputs` | `(DATE, DATE)` |

كلهم **مقفولين على admin** ومطلوب `authenticated`.

### المسارات الحالية في `App.tsx`
```
/analytics            → Analytics          (سطر 113)
/ai-analytics         → AIAnalytics        (سطر 114)
/issues-report        → IssuesReport       (سطر 117)
/marketing-analytics  → MarketingAnalytics (سطر 118، lazy)
/designer-stats       → DesignerStats      (سطر 119)
/quality              → QualityDashboard   (سطر 68)
```

### أنماط الواجهة (استخدمها، متخترعش جديد)
- بطاقة: `bg-white rounded-xl shadow-sm border border-gray-200 p-4`
- إيجابي: `text-emerald-600` · سلبي: `text-rose-600` · محايد: `text-slate-600`
- عناوين: `text-slate-800 font-bold`
- الاتجاه RTL — استخدم `me-*`/`ms-*` مش `ml-*`/`mr-*`
- الرسوم: SVG يدوي (مفيش مكتبة رسوم في المشروع — شوف `MiniLineChart` في `MarketingAnalytics.tsx:19`)

---

## 🧩 قوالب جاهزة

### قالب RPC آمنة (انسخه حرفياً)
```sql
CREATE OR REPLACE FUNCTION public.<اسم_الدالة>(<المعاملات>)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    -- المنطق هنا

END;
$$;

REVOKE ALL ON FUNCTION public.<اسم_الدالة>(<الأنواع>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<اسم_الدالة>(<الأنواع>) TO authenticated;
```
> بعد أي RPC جديدة: أضف توقيعها في `supabase/tests/database/security_definer_rpc_grants.test.sql` داخل جدول `rpc_expectations` بـ `kind='wrapper'` و `in_chain=true`.

### قالب الحالة الفاضية
```tsx
<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
  <p className="text-slate-800 font-bold mb-2">{title}</p>
  <p className="text-slate-600 text-sm mb-1">{whatIsMissing}</p>
  <p className="text-slate-400 text-xs">{howToEnable}</p>
</div>
```
مثال: العنوان «التحليل ده لسه مش متاح» · الناقص «محتاج تسجيل مراحل الإنتاج (دخول وخروج كل مرحلة)» · التفعيل «هيتفعّل مع تشغيل المعمل الفعلي».

---

# المراحل

---

## المرحلة 0 — ✅ خلصت (2026-08-12)

النتيجة على الإنتاج: الأرشفة **4** · تاريخ الطلب خارج الفترة **4** · الحذف الناعم **1** · تغيير الحالة **صفر**.

### 🔒 ثلاث قواعد ملزمة خرجت من المرحلة دي

**قاعدة 0-أ — متفلترش على الأرشفة في استعلامات المشاكل.**
الأرشفة معناها «الملف اتقفل»، **مش** «المشكلة ملغية». أي استعلام مشاكل بيستبعد `is_archived` بيخفي مشاكل حقيقية (4 من 9 هنا).
تُضاف خانة «إظهار المؤرشف» في الواجهة، **افتراضها مفعّلة**.
الاستثناء الوحيد: `is_deleted = true` يتستبعد دايماً (محذوف فعلاً).

**قاعدة 0-ب — حدّد محور التاريخ صراحةً في كل شاشة.**
| المحور | السؤال اللي بيجاوب عليه |
|---|---|
| `order_issues.created_at` | «كام مشكلة حصلت الشهر ده؟» ← **الافتراضي لتقارير الجودة** |
| تاريخ الطلب (`delivery_date`/`created_at`) | «طلبات الشهر ده أداؤها إيه؟» |
الاتنين صح. **الواجهة لازم تكتب أي واحد مستخدم** — الخلط بينهم كان سبب 4 من 9 اختلافات.

**قاعدة 0-ج — `orders.is_redo` مقياس مختلف تماماً عن `order_issues`.**
| المقياس | بيتعلّم على | يُستخدم لـ |
|---|---|---|
| `order_issues` | الطلب **الأصلي** اللي حصلت عليه المشكلة | **عدد الحالات اللي عليها مشاكل** |
| `orders.is_redo` | الطلب **البديل** اللي اتعمل كإعادة | **حجم إعادة الإنتاج** |
**ممنوع تقارن الرقمين أو تجمعهم.** كل واحد له تسمية مختلفة في الواجهة.

---

## المرحلة 1 — إصلاح الأرقام الغلط

> مفيش صفحة جديدة. الهدف: الأرقام الموجودة تبقى صح.

### مهمة 1.1 — RPC لإحصاء المشاكل من المصدر الصح
**ملف جديد:** `supabase/migrations/<timestamp>_add_order_issues_summary_rpc.sql`

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.get_order_issues_summary(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    -- محور التاريخ = order_issues.created_at (تاريخ تسجيل المشكلة) — قاعدة 0-ب
    -- is_archived مستبعد عمداً من الفلترة — قاعدة 0-أ
    -- is_deleted مستبعد دايماً (محذوف فعلاً)
    WITH scoped AS (
        SELECT oi.issue_type, oi.cause_category, oi.order_id
        FROM order_issues oi
        LEFT JOIN orders o ON o.id = oi.order_id
        WHERE (p_start_date IS NULL OR oi.created_at::date >= p_start_date)
          AND (p_end_date   IS NULL OR oi.created_at::date <= p_end_date)
          AND COALESCE(o.is_deleted, false) = false
    )
    SELECT jsonb_build_object(
        'distinct_orders_with_issues', COALESCE(COUNT(DISTINCT order_id), 0),
        'total_issue_events',          COALESCE(COUNT(*), 0),
        'date_axis',                   'order_issues.created_at',
        'by_type', COALESCE(
            (SELECT jsonb_object_agg(issue_type, cnt)
             FROM (SELECT issue_type, COUNT(*) AS cnt
                   FROM scoped GROUP BY issue_type) t), '{}'::jsonb),
        'by_cause', COALESCE(
            (SELECT jsonb_object_agg(COALESCE(cause_category, 'unknown'), cnt)
             FROM (SELECT cause_category, COUNT(*) AS cnt
                   FROM scoped GROUP BY cause_category) t), '{}'::jsonb)
    )
    INTO v_result
    FROM scoped;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_issues_summary(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_issues_summary(DATE, DATE) TO authenticated;

COMMIT;
```

**معيار القبول:**
- `npm run test:db` أخضر
- استدعاء بـ `('2026-08-01','2026-08-31')` يرجّع `total_issue_events = 8`
  (فحص المرحلة 0 لقى **9** صفوف في الفترة، واحد منهم على طلب محذوف ناعماً فبيتستبعد → **8**)
- الرقم **لازم يشمل المؤرشف** (4 من الـ 8 على طلبات مؤرشفة). لو رجّع 4، يبقى فيه فلتر أرشفة اتزرع بالغلط.

### مهمة 1.2 — تسجيل الـ RPC في تست الأمان
**الملف:** `supabase/tests/database/security_definer_rpc_grants.test.sql`
**التغيير:** أضف السطر ده لجدول `rpc_expectations`:
```sql
    ('public.get_order_issues_summary(date,date)',                             'wrapper',    true),
```
**معيار القبول:** `npm run test:db` أخضر (6/6).

### مهمة 1.3 — ربط الخدمة بالـ RPC الجديدة
**الملف:** `src/services/supabase/analyticsService.ts`
**التغيير:** أضف دالة على نمط الدوال الموجودة:
```ts
async getIssuesSummary(startDate?: string, endDate?: string) {
    const { data, error } = await supabase.rpc('get_order_issues_summary', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
    });
    if (error) throw error;
    return data;
}
```

### مهمة 1.4 — تصحيح بطاقة «حالات بمشاكل»
**الملف:** `src/pages/Analytics.tsx` (البطاقة حوالي سطر 675)

**المشكلة الحالية:** بيجمع `redo + doctor_rejected + lab_rejected + returned` من `get_analytics_summary`، فالطلب اللي عليه نوعين بيتعد مرتين، و`cancelled` مش داخلة أصلاً.

**التغيير:**
1. استدعِ `analyticsService.getIssuesSummary(startDate, endDate)` مع باقي الاستدعاءات.
2. اعرض `distinct_orders_with_issues` بدل المجموع.
3. تحت الرقم مباشرة أضف سطر مصدر:
   `<span className="text-xs text-slate-400">من سجل المشكلات</span>`
4. في الـ tooltip أو تحت البطاقة اعرض التفصيل من `by_type`.

**معيار القبول:** الرقم يطابق تقرير المشكلات لنفس الفترة بالظبط.

### مهمة 1.5 — تصحيح «نسبة الإرجاع»
**الملف:** نفسه.
**التغيير:** البسط = `distinct_orders_with_issues`، المقام = `total_order_count` من `get_analytics_summary`. أضف سطر المصدر.

### مهمة 1.6 — إظهار أخطاء التحميل
**الملفات:** `Analytics.tsx` · `IssuesReport.tsx` · `DesignerStats.tsx`

- `Analytics.tsx`: في `catch` بتاع `calculateStats()` ضيف `setError(...)` واعرض شريط خطأ.
- `IssuesReport.tsx`: نفس الشيء لتحميل القوائم.
- `DesignerStats.tsx`: **شيل** `.catch(() => [])` من الاستعلامات الأربعة (حوالي سطر 51-54) وسيب الخطأ يوصل للـ `catch` الخارجي.

**معيار القبول:** لو الشبكة مقطوعة، الصفحة تعرض رسالة خطأ — مش صفحة فاضية.

---

## المرحلة 2 — باجّات التسويق (قبل تشغيل الإعلانات)

> ⚠️ **لازم تخلص قبل بداية أول حملة إعلانية**، وإلا هتفقد قياس الحملة.

### مهمة 2.1 — إصلاح `pricing_cta_click`
**الملف:** `src/marketing/MarketingPage.tsx` (حوالي سطر 51)

**السبب الجذري:** الشرط الحالي بيتطلب `a[href="#contact"]` أو `button[type="submit"]` **جوّه `#pricing`**، لكن `src/marketing/components/PricingSection.tsx` فيه رابط واحد بس هو `<a href="https://wa.me/201034141917">` (سطر 105). فالشرط ما بيتحققش أبداً ← العدّاد صفر من يوم ما اتكتب ← **«معدل التحويل» صفر بالتصميم**.

**التغيير:** خلي الشرط أي رابط أو زر جوّه `#pricing`:
```ts
const inPricing = (e.target as HTMLElement).closest('#pricing');
const pricingCta = (e.target as HTMLElement).closest('a, button');
if (pricingCta && inPricing) {
    marketingService.logEvent({
        event_name: 'pricing_cta_click',
        source: 'pricing_section',
        page_type: 'marketing_landing',
        device_type: deviceType,
        session_id: sessionId,
    });
}
```
> ملاحظة: الضغط على واتساب جوّه `#pricing` هيسجّل الحدثين (`whatsapp_click` + `pricing_cta_click`) — وده **مقصود**: الأول نية والتاني تحويل.

**معيار القبول:** الضغط على زر الأسعار محلياً يزوّد صف في `marketing_events` بـ `event_name='pricing_cta_click'`.

### مهمة 2.2 — شطب ملاحظة GTM المضلِّلة
**الملف:** `src/pages/MarketingAnalytics.tsx` (سطور 390-395)
**السبب:** الملاحظة بتقول «استبدل `GTM-XXXXXXX`» لكن **مفيش GTM container مركّب أصلاً** في `index.html`. الملاحظة بتوجّه لحل مش موجود.
**التغيير:** احذف الملاحظة. (الـ `dataLayer.push` في `ContactSection.tsx:163` كود ميت — سيبه أو احذفه، مالوش تأثير.)

---

## المرحلة 3 — إضافات قاعدة البيانات

### مهمة 3.1 — الـ 14 كود سبب + المرحلة المسؤولة
**ملف جديد:** `supabase/migrations/<timestamp>_expand_order_issue_cause_codes.sql`

```sql
BEGIN;

-- 0) حفظ الأصل قبل أي تحويل (للمراجعة)
ALTER TABLE public.order_issues
    ADD COLUMN IF NOT EXISTS previous_cause_category TEXT;
UPDATE public.order_issues
    SET previous_cause_category = cause_category
    WHERE previous_cause_category IS NULL;

-- 1) توسيع cause_category للـ 14 كود
ALTER TABLE public.order_issues
    DROP CONSTRAINT IF EXISTS order_issues_cause_category_check;

-- 2) تحويل البيانات القديمة (6 أكواد -> الجديدة)
UPDATE public.order_issues SET cause_category = 'cad'
    WHERE cause_category = 'design';
UPDATE public.order_issues SET cause_category = 'scan_impression'
    WHERE cause_category = 'scan';
UPDATE public.order_issues SET cause_category = 'doctor_side'
    WHERE cause_category = 'doctor';
UPDATE public.order_issues SET cause_category = 'unknown'
    WHERE cause_category IN ('lab', 'communication', 'other')
       OR cause_category IS NULL;

ALTER TABLE public.order_issues
    ADD CONSTRAINT order_issues_cause_category_check
    CHECK (cause_category IN (
        'prep', 'scan_impression', 'cad', 'fit', 'contact', 'occlusion',
        'shade', 'milling', 'material', 'finish', 'glaze',
        'doctor_side', 'logistics_damage', 'unknown'
    ));

-- 3) المرحلة المسؤولة
ALTER TABLE public.order_issues
    ADD COLUMN IF NOT EXISTS responsible_stage TEXT;

ALTER TABLE public.order_issues
    DROP CONSTRAINT IF EXISTS order_issues_responsible_stage_check;
ALTER TABLE public.order_issues
    ADD CONSTRAINT order_issues_responsible_stage_check
    CHECK (responsible_stage IS NULL OR responsible_stage IN (
        'design', 'milling', 'finish', 'glaze', 'qc',
        'doctor', 'logistics', 'external_lab', 'unknown'
    ));

-- 4) مسار تصحيح موثَّق
ALTER TABLE public.order_issues
    ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS corrected_by UUID,
    ADD COLUMN IF NOT EXISTS correction_reason TEXT,
    ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_order_issues_created_at
    ON public.order_issues (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_issues_cause
    ON public.order_issues (cause_category);

COMMIT;
```

> **⚠️ التحويل غير عكسي في العمود الأساسي.** `lab` و`communication` و`other` بيروحوا `unknown` لأن مفيش مقابل دقيق — لكن الأصل محفوظ في `previous_cause_category` (خطوة 0) فممكن يتراجَع يدوياً.

**معيار القبول:** `npm run test:db` أخضر · مفيش صف `cause_category` بره الـ 14.

### مهمة 3.2 — الترجمة العربية للأكواد
**ملف جديد:** `src/constants/issueCauses.ts`
```ts
export const ISSUE_CAUSE = {
    prep: 'تحضير السن',
    scan_impression: 'مسح / طبعة',
    cad: 'تصميم CAD',
    fit: 'عدم انطباق',
    contact: 'نقطة تلامس',
    occlusion: 'إطباق',
    shade: 'لون',
    milling: 'فرز',
    material: 'خامة',
    finish: 'تشطيب',
    glaze: 'جلاز',
    doctor_side: 'من جهة الطبيب',
    logistics_damage: 'تلف أثناء النقل',
    unknown: 'غير محدد',
} as const;

export const RESPONSIBLE_STAGE = {
    design: 'التصميم',
    milling: 'الفرز',
    finish: 'التشطيب',
    glaze: 'الجلاز',
    qc: 'مراجعة الجودة',
    doctor: 'الطبيب',
    logistics: 'الشحن',
    external_lab: 'معمل خارجي',
    unknown: 'غير محدد',
} as const;

export type IssueCause = keyof typeof ISSUE_CAUSE;
export type ResponsibleStage = keyof typeof RESPONSIBLE_STAGE;
```

### مهمة 3.3 — حد الائتمان
**ملف جديد:** `supabase/migrations/<timestamp>_add_credit_limit.sql`
```sql
BEGIN;
ALTER TABLE public.entity_billing_settings
    ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS stop_work_threshold NUMERIC(12,2);
COMMENT ON COLUMN public.entity_billing_settings.credit_limit
    IS 'الحد الائتماني. NULL = بلا حد.';
COMMENT ON COLUMN public.entity_billing_settings.stop_work_threshold
    IS 'رصيد إيقاف استلام طلبات جديدة. NULL = بلا إيقاف.';
COMMIT;
```
> **تنبيه:** ده **عرض** بس في المرحلة دي. **ممنوع** تمنع إنشاء طلبات تلقائياً — ده تغيير في سير العمل محتاج قرار منفصل.

---

## المرحلة 4 — ✅ خلصت (2026-08-16)

### 🔴 تصحيح جوهري خرج من التنفيذ — أساس التكلفة

**الخطة كانت غلط.** مهمة 4.1 تحت كتبت التكلفة =
`services.cost_price × count + milling_price + designer_price` — ده **قائمة أسعار**، يعني
نموذج للتكلفة المفروضة مش التكلفة اللي حصلت فعلاً. لو اتنفذ كده كان هيطلع «مجمل ربح»
**مخالف** لـ `get_analytics_summary.total_cost_of_goods` على نفس الطلبات بالظبط — وده نفس
نوع الباج اللي الخطة دي كلها موجودة عشان تشيله.

**اللي اتنفذ:** `get_doctor_service_profitability` بتعيد استخدام تكلفة الطلب الفعلية
المعرّفة في `20260812020000_mirror_statement_sales_cost_payables.sql` (تكلفة المورد بفروع
الـ split workflow والمصمم بالراتب الثابت والرفض، وتكلفة المصمم بنفس الفروع)، والإيراد من
`receivable_amount` المتسوّي. الاتنين بيتوزعوا على بنود الطلب **بنفس الوزن الواحد** اللي
`StatementTab.tsx` و`get_top_services` مستخدمينه، فهامش أي صف = هامش طلبه.

> **القاعدة اللي خرجت من هنا:** أي تقرير مالي جديد يعيد استخدام أساس التكلفة الموجود.
> ممنوع تحسب تكلفة من كتالوج الخدمات — الكتالوج تسعير، مش محاسبة.

**كمان اتكشف باج قائم:** `doctors.custom_prices` **مش في سلسلة الترحيل** أصلاً — الـ
`custom_prices` في `001_initial_schema.sql:103` بتاع `suppliers`. عمود الأطباء موجود بس في
`temp_migrations/20260328155531`، واتطبّق على الإنتاج يدوي. علشان plpgsql بيربط أسماء
الأعمدة وقت التنفيذ مش وقت الإنشاء، `20260812040000` اتطبّقت عادي و`get_top_services`
بتفشل **بس لما admin يفتح التقرير**. الإنتاج سليم النهاردة؛ أي بيئة مبنية من السلسلة لأ.
`20260816004000` بتتبنّى العمود بـ `IF NOT EXISTS`.

### مهمة 4.1 — ✅ ربحية الطبيب × الخدمة

**اتنفذت:** `src/pages/DoctorServiceProfitability.tsx` · المسار `/reports/profitability` ·
RPC `20260816003000` · تجميع بـ «طبيب × خدمة» أو «حسب الطبيب» أو «حسب الخدمة».
الصفوف اللي اسم خدمتها بره الكتالوج **بتتعرض وبتتحسب** مع علامة، مش بتتشال.
«تكلفة الإعادة» معروضة كـ **جزء من** التكلفة مش إضافة عليها (الطلب المُعاد المسلَّم داخل
في المجموع أصلاً).

### ~~الوصف الأصلي للمهمة 4.1 — ملغي، الأساس اتغيّر~~
**ملف جديد:** `src/pages/DoctorServiceProfitability.tsx` · **المسار:** `/reports/profitability`

**⚠️ عقبة معروفة:** `order_items.product_type` نص حر مش FK لـ `services.id`. **الحل المعتمد:** طابق بـ `LOWER(TRIM())` على `services.name`، **واعرض صف «غير مطابق»** بالبنود اللي ما اتطابقتش. ممنوع تتجاهلها بصمت.

**الأعمدة:** الطبيب · الخدمة · الوحدات · الإيراد · التكلفة المباشرة · مجمل الربح · هامش الربح % · تكلفة الإعادة

**الحسابات:**
- الوحدات = `SUM(order_items.count)`
- الإيراد = `SUM(order_items.price × order_items.count)`
- التكلفة = `SUM(services.cost_price × count)` + `milling_price` + `designer_price`
- تكلفة الإعادة = `SUM(orders.cost)` حيث `is_redo = true` + `SUM(rejected_lab_cost + rejected_designer_cost)`
- الفلترة: `status IN ('Delivered','Completed')` و `COALESCE(is_archived,false) = false` و `COALESCE(is_deleted,false) = false`
- التجميع على `COALESCE(doctors.parent_id, doctors.id)`

### ⛔ تصحيح مهم (2026-08-16) — صفحتان موجودتان بالفعل

الـ audit الأصلي غطّى الـ 6 صفحات بتوع قسم التقارير بس، ففاتت عليه صفحتان ماليتان برّه القسم بيغطّوا جزء كبير من المطلوب:

| الملف | السطور | المسار | بيغطي |
|---|---|---|---|
| `src/pages/AgingReport.tsx` | 1220 | `/aging-report` | شرائح تقادم (حالي / 1-30 / 31-60 / +60) · إجمالي المديونية · أيام التأخير · إجراءات مقترحة · تسويات مالية |
| `src/pages/DoctorRetention.tsx` | 920 | `/doctors/retention` | `calculatedSegment` (شرائح سلوكية) · معدل رفض الأوردرات · نشاط 30/60 يوم · جدول إعدادات `doctor_retention_settings` بعتبات قابلة للضبط |

**ممنوع بناء `Receivables.tsx` أو `DoctorSegmentation.tsx` من الصفر.** المهام اتعدّلت لتوسيع الموجود.

---

### مهمة 4.2 — ✅ الذمم: توسيع `/aging-report`

التلاتة اتنفذوا:
1. **شريحة +60 اتقسمت** لـ `61-90` و`+90` في التلات أماكن اللي بتحسب الشرائح:
   محرك FIFO في الصفحة، المحرك المبني على `financial_obligations` في `collections.ts`،
   والأنواع المرآة في `db.ts`. `over60Days` اتشال خالص بدل ما يفضل جنبهم عشان ما يحصلش عد مزدوج.
2. **حد الائتمان** — حقل إدخال في إعدادات فوترة الطبيب (`BillingSettingsPanel`، **للأطباء بس**
   لأن الموردين والمصممين ذمم دائنة) + شريط استخدام وعلامة تجاوز في التقرير.
   **النص في الحقلين وفي التقرير بيقول صراحةً إن النظام لا يمنع إنشاء أي طلب** — نفس كلام
   الـ `COMMENT` على العمود.
3. **DSO** — **مش نسخة** من صيغة `Analytics.tsx`: دي بتقسم على فترة يختارها المستخدم،
   وصفحة الذمم لقطة «حتى تاريخ» مالهاش فترة. الصفحة بتحسب متوسط الفوترة على نافذة
   **90 يوم ثابتة** بنفس أساس تاريخ كشف الحساب بتاع الرصيد نفسه، والبطاقة بتكتب النافذة
   عشان محدش يقراها على إنها كل الوقت.

**متلمسش** الإجراءات المقترحة ولا التسويات المالية — دول شغالين.

### ~~مهمة 4.2 القديمة — ملغاة~~
~~**ملف جديد:** `src/pages/Receivables.tsx` · **المسار:** `/reports/receivables`~~
**المصدر:** `analyticsService.getDoctorReceivablesBreakdown()` — **موجودة وجاهزة، متبنيش RPC جديدة**.
**المحتوى:** 4 مؤشرات (إجمالي الذمم · +90 يوم · DSO · عدد الأطباء المتأخرين) + جدول بالشرائح + عمود حد الائتمان + مؤشر تجاوز.
**ملاحظة:** الـ RPC بترجّع الأطباء اللي رصيدهم > 0.01 فقط.

### مهمة 4.3 — ✅ تصنيف العملاء A/B/C/D

**قرار المالك (2026-08-16): «التصنيف + الربحية في مكان واحد».**
يعني مش الخيار (أ) اللي كان موصى بيه تحت — التصنيف الربحي بقى **تبويب تاني جوّه
`/reports/profitability`**، مش جوّه `DoctorRetention`. السبب إن التصنيف ده ربحي بحت،
فمكانه الطبيعي جنب الجدول اللي بيولّد أرقامه: درجة الطبيب على بُعد كليكة واحدة من الصفوف
اللي طلّعتها، وما ينفعش الاتنين يختلفوا. `DoctorRetention` بيفضل زي ما هو بشرائحه
السلوكية — سؤال مختلف («مين وقف يطلب؟») لنفس الطبيب.

**اللي اتنفذ:**
- `src/constants/doctorSegmentation.ts` — الأوزان والحدود وقواعد التجاوز، **مصدّرة**
  عشان الواجهة تعرضها. النقاط **متحسبة في الـ TypeScript مش في SQL** عن قصد: دي سياسة
  المالك، ودفنها في جوف دالة كان هيخبّي أكتر جزء محتاج يتراجع.
- `src/components/reports/DoctorSegmentationTab.tsx` — التوزيع، جدول الأوزان معروض
  (`<details open>`)، وجدول الأطباء بسبب التجاوز مكتوب على كل صف.
- RPC `20260816005000` بترجّع **بس** اللي مفيش RPC تانية بترجّعه: عدد الطلبات، وعدد
  الطلبات اللي عليها مشاكل، ومدة العلاقة. الربح من `get_doctor_service_profitability`
  والتقادم من `get_doctor_receivables_breakdown` — التلاتة بيتجمّعوا على
  `COALESCE(parent_id, id)` فبيتربطوا مباشرة وما يقدروش يفترقوا.
- `tests/unit/doctor-segmentation.test.ts` — 18 تست على الحدود وقواعد التجاوز.

**نقطتان اتحسموا أثناء التنفيذ:**
- **نسبة المشاكل بتعدّ طلبات مش أسطر مشاكل** — طلب عليه 3 مشاكل مسجّلة ما يقدرش يطلّع
  النسبة فوق 100%. والمشاكل الملغاة (`is_voided`) مستبعدة: مشكلة اتسجّلت غلط والأدمن
  ألغاها مش دليل ضد الطبيب.
- **رصيد صفر = تحصيل ممتاز (28 نقطة)**، مش بيانات ناقصة.

### ~~الوصف الأصلي — الخياران (أ)/(ب)، اتحسم لصالح «مع الربحية»~~

**فيه تصنيف موجود بالفعل** في `src/pages/DoctorRetention.tsx` (`calculatedSegment`)، لكنه **مختلف الغرض**:

| | التصنيف الموجود | المطلوب A/B/C/D |
|---|---|---|
| **المحور** | سلوكي — نشط / متراجع / متوقف / جديد | ربحي — إيراد وربح وتحصيل وإعادة |
| **السؤال** | «مين وقف يطلب ومحتاج تنشيط؟» | «مين يستاهل خصم ومين نوقفه؟» |
| **الإعدادات** | `doctor_retention_settings` (عتبات قابلة للضبط) | أوزان 33/28/22/17 |

**مش تكرار كامل، بس فيه تداخل** — «معدل رفض الأوردرات» محسوب في الاتنين.

**الخياران:**
- **(أ)** التصنيف الربحي يبقى **تبويب/عمود جوّه `DoctorRetention`** — الطبيب يبقى ليه صورة واحدة، وإعادة استخدام العتبات الموجودة
- **(ب)** صفحة مستقلة — فصل واضح بين «متابعة تجارية» و«تحليل ربحية»

**التوصية: (أ)** — صفحتان بتصنيفين مختلفين لنفس الطبيب هيلخبطوا، والموجود فيه بنية إعدادات جاهزة نبني عليها.

### ~~المهمة القديمة — معلّقة لحد القرار~~
~~**ملف جديد:** `src/pages/DoctorSegmentation.tsx` · **المسار:** `/reports/segmentation`~~

**نظام نقاط موزون — معتمد من المالك 2026-08-12.**
السبب في اختيار النقاط بدل قواعد صارمة: القواعد الصارمة بتفشل مع الحالات المختلطة (طبيب إيراده عالي بس تحصيله سيء).

**الأوزان (المجموع 100):**

| البُعد | الوزن | ملاحظة |
|---|---|---|
| مجمل الربح (GP) | **33** | نسبي بين الأطباء |
| جودة التحصيل | **28** | ربح مش محصَّل = مش ربح |
| هامش الربح (GM%) | **22** | عتبات ثابتة |
| نسبة الإعادة | **17** | من `order_issues` |
| **الإيراد** | **0** | يتعرض للسياق بس — داخل ضمنياً في GP، وحسابه مرتين ازدواج |

> **كثافة اللوجستيات اتشالت بقرار المالك** (2026-08-12) لأننا بنحاسب شركة شحن خارجية بفاتورة إجمالية، فمفيش تكلفة توصيل حقيقية لكل طبيب. الـ 10 نقاط اتوزعت بالتناسب على الأربعة الباقيين.

**تفصيل النقاط:**

*مجمل الربح — 33:* أعلى 20% = **33** · 20–40% = 26 · 40–60% = 20 · 60–80% = 13 · أقل 20% = 7 · سالب = **0**

*جودة التحصيل — 28:* كل الرصيد ≤ 30 يوم = **28** · أغلبه 31–60 = 21 · أغلبه 61–90 = 14 · رصيد +90 بين 10–30% = 7 · رصيد +90 > 30% = **0**

*هامش الربح — 22:* ≥ 40% = **22** · 30–40% = 18 · 20–30% = 13 · 10–20% = 7 · 0–10% = 3 · سالب = **0**

*نسبة الإعادة — 17:* (طلبات عليها مشاكل ÷ إجمالي طلباته) — 0% = **17** · < 3% = 14 · 3–7% = 10 · 7–12% = 5 · > 12% = **0**

**الشرائح:** A = 80–100 · B = 60–79 · C = 40–59 · D = أقل من 40

**قواعد تجاوز (تكسر النقاط):**
| الحالة | النتيجة |
|---|---|
| مجمل الربح **سالب** | **D** مهما كانت النقاط |
| رصيد +90 يوم > **50%** من رصيده | **D** مهما كانت النقاط |
| طبيب أقل من **90 يوم** | **«جديد»** — مش A/B/C/D |
| أقل من **5 طلبات** | **«عينة صغيرة»** |

> آخر اتنين مهمين: تصنيف طبيب على أساس طلبين معناه ضوضاء مش إشارة.

**إعدادات الحساب:**
- الفترة: آخر 12 شهر متحرك (قابلة للتغيير من الفلتر)
- التجميع على المركز: `COALESCE(doctors.parent_id, doctors.id)`
- الاستبعاد: `is_archived` و `is_deleted`

**⚠️ اعرض جدول الأوزان والحدود في الواجهة** عشان المالك يقدر يراجعها — متخبّيهاش في الكود.

---

## المرحلة 5 — إعادة التنظيم

### مهمة 5.1 — نقل أداء المعامل لتقرير المشكلات
**الملف:** `src/pages/IssuesReport.tsx`
**التغيير:** أضف جدول «أداء المعامل» بالأعمدة:
المعمل · إجمالي الحالات · عدد المشاكل · **نسبته من إجمالي المشاكل** · توزيع الأنواع · تكلفة الرفض
**المصدر:** `order_issues` مربوط بـ `orders.supplier_id`، والاسم من `suppliers`.
**ملاحظة:** أضف صف «داخلي / غير محدد» للطلبات اللي `supplier_id IS NULL` — زي ما `Quality.tsx` بيعمل حالياً.

### مهمة 5.2 — توسيع فورم المشكلة
**الملف:** `src/pages/IssuesReport.tsx` (والفورم اللي بينشئ المشكلة)
**التغيير:**
- قائمة السبب تستخدم `ISSUE_CAUSE` (14 خيار)
- قائمة جديدة للمرحلة المسؤولة تستخدم `RESPONSIBLE_STAGE`
- **زر «تصحيح السبب»** على كل صف: modal يطلب السبب الجديد + **سبب التصحيح إجباري**، ويكتب `corrected_at`, `corrected_by`, `correction_reason`
- **زر «إلغاء التسجيل»** لو اتسجل بالغلط: `is_voided = true` + سبب إجباري. **ممنوع الحذف الفعلي.**
- كل الاستعلامات الإحصائية تستبعد `is_voided = true`

### مهمة 5.3 — شيل صفحة الجودة
**الملفات:** `src/App.tsx` · `src/components/Sidebar.tsx`

1. **`App.tsx` سطر 68:** بدّل بـ redirect:
```tsx
<Route path="/quality" element={<Navigate to="/issues-report" replace />} />
```
2. **`Sidebar.tsx`:** احذف عنصر «الجودة» من مجموعة `reports`.
3. **`src/pages/Quality.tsx`:** احذف الملف.
4. **modal التقييم:** انقله لملف الطلب كمسار إداري اختياري. لو مفيش وقت، **سيب الملف موجود ومربوط بالـ redirect بس** واعمل مهمة منفصلة.

**⚠️ قبل الحذف:** اتأكد إن `orders.feedback` لسه بيتعرض في `src/pages/doctor/DoctorOrders.tsx` (سطر 122-125) — **ده مسار الطبيب وممنوع يتكسر**.

### مهمة 5.4 — دمج إحصائيات المصممين في إنتاجية الفريق
**الملف:** `src/pages/DesignerStats.tsx`
**التغيير:**
- العنوان يبقى «إنتاجية الفريق»
- تبويب «التصميم» فيه المحتوى الحالي كله
- تبويب «مراحل الإنتاج» يعرض **الحالة الفاضية**: «هيتفعّل مع تشغيل المعمل الفعلي»
- أضف عمود «مقابل الراتب» = عدد الوحدات ÷ `users.base_salary` للمصممين
- المسار `/designer-stats` يفضل شغال

### مهمة 5.5 — القائمة الجانبية الجديدة
**الملف:** `src/components/Sidebar.tsx` (مجموعة `reports` تبدأ سطر 80)

```
التقارير            → /analytics
المالية
  ├─ الذمم والتحصيل  → /reports/receivables
  └─ التدفق النقدي   → /reports/cashflow
العملاء
  ├─ تصنيف العملاء   → /reports/segmentation
  └─ الربحية        → /reports/profitability
الإنتاج والجودة
  ├─ تقرير المشكلات  → /issues-report
  └─ إنتاجية الفريق  → /designer-stats
التسويق             → /marketing-analytics
التحليلات الذكية     → /ai-analytics
```
**كل الصفحات `roles: ['admin']`** ما عدا لو المالك قال غير كده.
**⚠️ أيقونة مختلفة لكل صفحة** — حالياً 3 صفحات بتستخدم `BarChart3`. استخدم من `lucide-react`: `Wallet` · `Users` · `Factory` · `Megaphone` · `Brain` · `TrendingUp` · `AlertTriangle`.

---

## المرحلة 6 — التحاليل المبسّطة

> **مهم:** التحليلين دول اتبسّطوا بعد توضيح المالك. **متبنيش جداول جديدة.**

### مهمة 6.1 — التدفق النقدي (تاريخي)
**ملف جديد:** `src/pages/CashFlow.tsx` · **المسار:** `/reports/cashflow`
**المصدر:** `transactions` (`type`, `amount`, `date`/`effective_date`, `category`) — **كل الداتا موجودة**.
**المحتوى:** آخر 13 أسبوع فعلي: رصيد افتتاحي · تحصيلات · مدفوعات موردين · رواتب · مصروفات تشغيل · رصيد ختامي.
**التصنيف:** استخدم `normalizeExpenseCategory()`. الرواتب = `'مرتبات وأجور'`.
**الجزء التنبؤي:** **مؤجل** — اعرض 13 أسبوع ماضي بس، وحط ملاحظة إن الجزء المستقبلي محتاج إدخال البنود المتوقعة.

### مهمة 6.2 — اللوجستيات (مبسّطة)
**المكان:** قسم داخل `/reports/cashflow` أو بطاقة في `/analytics` — **مش صفحة مستقلة**.

**السبب:** التوصيل عبر شركة شحن خارجية بفاتورة شهرية تتسجل كمصروف. **مفيش خطوط سير ولا مندوبين داخليين** فمفيش داعي لجدول توصيل.

**المؤشرات (كلها من داتا موجودة):**
- تكلفة الشحن الشهرية = `SUM(transactions.amount)` حيث `type='expense'` و `normalizeExpenseCategory(category) === 'شحن وتوصيل'`
- عدد التوصيلات = عدد الطلبات المسلّمة في الشهر
- **متوسط تكلفة التوصيلة** = الأول ÷ التاني
- **الالتزام بالمواعيد %** = نسبة `actual_delivery_date <= delivery_date` (منقول من صفحة الجودة)

**غير متاح ومتعرضوش:** نسبة التوصيل الفاشل · تكلفة الخط. اذكرهم في ملاحظة صغيرة.

### مهمة 6.3 — CAC والاكتساب
**الملف:** `src/pages/MarketingAnalytics.tsx` — **قسم جديد جوّه الصفحة الموجودة**.

**السبب:** فئة `'دعاية وتسويق'` موجودة في `transactions` — **مفيش داعي لجدول `marketing_spend`**.

**المؤشرات:**
- الصرف الإعلاني = `SUM(transactions.amount)` حيث `type='expense'` و الفئة `'دعاية وتسويق'`
- أطباء جدد = `COUNT(doctors)` حيث `created_at` في الفترة
- أطباء مفعّلين = اللي عملوا **طلب واحد على الأقل**
- **CAC** = الصرف ÷ عدد المفعّلين
- إيراد أول 90 يوم = `SUM(orders.total_price)` خلال 90 يوم من `doctors.created_at`

**⚠️ لو الصرف = صفر:** اعرض حالة فاضية «مفيش صرف إعلاني مسجل في الفترة دي» — **ممنوع تعرض CAC = 0** لأنه مضلل.

**لو المالك احتاج CAC لكل قناة لاحقاً:** ساعتها بس أضف جدول `marketing_spend (id, channel, campaign, amount, spend_date, notes)`. **مش دلوقتي.**

---

## المرحلة 7 — مؤجل رسمياً (متنفذش)

| التحليل | السبب | متى يتفعّل |
|---|---|---|
| **الطاقة وزمن الدورة (المراحل)** | المعمل الفعلي تحت التنفيذ. الشغل حالياً بيروح لمعامل خارجية، فمفيش مراحل داخلية تتقاس. | مع تشغيل المعمل — **خطة سيستم منفصلة** |
| **فحص أول مرة (QC)** | تابع للمراحل | نفس التوقيت |
| **إنتاجية باقي الأدوار** | فرز/تشطيب/جلاز/QC مش مربوطين بموظف | نفس التوقيت |
| **عائد السكانرات** | كل السكانرات في المعمل مع الموظفين، **مفيش واحد عند طبيب**. تحليل «عائد لكل سكانر × طبيب» مالوش معنى في الوضع ده. | لو اتركّب سكانر عند طبيب |

**عن قرار بيع سكانر:** النظام حالياً **مش بيربط الحالة بالسكانر**، فمش هيقدر يجاوب «كام حالة اتعملت على كل جهاز». بناء التتبع ده عشان قرار بيع لمرة واحدة **مش مجدي**. لو القرار محتاج أرقام، أسرع طريق هو جرد يدوي.

**كل الأقسام دي تظهر في الواجهة بحالة فاضية شارحة — مش مخفية.**

---

## ✅ فحص نهائي بعد كل مرحلة

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:db
```

**قائمة مراجعة:**
- [ ] مفيش رقم متخيّل ولا `Math.random()` في كود العرض
- [ ] كل مسار قديم شغال (`/quality` ← redirect)
- [ ] كل RPC جديدة فيها فحص `get_my_role()` + `REVOKE` + مسجلة في تست الأمان
- [ ] كل SQL في `supabase/migrations/` مش `temp_migrations/` أو `manual/`
- [ ] كل رقم مشاكل مصدره `order_issues`
- [ ] كل بطاقة فيها سطر مصدر البيانات
- [ ] الحالات الفاضية بتشرح الناقص وإمتى هيتفعّل
- [ ] **ممنوع** `git push` أو `supabase db push`
