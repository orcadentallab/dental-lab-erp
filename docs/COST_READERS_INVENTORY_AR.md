# جرد قرّاء التكلفة — البند الإلزامي 5.2 في خطة المعمل الداخلي

> **الخطة:** [`docs/INTERNAL_LAB_PLAN_AR.md`](./INTERNAL_LAB_PLAN_AR.md) القسم 5.2
> **آخر تحديث:** 2026-08-27
> **الحالة:** `production_v1 = 'off'` — كل الأرقام تحت لسه على المعنى القديم

---

## المشكلة في سطر واحد

النهارده **«التكلفة» = فاتورة المعمل الخارجي** (`orders.cost` / `orders.manual_cost`).
بعد الـ cutover **«التكلفة» = خامات + مصنعية + أوفرهيد** (`get_order_cost_breakdown`).

مفيش حاجة هتقع ومفيش error هيظهر. التقارير هتفضل تطلّع رقم بنفس الثقة، بس بتجاوب على
سؤال تاني. ورسم بياني شهر بشهر بيعدّي على الخط ده بيقارن تعريفين مختلفين كأنهم سلسلة واحدة.

عشان كده الجرد ده موجود: كل مكان بيقرا تكلفة، ومكتوب جنبه هيتصرف إزاي يوم الـ cutover.

---

## أ. الـ RPCs اللي بتقرا تكلفة

| الـ RPC | بيقرا إيه | الحالة بعد الـ cutover | الإجراء |
|---|---|---|---|
| `get_analytics_summary_privileged_20260801` | `COALESCE(manual_cost, cost)` كـ COGS | ⚠️ **هيبقى ناقص** — مش هيشوف الخامات ولا المصنعية ولا الأوفرهيد | يتغذّى من `get_order_cost_breakdown` وقت تشغيل المعمل |
| `get_doctor_service_profitability` | `COALESCE(manual_cost, cost)` لهامش الطبيب | ⚠️ **هيبقى ناقص** — نفس السبب | نفس الإجراء |
| `get_order_cost_breakdown` | خامات + مصنعية + أوفرهيد، وبيرجع لـ `orders.cost` للحالات الخارجية | ✅ **صح على الجانبين** | مصدر الحقيقة الجديد |
| `get_internal_vs_external_benchmark` | `get_order_cost_breakdown` للداخلي، `orders.cost` للخارجي | ✅ **صح بالتصميم** — هو ده التقرير اللي بيقارن الاتنين | — |
| `capture_cutover_baseline` | `COALESCE(manual_cost, cost)` عن قصد | ✅ **مقصود** — بيجمّد العالم القديم | يتشغّل **قبل** فتح الفلاج |
| `get_cost_of_quality_report` | `rejected_lab_cost` (مش `orders.cost`) | ✅ مش متأثر | — |

**الحسابات المالية (`financial_obligations`, `transactions`, كشوف الحساب) مش في الجدول ده عن قصد.**
تكلفة المورد الخارجي هتفضل ماشية زي ما هي بالظبط. التكلفة الداخلية **ممنوع** تلمسها — القسم 3 في الخطة.

---

## ب. الشاشات اللي بتعرض تكلفة

| الشاشة | المصدر | الحالة بعد الـ cutover |
|---|---|---|
| `src/pages/Analytics.tsx` | `get_analytics_summary_*` | ⚠️ محتاجة شريط التحذير |
| `src/pages/DoctorServiceProfitability.tsx` | `get_doctor_service_profitability` | ⚠️ محتاجة شريط التحذير |
| `src/pages/CashFlow.tsx` | تدفق نقدي (فعلي مدفوع) | ✅ مش متأثرة — الكاش كاش |
| `src/pages/reports/ProductionCostingReport.tsx` | `get_order_cost_breakdown` وإخواتها | ✅ مبنية على التعريف الجديد |
| `src/pages/production/ExternalWorkOrders.tsx` | `agreed_cost` للمورد | ✅ مش متأثرة |
| `src/pages/Suppliers.tsx` · `Accounts.tsx` · `Statements.tsx` · `AgingReport.tsx` | التزامات ومعاملات | ✅ مش متأثرة (القسم 3) |
| `src/pages/Orders.tsx` · `CaseRegistration.tsx` | `orders.cost` كتقدير للحالة | ⚠️ هيفضل تقدير المورد بس |

---

## ج. الأدوات اللي اتبنت للبند ده

1. **حد الـ cutover** — `get_cutover_boundary()` بيرجّع `cutover_at`.
   بيتختم أوتوماتيك أول ما `production_v1` يتقلب لـ `'on'` (تريجر على `app_settings`).
   بيرجّع `NULL` دلوقتي، ومعناها إن مفيش أي مقارنة ممكن تعدّي الخط.
2. **خط الأساس** — `capture_cutover_baseline(from, to)` بيجمّد صورة الفترة القديمة
   في `cutover_financial_baseline` (إجمالي/وحدة، مقسّمة على العيلة والمورد). جدول للقراءة بس.
3. **شريط التحذير** — `src/components/reports/CutoverComparisonNotice.tsx`
   بيظهر بس لما الفترة المعروضة تعدّي `cutover_at`.

---

## د. الخطوات يوم فتح المعمل — بالترتيب

1. `capture_cutover_baseline('<بداية>', '<آخر يوم قبل الفتح>')` — **قبل أي حاجة تانية**.
2. تظبيط أسعار الخامات و `labor_rates` لكل مرحلة.
3. تجميد أوفرهيد أول شهر بـ `freeze_overhead_allocation`.
4. تحويل `get_analytics_summary_*` و `get_doctor_service_profitability` يقروا من
   `get_order_cost_breakdown` للحالات الداخلية.
5. **بعدين بس** يتقلب `production_v1 = 'on'`.

> الخطوة 4 قبل الخطوة 5. لو الفلاج اتفتح والتقارير لسه بتقرا `orders.cost`، هتقول إن
> التكلفة نزلت لصفر والهامش بقى 100% — وده هيبان كأنه نجاح.
