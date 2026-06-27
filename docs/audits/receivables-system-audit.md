# تقرير شامل: نظام الذمم/الاستحقاقات (Financial Obligations) — الوضع الحالي والمطلوب

> **التشخيص:** "إيراد معلّق" حالياً بيُحسب بطريقة خاطئة لأنه ما بيعتبرش تاريخ استحقاق فعلي لكل طبيب. النظام الصحيح موجود فعلاً مبني جزئياً في الكود، بس مش متفعّل في التقارير.

---

## 1️⃣ المشكلة الحالية بالضبط

### الحساب الحالي (غلط):
```ts
// src/pages/Analytics.tsx
pendingRevenue = total_sales_value − total_income
```
ودا الفهم اللي كنت قلتلك عليه: **مبيعات مسلّمة − تحصيلات**.

### ليه ده غلط:
| الحالة | المشكلة |
|---|---|
| تسلّمت في شهر 5 شغل اتسلّم شهر 4 | الفلوس بتخفض الـ pending الخاص بشهر 5، رغم إنها فعلياً تخص شهر 4 |
| شغل اتسلّم في 28/5 وفترة سماحه 7 أيام | يظهر كـ "معلّق" مع إنه فعلياً مش مستحق إلا 4/6 |
| طبيب على monthly cycle (يدفع يوم 1 كل شهر) | الـ pending بيظهر كل شغله النهارده مستحق، وده غلط |

### الحساب الصح المطلوب:
```
الذمم المستحقة الفعلية = مجموع (net_amount − allocated_amount)
    من جدول financial_obligations
    حيث direction = 'receivable'
    AND status IN ('unpaid', 'partially_paid')
    AND entity_type = 'doctor'
```
ومنها يتفرع:
- **مستحقة الآن** (overdue/due now): `due_date <= today`
- **لسه مش مستحقة** (pending): `due_date > today`
- **تحليل الأعمار** (aging): على أساس `due_date` مش `delivery_date`

---

## 2️⃣ النظام الموجود فعلاً في الكود

النظام الجديد **مبني تقريباً 70%** في الكود، بس **مش متفعّل في التقارير**.

### الجدول والـ Schema (موجود ✅):
**`@d:\dental-lab-erp\supabase\migrations\082_financial_obligations.sql`**

```sql
CREATE TABLE financial_obligations (
    id, order_id, entity_type, entity_id,
    direction,        -- receivable | payable
    trigger_type,     -- doctor_delivered | external_lab_ready | ...
    trigger_date,     -- تاريخ نشوء الالتزام (يوم التسليم مثلاً)
    due_date,         -- ⭐ تاريخ الاستحقاق الفعلي (المحسوب)
    gross_amount, adjustment_amount, net_amount,
    allocated_amount,
    remaining_amount, -- generated
    status            -- unpaid | partially_paid | paid | void | written_off
);
```

### نظام Billing Settings (موجود ✅):
**`@d:\dental-lab-erp\src\constants\billingSettings.ts`**

كل طبيب/مورد له إعداد:
- `billingMode`: `per_order` (دفع لكل أمر) أو `monthly_cycle` (دفع شهري)
- `perOrderDueDays`: عدد أيام السماح للدفع per-order (افتراضي 7)
- `billingDay`: اليوم في الشهر التالي للدفع (لو monthly cycle)

دالة `calculateDueDate()`:
- per_order → `triggerDate + perOrderDueDays`
- monthly_cycle → اليوم المحدد في الشهر التالي

### Hooks في `orders.ts` (موجودة ومُفعّلة ✅):
**`@d:\dental-lab-erp\src\services\supabase\orders.ts:1744-1761`**

- `createDoctorReceivableObligationForOrder` → ينشئ obligation تلقائياً عند تسليم حالة
- `createExternalLabPayableObligationForOrder` → ينشئ obligation للمورد عند جاهزية الإنتاج
- `voidFinancialObligation` → يبطل الالتزام عند رجوع الحالة
- كلها مع flag `shadowMode: true, trackingOnly: true`

### Backfill للحالات القديمة (موجود لكن **مش متشغّل ❌**):
**`@d:\dental-lab-erp\src\services\supabase\historicalObligationsBackfill.ts`**

- `previewHistoricalObligationsBackfill` → معاينة dry-run
- `createHistoricalObligationsBackfillBatch` → تنفيذ فعلي (admin only)
- متاح في صفحة Finance ("معاينة الالتزامات القديمة" + "تجربة تجهيز الالتزامات القديمة")

### Allocation Preview (موجود فقط، مش مطبّق على الواقع ❌):
**`@d:\dental-lab-erp\src\services\supabase\allocationPreview.ts`**

- يحسب FIFO لكل obligations طبيب معين عند معاينة دفعة
- ترتيب: `due_date ASC → trigger_date ASC → created_at ASC`
- متاح في Finance لكن **بيُستخدم للمعاينة فقط** ولا يطبّق على `allocated_amount`

### الـ Feature Flags (الحالة الحالية):
**`@d:\dental-lab-erp\src\constants\financialObligations.ts:50-53`**

```ts
FINANCIAL_OBLIGATIONS_FLAGS = {
    trackingEnabled: true,    // ✅ بيُنشئ obligations فعلياً (في shadow)
    reportingEnabled: false,  // ❌ التقارير لسه بتستخدم الحساب القديم
};
```

---

## 3️⃣ المفقود (Gaps) — ما يجب إكماله

### A. التقارير تستخدم الحساب القديم الخاطئ
**`@d:\dental-lab-erp\supabase\migrations\070_analytics_rpc.sql:155-195`**

الـ RPC الحالي `get_analytics_summary` بيحسب:
```sql
-- Total receivables  (الحساب الخاطئ الحالي)
SELECT SUM(orders.total_price WHERE status IN ('Delivered','Completed'))
       - SUM(transactions WHERE type='income' AND entity_type='doctor')
```
والـ Aging بيستخدم `delivery_date` مش `due_date`:
```sql
WHERE CURRENT_DATE - oldest_order_date <= 30  -- بيستخدم delivery_date
```

دا اللي بيخلي Aging مش دقيقة وبيخلي `total_receivables` مش متوافقة مع تواريخ الاستحقاق الفعلية.

### B. الـ Historical Backfill لم يُنفّذ
لو فعّلنا التقرير الجديد قبل الـ backfill، كل الحالات القديمة (قبل تفعيل obligations في كود الـ orders) **مش هتظهر** في الذمم.

### C. الـ Allocations لم تُطبَّق فعلياً
المعاملات (transactions) بتدخل كـ `income` لطبيب، لكن **مش بتُربَط** بـ obligation محددة. النتيجة:
- كل الـ `financial_obligations` الموجودة `allocated_amount = 0`
- مش معروف أنهي طبيب سدّد أنهي فاتورة
- FIFO Preview موجود لكن مفيش `applyAllocation()` بيعمل الـ update فعلياً

### D. مش موجود RPC جديد للذمم بناءً على الـ Obligations
محتاجين RPC جديدة تجمع الذمم من جدول `financial_obligations`:
```sql
get_doctor_receivables_v2(start_date, end_date) RETURNS jsonb:
  - total_receivables           (sum remaining)
  - overdue_amount              (remaining WHERE due_date <= today)
  - not_yet_due_amount          (remaining WHERE due_date > today)
  - aging_0_30, 31_60, 61_90, 90+   (على أساس due_date)
  - per_doctor breakdown
```

---

## 4️⃣ الخطة المقترحة — متدرجة وآمنة 100% (بدون تغيير جنيه في أي حساب)

### المبدأ الجوهري:
- **`financial_obligations` جدول معزول تماماً** ومش بيأثر على:
  - أرصدة الأطباء (محسوبة من `orders` + `transactions`)
  - الـ P&L (مبني على `transactions` فقط)
  - الـ COGS / Cash Flow
- التغييرات كلها **إضافية (additive)**: نضيف طبقة جديدة بجانب القديمة، مش نستبدل
- التحقق في كل مرحلة: مقارنة الرقم القديم بالجديد قبل التحويل

---

### المرحلة 1️⃣ — Pre-Flight Validation (لا تأثير على الإنتاج)
**الهدف:** نتأكد إن النظام الموجود فعلاً شغّال صح من غير ما نغيّر حاجة.

**الخطوات:**
1. تشغيل `previewHistoricalObligationsBackfill` (dry-run) من صفحة Finance
   - حصر كل الأوامر المسلّمة اللي ما لهاش obligation في الـ DB
2. مقارنة:
   - عدد الأوامر المسلّمة في `orders` = عدد obligations في `financial_obligations` (للأوامر بعد تفعيل النظام)
   - إجمالي `total_price` للمسلّم = مجموع `gross_amount` لـ obligations
3. تقرير التباين: لو فيه فرق، نفهم سببه قبل أي خطوة

**الـ Deliverables:**
- ملف `obligations-validation-report.md` فيه:
  - عدد الـ orders المسلّمة بدون obligation
  - الفرق المالي (لو موجود)
  - قائمة الأوامر اللي تحتاج backfill

**زمن التنفيذ:** ساعة-ساعتين  
**مخاطر:** صفر — قراءة فقط

---

### المرحلة 2️⃣ — Historical Backfill (إنشاء الالتزامات القديمة)
**الهدف:** التأكد إن كل order مسلّم له obligation مقابل، مع `due_date` محسوب صح.

**الخطوات:**
1. للأوامر بدون billing_settings للطبيب → استخدم default (per_order, 7 days)
2. تنفيذ `createHistoricalObligationsBackfillBatch({ dryRun: false })` على دفعات صغيرة (50 في المرة)
3. كل دفعة: تحقق من النتيجة قبل ما تكمل
4. التحقق النهائي: عدد obligations = عدد الأوامر المسلّمة المؤهلة

**ملاحظات أمان:**
- الـ unique constraint بيمنع التكرار: `uq_financial_obligation_source_trigger`
- كل obligation بيُنشأ بحالة `unpaid` و `allocated_amount = 0`
- **لا يُغيّر أي حساب موجود** — جدول مستقل تماماً

**زمن التنفيذ:** يعتمد على عدد الأوامر (متوقع ساعة لكل 5000 أمر)  
**مخاطر:** منخفضة — موجود dry-run + duplicate detection

---

### المرحلة 3️⃣ — RPC جديد للذمم (V2)
**الهدف:** إنشاء RPC `get_receivables_summary_v2` يقرأ من `financial_obligations`.

**Migration جديد (مثلاً 088):**
```sql
CREATE OR REPLACE FUNCTION get_receivables_summary_v2(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result jsonb;
BEGIN
    WITH active_obligations AS (
        SELECT
            entity_id AS doctor_id,
            due_date,
            remaining_amount
        FROM financial_obligations
        WHERE direction = 'receivable'
          AND entity_type = 'doctor'
          AND status IN ('unpaid', 'partially_paid')
          AND remaining_amount > 0
          -- Optional date scope on trigger_date (للمقارنة مع V1)
          AND (p_start_date IS NULL OR trigger_date >= p_start_date)
          AND (p_end_date IS NULL OR trigger_date <= p_end_date)
    )
    SELECT jsonb_build_object(
        -- إجمالي الذمم
        'total_receivables', COALESCE(SUM(remaining_amount), 0),
        -- مستحقة الآن (overdue + due today)
        'overdue_amount', COALESCE(SUM(remaining_amount) FILTER (WHERE due_date <= CURRENT_DATE), 0),
        -- لسه مش مستحقة
        'not_yet_due', COALESCE(SUM(remaining_amount) FILTER (WHERE due_date > CURRENT_DATE), 0),
        -- Aging based on due_date (الصح)
        'aging_0_30',  COALESCE(SUM(remaining_amount) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 0 AND 30), 0),
        'aging_31_60', COALESCE(SUM(remaining_amount) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 31 AND 60), 0),
        'aging_61_90', COALESCE(SUM(remaining_amount) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 61 AND 90), 0),
        'aging_90_plus', COALESCE(SUM(remaining_amount) FILTER (WHERE CURRENT_DATE - due_date > 90), 0),
        -- للمقارنة مع V1
        'doctor_count', COUNT(DISTINCT doctor_id)
    ) INTO result
    FROM active_obligations;

    RETURN COALESCE(result, '{}'::jsonb);
END $$;
```

**الـ Deliverables:**
- Migration 088 جديد
- TypeScript wrapper في `analyticsService.ts`: `getReceivablesSummaryV2()`

**زمن التنفيذ:** ساعة-ساعتين  
**مخاطر:** صفر — RPC جديد، مش مُعدّل

---

### المرحلة 4️⃣ — التحقق المتوازي (Parallel Verification)
**الهدف:** نعرض الرقمين جنب بعض في الواجهة عشان نتأكد إن الجديد منطقي.

**خطوة في Analytics.tsx:**
- في الفترة دي، نخلي صفحة التحليلات تعرض:
  - الذمم بالحساب القديم (الموجود الآن)
  - الذمم بالحساب الجديد V2
  - الفرق ونسبته
- لو في انحراف كبير، نراجع قبل التحويل
- لو الفرق طبيعي (مثلاً الجديد بيقسّم between overdue/pending), نكمل

**زمن التنفيذ:** ساعة  
**مخاطر:** صفر — مجرد عرض

---

### المرحلة 5️⃣ — التحويل النهائي + استبدال "إيراد معلّق"
**الهدف:** الواجهة تستخدم V2 رسمياً، ونغيّر صياغة "إيراد معلّق".

**التغييرات في `Analytics.tsx`:**
1. كارد "إيراد معلّق" يتحوّل لكارد **"ذمم مستحقة الآن"** = `overdue_amount` من V2
2. نضيف صف فرعي: **"لسه ما استحقتش"** = `not_yet_due` من V2 (للعرض فقط)
3. Aging يستخدم `aging_*` من V2 (المبني على due_date)
4. الحساب القديم يفضل في الـ Code للـ rollback لو احتاج

**تفعيل الـ Flag:**
```ts
FINANCIAL_OBLIGATIONS_FLAGS = {
    trackingEnabled: true,
    reportingEnabled: true,  // ⭐ تفعيل
};
```

**زمن التنفيذ:** ساعة  
**مخاطر:** منخفضة — لو في مشكلة، الـ flag يرجع لـ false

---

### المرحلة 6️⃣ (مؤجلة — تحتاج قرار منفصل): تطبيق Allocations فعلياً
**ما هو:** ربط كل دفعة `income` بـ obligation محددة (FIFO)، تحديث `allocated_amount`.

**ليه مؤجلة:**
- بتغيّر بيانات في `financial_obligations` بشكل دائم
- لو غلط، الـ obligations هتدّعي إنها مدفوعة من غير ما تكون
- **محتاج migration منفصل + تجربة على staging أولاً**

**التفاصيل التقنية الجاهزة:**
- `allocationPreview` موجود ويعطي خطة FIFO
- المطلوب: function `applyAllocation(allocationPlan)` بتعمل UPDATE فعلي على `allocated_amount`
- ربطها بـ trigger على insert في transactions

---

## 5️⃣ ملخص الـ Hard Gates / ضوابط الأمان

| الضابط | الحالة | التحقق |
|---|---|---|
| لا تغيير في `transactions` أو `orders` | ✅ مضمون | الخطة تضيف ولا تحذف |
| لا تغيير في حسابات الأطباء الحالية | ✅ مضمون | V1 يبقى للحساب القديم |
| لا تغيير في P&L أو Cash Flow | ✅ مضمون | لا علاقة لـ obligations بـ income/expense |
| Migration 086/087 لا يُنشر برودكشن | ✅ موجود في memory | المرحلة 3 تستخدم migration جديد 088 |
| كل مرحلة قابلة للـ rollback | ✅ | الـ flag + V1 يبقى موجود |

---

## 6️⃣ الأولويات المقترحة للتنفيذ

```
المرحلة 1 ← ابدأ هنا (validation فقط، صفر مخاطر)
المرحلة 2 ← بعد التحقق من النتايج
المرحلة 3 ← مع المرحلة 2 بالتوازي (إنشاء RPC)
المرحلة 4 ← قبل التحويل النهائي (parallel display)
المرحلة 5 ← التحويل الفعلي
المرحلة 6 ← قرار منفصل، بعد استقرار 5
```

**التقدير الإجمالي للمراحل 1-5:** يوم واحد عمل فعلي (لو الـ backfill ما واجهش مشاكل).

---

## 7️⃣ ما هو غير مطلوب الآن

- لا نُعدّل صياغة الحساب الحالي في `total_income` أو `total_sales_value`
- لا نلمس `transactions` ولا أرصدة الأطباء
- لا نطبّق Allocations فعلياً (مرحلة 6 مؤجلة)
- لا نعمل migration على prod قبل ما نختبر على local/staging

---

*آخر تحديث: 2026-05-27*  
*المرجع: تقرير الذمم/الاستحقاقات لنظام dental-lab-erp*
