# خطة تطوير صفحة التقارير والتحليلات — dental-lab-erp

> **الهدف:** صفحة تقارير احترافية كاملة يمكن الاعتماد عليها لاتخاذ قرارات تشغيلية ومالية.
> **الملف الرئيسي:** `src/pages/Analytics.tsx`  
> **المكون المساعد:** `src/components/finance/StatementTab.tsx`  
> **خدمة البيانات:** `src/services/supabase/analyticsService.ts`

---

## الوضع الحالي — ملخص الكود

### الأتباب الأربعة:
| التاب | الوضع |
|---|---|
| `overview` | 4 KPIs + تحليل سريع + أكثر أطباء/خدمات |
| `financial` | Cash Flow + P&L + Receivables Aging |
| `service_analysis` | جدول خدمات مفصّل (StatementTab) |
| `expense_analysis` | جدول مصروفات بالفئة (StatementTab) |

### البيانات المتاحة من RPC لكن غير معروضة:
```
AnalyticsSummary (src/services/supabase/analyticsService.ts):
  ✗ redo_count          — عدد الإعادات
  ✗ redo_cost           — تكلفة الإعادات
  ✗ urgent_count        — الحالات العاجلة
  ✗ doctor_collections  — تحصيلات الأطباء
  ✗ supplier_payments   — مدفوعات الموردين
  ✗ designer_payments   — مدفوعات المصممين
  ✗ production_costs    — يُستخدم في الحساب فقط، غير معروض كـ KPI
  ✓ total_receivables   — معروض
  ✓ aging_*             — معروضة
```

### البجات الموجودة:
1. **DSO Bug** في `Analytics.tsx` السطر 284:
   ```ts
   // قبل (خطأ):
   const daysInPeriod = dateRange === 'month' ? 30 : dateRange === 'year' ? 365 : 30;
   // بعد (صح):
   const daysInPeriod = startDate && endDate
       ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000*60*60*24)))
       : 30;
   ```

2. **pending_revenue** محسوب بس مش بارز (مخبي في الـ state).

---

## PHASE 1 — إصلاح البجات + إضافة KPIs المخفية
**الملف:** `src/pages/Analytics.tsx`
**التقدير:** 30-45 دقيقة
**المراجعة:** تحقق TypeScript، تحقق بصري

### 1.1 تصحيح DSO
- في `calculateStats()` (السطر ~284)، استبدل حساب `daysInPeriod` بالصيغة الصحيحة أعلاه.

### 1.2 إضافة KPIs جديدة للنظرة العامة
في state `stats`، أضف الحقول التالية:
```ts
// في useState الخاص بـ stats — أضف:
redoCount: 0,
redoCost: 0,
urgentCount: 0,
pendingRevenue: 0,   // موجود بس أعد تسميته من summary
productionCosts: 0,  // موجود
collectionRate: 0,   // حسابه: (totalRevenue / deliveredRevenue) * 100
```

في `calculateStats()` بعد `setStats(...)`:
```ts
// أضف هذه القيم من summary:
redoCount: summary.redo_count,
redoCost: summary.redo_cost,
urgentCount: summary.urgent_count,
pendingRevenue: summary.total_sales_value - summary.total_income,
```

### 1.3 عرض KPIs الجديدة في الـ Overview Tab
في قسم "Quick Stats Grid" (السطر ~718 في Analytics.tsx)، أضف كاردات:

**الكارد الأول — الإيراد المعلّق:**
```tsx
<div className="bg-gradient-to-br from-amber-50 to-white p-5 rounded-xl border border-amber-100 text-center">
    <div className="flex justify-center mb-2">
        <div className="p-2 bg-amber-100 rounded-lg">
            <CreditCard size={16} className="text-amber-600" />
        </div>
    </div>
    <p className="text-amber-600 text-xs font-bold uppercase mb-1">إيراد معلّق (غير محصّل)</p>
    <p className="text-2xl font-black text-amber-900">{stats.pendingRevenue.toLocaleString()}</p>
    <p className="text-xs text-amber-500 mt-1">ج.م</p>
</div>
```

**الكارد الثاني — الإعادات:**
```tsx
<div className="bg-gradient-to-br from-orange-50 to-white p-5 rounded-xl border border-orange-100 text-center">
    <div className="flex justify-center mb-2">
        <div className="p-2 bg-orange-100 rounded-lg">
            <RefreshCcw size={16} className="text-orange-600" />
        </div>
    </div>
    <p className="text-orange-600 text-xs font-bold uppercase mb-1">الإعادات</p>
    <p className="text-2xl font-black text-orange-900">{stats.redoCount}</p>
    <p className="text-xs text-orange-500 mt-1">
        تكلفة: {stats.redoCost.toLocaleString()} ج.م
    </p>
</div>
```

**الكارد الثالث — الحالات العاجلة:**
```tsx
<div className="bg-gradient-to-br from-red-50 to-white p-5 rounded-xl border border-red-100 text-center">
    <div className="flex justify-center mb-2">
        <div className="p-2 bg-red-100 rounded-lg">
            <Zap size={16} className="text-red-600" />
        </div>
    </div>
    <p className="text-red-600 text-xs font-bold uppercase mb-1">حالات عاجلة</p>
    <p className="text-2xl font-black text-red-900">{stats.urgentCount}</p>
    <p className="text-xs text-red-400 mt-1">نشطة حالياً</p>
</div>
```

**الكارد الرابع — تكلفة الإنتاج:**
```tsx
<div className="bg-gradient-to-br from-purple-50 to-white p-5 rounded-xl border border-purple-100 text-center">
    <div className="flex justify-center mb-2">
        <div className="p-2 bg-purple-100 rounded-lg">
            <Package size={16} className="text-purple-600" />
        </div>
    </div>
    <p className="text-purple-600 text-xs font-bold uppercase mb-1">تكلفة الإنتاج</p>
    <p className="text-2xl font-black text-purple-900">{stats.productionCosts.toLocaleString()}</p>
    <p className="text-xs text-purple-400 mt-1">ج.م</p>
</div>
```

> ⚠️ **ملاحظة:** غيّر الـ grid من `grid-cols-2 lg:grid-cols-4` إلى `grid-cols-2 lg:grid-cols-4 xl:grid-cols-4` واجعل الكاردات الأصلية (4) + الجديدة (4) في صفين.

---

## PHASE 2 — نظرة عامة محسّنة ومنظمة
**الملف:** `src/pages/Analytics.tsx`
**التقدير:** 60-90 دقيقة
**المراجعة:** visual review + TypeScript

### 2.1 إعادة ترتيب KPI Bar الأساسية (أول 4 كاردات)
الترتيب الجديد المقترح:
```
[المبيعات] [التحصيل الفعلي] [صافي الربح] [الإيراد المعلّق]
```
- **"التحصيل الفعلي"** = `stats.totalRevenue` (ما قُبض فعلاً من الأطباء)
- يعطي صورة فورية: كم بعنا vs كم قبضنا

### 2.2 ثاني صف KPIs
```
[مجمل الربح + هامش%] [مصروفات التشغيل + %] [الإعادات + تكلفة] [حالات عاجلة]
```

### 2.3 "لوحة الصحة" — Quick Health Dashboard
استبدل "تحليل سريع" الحالي بـ "لوحة الصحة" (HealthScorePanel) تحتوي:

**ثلاثة مؤشرات مع progress bar:**
1. **هامش صافي الربح** — target: 30%+
   - أخضر: ≥30% | أصفر: 20-30% | أحمر: <20%
2. **معدل التحصيل** — target: 85%+
   - = `(totalRevenue / deliveredRevenue) * 100`
   - أخضر: ≥85% | أصفر: 70-85% | أحمر: <70%
3. **معدل الإعادات** — target: <5%
   - = `(redo_count / total_order_count) * 100`
   - أخضر: <5% | أصفر: 5-10% | أحمر: >10%

**إضافة نص توجيهي ذكي:**
```tsx
const healthInsight = (): string => {
    if (redoRate > 10) return '⚠️ معدل الإعادات مرتفع — راجع جودة الإنتاج';
    if (collectionRate < 70) return '⚠️ التحصيل ضعيف — اتبع مع الأطباء المتأخرين';
    if (netMargin < 20) return '⚠️ هامش الربح منخفض — راجع تسعير الخدمات';
    return '✅ الأداء العام جيد';
};
```

### 2.4 تحسين قسم "أكثر العملاء نشاطاً"
أضف للكل طبيب في القائمة:
- `نسبة السداد%` = `مدفوع / إجمالي`
- `badge` ملوّن: أخضر (≥80%) / أصفر (50-80%) / أحمر (<50%)

هذا يتطلب تعديل `get_top_doctors` RPC أو إضافة RPC جديد.
**البديل بدون RPC:** استخدم البيانات المتاحة من `analyticsService.getTopDoctors` وأضف collection data.

> **مؤجل:** يحتاج RPC تعديل. انتقل لـ Phase 3 أولاً.

---

## PHASE 3 — التحليل المالي المتكامل
**الملف:** `src/pages/Analytics.tsx` (قسم `activeTab === 'financial'`)
**التقدير:** 60-90 دقيقة

### 3.1 تصحيح DSO (من Phase 1 — الأكثر أهمية)
تم وصفه في Phase 1.1.

### 3.2 تفصيل COGS (قائمة الدخل)
في قسم P&L، فصّل سطر "تكلفة البضائع المباعة" إلى:
```
تكلفة الإنتاج (موردين)   ← summary.production_costs
مدفوعات المصممين         ← summary.designer_payments
───────────────────────
إجمالي COGS               ← summary.total_cost_of_goods
```

الكود المقترح (يُضاف بين COGS row وGross Profit row):
```tsx
{/* COGS Breakdown */}
<div className="mr-4 space-y-1 border-r-2 border-rose-200 pr-4">
    <div className="flex justify-between text-sm text-slate-600">
        <span>↳ مدفوعات الموردين</span>
        <span className="font-medium text-rose-500">{financialStats.productionCosts.toLocaleString()} ج.م</span>
    </div>
    <div className="flex justify-between text-sm text-slate-600">
        <span>↳ مدفوعات المصممين</span>
        <span className="font-medium text-rose-500">{financialStats.designerPayments.toLocaleString()} ج.م</span>
    </div>
</div>
```
أضف `designerPayments` و`productionCosts` لـ `financialStats` state من `summary.designer_payments` و `summary.production_costs`.

### 3.3 تفصيل المدفوعات في Cash Flow
```
المقبوضات:
  ↳ تحصيلات الأطباء      ← summary.doctor_collections
المدفوعات:
  ↳ مدفوعات الموردين     ← summary.supplier_payments
  ↳ مدفوعات المصممين     ← summary.designer_payments
  ↳ مصروفات تشغيلية      ← summary.operating_expenses
```

### 3.4 إضافة KPI "الذمم الدائنة" بشكل صحيح
حالياً الذمم الدائنة (payables) بتتعرض كرقم كلي فقط.
أضف breakdown:
```tsx
<div className="grid grid-cols-2 gap-3 mt-4">
    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
        <p className="text-xs text-slate-500 mb-1">مستحق للموردين</p>
        <p className="font-black text-slate-800">
            {financialStats.supplierPayables.toLocaleString()} ج.م
        </p>
    </div>
    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
        <p className="text-xs text-slate-500 mb-1">مستحق للمصممين</p>
        <p className="font-black text-slate-800">
            {financialStats.designerPayables.toLocaleString()} ج.م
        </p>
    </div>
</div>
```
> ⚠️ `total_payables` موجود في summary — يحتاج تفصيل في الـ RPC.
> **للحين:** اعرض `total_payables` فقط وضع الـ breakdown كـ TODO.

### 3.5 KPI التعادل (Break-even indicator)
أضف بطاقة بسيطة في نهاية التحليل المالي:
```tsx
{/* نقطة التعادل */}
const monthlyFixedCosts = financialStats.operatingExpenses;
const avgContributionMarginPerUnit = financialStats.grossMargin / 100;
const breakEvenRevenue = avgContributionMarginPerUnit > 0
    ? monthlyFixedCosts / avgContributionMarginPerUnit
    : 0;
const isBelowBreakEven = financialStats.salesRevenue < breakEvenRevenue;
```
```tsx
<div className={clsx(
    "p-5 rounded-xl border",
    isBelowBreakEven ? "bg-rose-50 border-rose-200" : "bg-emerald-50 border-emerald-200"
)}>
    <h4 className="font-bold text-sm mb-2">نقطة التعادل التقديرية</h4>
    <p className="text-2xl font-black">{Math.round(breakEvenRevenue).toLocaleString()} ج.م</p>
    <p className={clsx("text-xs mt-1 font-medium", isBelowBreakEven ? "text-rose-600" : "text-emerald-600")}>
        {isBelowBreakEven
            ? `⚠️ أنت تحت نقطة التعادل بـ ${Math.round(breakEvenRevenue - financialStats.salesRevenue).toLocaleString()} ج.م`
            : `✅ تجاوزت التعادل بـ ${Math.round(financialStats.salesRevenue - breakEvenRevenue).toLocaleString()} ج.م`
        }
    </p>
</div>
```

---

## PHASE 4 — تحليل الخدمات المتقدم
**الملف:** `src/components/finance/StatementTab.tsx`
**التقدير:** 90-120 دقيقة

### 4.1 إضافة تأثير الرفض per service
في `serviceAnalytics` useMemo — أضف للـ map:
```ts
interface ServiceStats {
    // ... الموجود
    rejectedCases: number;     // جديد
    rejectedCost: number;      // جديد
    rejectionRate: number;     // جديد: rejectedCases / totalCases * 100
}
```
في الـ loop، عندما `isRejected === true`:
```ts
entry.rejectedCases = (entry.rejectedCases || 0) + 1;
entry.rejectedCost = (entry.rejectedCost || 0) + effectiveCost;
```

في جدول الخدمات، أضف column بعد "أكثر طبيب":
```tsx
<th className="p-3 font-semibold text-center whitespace-nowrap">نسبة الرفض</th>
// ...
<td className="p-3 text-center">
    {svc.rejectedCases > 0 ? (
        <div>
            <span className={clsx(
                "text-xs font-bold px-2 py-0.5 rounded-full",
                svc.rejectionRate > 10 ? "bg-rose-100 text-rose-700" : "bg-amber-50 text-amber-600"
            )}>
                {svc.rejectionRate.toFixed(1)}%
            </span>
            <p className="text-[10px] text-gray-400 mt-0.5">{svc.rejectedCases} حالة</p>
        </div>
    ) : <span className="text-[10px] text-emerald-500 font-medium">لا رفض ✓</span>}
</td>
```

### 4.2 مصفوفة الطبيب × الخدمة
أضف قسم جديد بعد جدول الخدمات:
```tsx
{/* Doctor × Service Matrix */}
<div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
    <div className="p-4 border-b bg-gray-50/50 flex items-center gap-2">
        <Users size={16} className="text-teal-600" />
        <h3 className="font-bold text-gray-800">مصفوفة الأطباء × الخدمات</h3>
    </div>
    <div className="overflow-x-auto p-4">
        {/* جدول: rows = doctors (top 5-8), cols = services */}
        {/* كل خلية = إجمالي الوحدات أو إيراد */}
    </div>
</div>
```

**طريقة البناء:**
```ts
const doctorServiceMatrix = useMemo(() => {
    // من filteredOrders، ابن map: doctorId → serviceType → { units, revenue }
    const matrix = new Map<string, Map<string, {units: number; revenue: number}>>();
    filteredOrders.forEach(o => {
        const dId = o.doctorId || '';
        if (!matrix.has(dId)) matrix.set(dId, new Map());
        const dRow = matrix.get(dId)!;
        (o.items as any[]).forEach((item: any) => {
            const svc = item.serviceType;
            if (!dRow.has(svc)) dRow.set(svc, {units: 0, revenue: 0});
            const cnt = Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1;
            dRow.get(svc)!.units += cnt;
        });
    });
    return matrix;
}, [filteredOrders]);
```

الـ top doctors: أعلى 6 بالإيراد. الـ top services: أعلى 6 بالوحدات.
كل خلية: عدد الوحدات — خلفيتها proportional (opacity تزداد مع الحجم).

### 4.3 Service Mix Visual Summary
أضف قبل الجدول: شريط أفقي مركّب يبيّن توزيع الإيراد بين الخدمات.
```tsx
<div className="w-full h-6 rounded-full flex overflow-hidden gap-0.5 mb-4">
    {serviceAnalytics.slice(0, 6).map((svc, i) => (
        <div
            key={svc.serviceName}
            className={COLORS[i % COLORS.length]}
            style={{width: `${(svc.totalRevenue / totalRevenue * 100).toFixed(1)}%`}}
            title={`${svc.serviceName}: ${(svc.totalRevenue / totalRevenue * 100).toFixed(1)}%`}
        />
    ))}
</div>
// Legend under the bar
```
```ts
const COLORS = ['bg-teal-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-400'];
```

---

## PHASE 5 — تحليل المصروفات المتقدم
**الملف:** `src/components/finance/StatementTab.tsx`
**التقدير:** 60-90 دقيقة

### 5.1 Trend شهري per category
في `expenseCategoryStats` useMemo — `monthlyMap` موجود بالفعل.
استخدمه لعرض **sparkline** بسيط (CSS-only).

```ts
// في كل category entry، أضف:
monthlyTrend: Array.from(d.monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amount]) => ({ month, amount })),
```

**Sparkline بسيط بدون رسم:**
```tsx
{/* Mini Trend — آخر 4 شهور */}
<div className="flex items-end gap-0.5 h-6">
    {cat.monthlyTrend.slice(-4).map((m: any, i: number) => {
        const maxVal = Math.max(...cat.monthlyTrend.slice(-4).map((x: any) => x.amount));
        const h = maxVal > 0 ? Math.round((m.amount / maxVal) * 100) : 0;
        return (
            <div key={i} className="w-2 bg-rose-300 rounded-sm transition-all"
                style={{height: `${h}%`}} title={`${m.month}: ${m.amount.toLocaleString()}`} />
        );
    })}
</div>
```
أضف هذا الـ cell في جدول المصروفات بعد "أكثر شهر".

### 5.2 Insight: نسبة المصروف التشغيلي من الإيراد
أضف KPI card خامس في قسم المصروفات:
```tsx
// يحتاج stats.deliveredRevenue — مرره كـ prop للـ StatementTab
// إضافة prop: salesRevenue?: number
const expenseToRevenueRatio = salesRevenue > 0
    ? (expenseData.totalAmount / salesRevenue) * 100 : 0;
```
```tsx
<div className={clsx("bg-white p-5 rounded-2xl border shadow-sm flex items-center gap-3",
    expenseToRevenueRatio > 30 ? "border-rose-200" : "border-emerald-100"
)}>
    <div className={clsx("p-3 rounded-xl",
        expenseToRevenueRatio > 30 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
    )}>
        <BarChart3 size={22} />
    </div>
    <div>
        <p className="text-xs text-gray-500 font-medium">% من الإيراد</p>
        <h4 className="text-xl font-black">
            {expenseToRevenueRatio.toFixed(1)}%
            <span className={clsx("text-xs font-normal mr-1",
                expenseToRevenueRatio > 30 ? "text-rose-500" : "text-emerald-500"
            )}>
                {expenseToRevenueRatio > 30 ? '↑ مرتفع' : '✓ مقبول'}
            </span>
        </h4>
    </div>
</div>
```

### 5.3 قسم مصروفات الموردين والمصممين (مفصولة)
حالياً `NON_OPERATIONAL_CATEGORIES = ['supplier_payment', 'designer_payment']` مستبعدة تماماً.
أضف **sub-section** منفصل أسفل جدول المصروفات:
```tsx
{/* مدفوعات غير تشغيلية */}
const nonOpExpenses = transactions.filter(t =>
    t.type === 'expense' &&
    NON_OPERATIONAL_CATEGORIES.includes(t.category || '') &&
    /* تطبيق نفس date filter */
);
const supplierPayTotal = nonOpExpenses.filter(t => t.category === 'supplier_payment')
    .reduce((s, t) => s + (t.amount || 0), 0);
const designerPayTotal = nonOpExpenses.filter(t => t.category === 'designer_payment')
    .reduce((s, t) => s + (t.amount || 0), 0);
```
```tsx
<div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 mt-4">
    <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
        <DollarSign size={16} className="text-slate-500" />
        المدفوعات للموردين والمصممين (غير التشغيلية)
    </h4>
    <div className="grid grid-cols-2 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">مدفوعات الموردين</p>
            <p className="text-xl font-black text-slate-800">{supplierPayTotal.toLocaleString()} ج.م</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">مدفوعات المصممين</p>
            <p className="text-xl font-black text-slate-800">{designerPayTotal.toLocaleString()} ج.م</p>
        </div>
    </div>
</div>
```

---

## ترتيب التنفيذ المقترح (priority order)

```
Phase 1  ← ابدأ هنا (أسرع تأثير، إصلاح بجات فعلية)
Phase 2  ← نظرة عامة أوضح وأكثر قيمة
Phase 3  ← تحليل مالي دقيق
Phase 4  ← تحليل خدمات متقدم
Phase 5  ← تحليل مصروفات متقدم
```

---

## ملاحظات للمراجعة بعد كل Phase

### TypeScript:
```bash
npx tsc -b --noEmit
```

### الملفات المتأثرة في كل Phase:
| Phase | الملفات |
|---|---|
| 1 | `src/pages/Analytics.tsx` |
| 2 | `src/pages/Analytics.tsx` |
| 3 | `src/pages/Analytics.tsx` |
| 4 | `src/components/finance/StatementTab.tsx` |
| 5 | `src/components/finance/StatementTab.tsx` |

---

## الـ RPC المطلوبة مستقبلاً (تؤجل لما بعد الـ Phases الخمسة)

1. **`get_top_doctors` يرجع أيضاً: `collection_rate%`** — لعرض نسبة السداد per doctor
2. **`get_analytics_summary` يرجع `payables_to_suppliers` و `payables_to_designers`** — لتفصيل الذمم الدائنة
3. **`get_monthly_trend`** — يرجع إيراد + مصروفات + ربح لكل شهر في السنة (لرسم خط بياني مستقبلاً)

---

*آخر تحديث: 2026-05-27*
