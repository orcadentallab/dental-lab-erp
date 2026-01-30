# 🧠 AI Analytics Page - Implementation Plan

## Overview

صفحة تحليلات ذكية للمعمل تعتمد على **Google Gemini API** لتقديم insights تلقائية وإجابة على استفسارات المستخدم.

---

## 📋 Requirements Summary

| المتطلب | التفاصيل |
|---------|----------|
| **AI Provider** | Google Gemini API (مجاني) |
| **الوصول** | Admins فقط |
| **التحليل التلقائي** | كل أسبوع |
| **Chat** | عند الطلب |
| **حفظ المحادثات** | نعم (في Supabase) |
| **حفظ التحليلات** | نعم (في Supabase) |
| **API Key** | Supabase Secrets (آمن على السيرفر) |

---

## 🏗️ Architecture

> ⚠️ **Security Note**: API Key is stored in Supabase secrets, NOT in frontend code.

```
┌─────────────────────────────────────────────────────────┐
│                    AI Analytics Page                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │ Weekly Insights │  │      Chat Interface         │   │
│  │  (Auto-saved)   │  │  (On-demand questions)      │   │
│  └────────┬────────┘  └──────────────┬──────────────┘   │
│           │                          │                   │
│           └──────────┬───────────────┘                   │
│                      ▼                                   │
│           ┌─────────────────────┐                        │
│           │  Frontend Service   │                        │
│           │ (gemini.ts client)  │                        │
│           └──────────┬──────────┘                        │
│                      ▼                                   │
│    ════════════════════════════════════════════════     │
│                 SUPABASE EDGE FUNCTION                   │
│    ════════════════════════════════════════════════     │
│                      ▼                                   │
│           ┌─────────────────────┐                        │
│           │   Gemini API        │                        │
│           │ (API Key in secrets)│                        │
│           └─────────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

### Why Edge Functions?
| Concern | Solution |
|---------|----------|
| API Key Exposure | Stored in Supabase secrets, never sent to browser |
| Rate Limiting | Server-side control |
| Cost Control | Can add usage limits |
| Authentication | Uses Supabase JWT automatically |

---

## 📁 Files to Create/Modify

### New Files (Frontend)

| File | Purpose |
|------|---------|
| `src/pages/AIAnalytics.tsx` | Main page component |
| `src/services/gemini.ts` | Client to call Edge Function (NOT Gemini directly) |
| `src/components/ai/InsightCard.tsx` | Insight display card |
| `src/components/ai/ChatInterface.tsx` | Chat interface component |
| `src/components/ai/ChatMessage.tsx` | Chat message bubble |
| `supabase/migrations/041_add_ai_tables.sql` | Database tables |

### New Files (Edge Function)

| File | Purpose |
|------|---------|
| `supabase/functions/gemini-chat/index.ts` | Edge function for chat |
| `supabase/functions/gemini-analyze/index.ts` | Edge function for weekly analysis |

### Files to Modify

| File | Changes |
|------|---------|
| `src/App.tsx` | Add route for `/ai-analytics` |
| `src/components/layout/DashboardLayout.tsx` | Add sidebar link (admin only) |

---

## 🗄️ Database Schema

### Table: `ai_insights`

```sql
CREATE TABLE ai_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    insight_type TEXT NOT NULL, -- 'weekly_auto' | 'on_demand'
    content TEXT NOT NULL,
    data_context JSONB, -- snapshot of data used
    
    -- ⭐ Versioning (for future prompt improvements)
    model_version TEXT DEFAULT 'gemini-1.5-flash',
    prompt_version TEXT DEFAULT 'v1.0',
    
    -- ⭐ Rating (for prompt optimization)
    rating TEXT, -- 'useful' | 'not_useful' | NULL
    rated_at TIMESTAMPTZ,
    rated_by UUID REFERENCES users(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);
```

### Table: `ai_conversations`

```sql
CREATE TABLE ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `ai_messages`

```sql
CREATE TABLE ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 📋 Task Breakdown

### Phase 1: Foundation (Day 1)

- [ ] **1.1** Create database migration `041_add_ai_tables.sql`
- [ ] **1.2** Create Edge Function `supabase/functions/gemini-chat/index.ts`
- [ ] **1.3** Create Edge Function `supabase/functions/gemini-analyze/index.ts`
- [ ] **1.4** Add Gemini API Key to Supabase Secrets
- [ ] **1.5** Create `src/services/gemini.ts` (calls Edge Functions, NOT Gemini directly)
- [ ] **1.6** Create data aggregator function

### Phase 2: UI Components (Day 2)

- [ ] **2.1** Create `InsightCard.tsx` component
- [ ] **2.2** Create `ChatMessage.tsx` component
- [ ] **2.3** Create `ChatInterface.tsx` component
- [ ] **2.4** Create `AIAnalytics.tsx` page

### Phase 3: Integration (Day 3)

- [ ] **3.1** Add route in `App.tsx` (admin protected)
- [ ] **3.2** Add sidebar link in `DashboardLayout.tsx`
- [ ] **3.3** Implement weekly insight generation
- [ ] **3.4** Implement chat functionality

### Phase 4: Polish (Day 4)

- [ ] **4.1** Add loading states and error handling
- [ ] **4.2** Add RTL styling and Arabic UI
- [ ] **4.3** Test with real data
- [ ] **4.4** Lint and build verification

---

## 🔐 Security Considerations

1. **API Key**: Stored in Supabase Secrets (NOT in frontend code)
2. **Edge Functions**: All AI calls go through server-side functions
3. **Admin Only**: Route protected with role check
4. **Rate Limiting**: Server-side control in Edge Functions
5. **Data Privacy**: AI only sees aggregated data, not PII
6. **Authentication**: Edge Functions verify Supabase JWT

---

## 🛡️ Chat Guardrails

> ⚠️ منع الأسئلة خارج نطاق البيانات وتقديم ردود افتراضية آمنة

### System Prompt Guardrails

```
أنت مساعد تحليل بيانات لمعمل أسنان فقط. 

قواعد صارمة:
1. أجب فقط على أسئلة متعلقة ببيانات المعمل (طلبات، مالية، أطباء، خدمات)
2. لا تجب على أسئلة شخصية أو عامة أو سياسية
3. لو السؤال خارج النطاق، قل: "عذراً، أنا متخصص في تحليل بيانات المعمل فقط"
4. لا تخترع بيانات - استخدم فقط البيانات المقدمة
5. لو البيانات غير كافية، قل: "لا تتوفر لدي بيانات كافية للإجابة"
```

### Allowed vs Blocked Topics

| ✅ مسموح | ❌ ممنوع |
|----------|----------|
| الطلبات والإيرادات | أسئلة شخصية |
| المصروفات والأرباح | أسئلة طبية |
| أداء الأطباء | أخبار وسياسة |
| تحليل الخدمات | معلومات خارجية |

---

## 🎨 UI Design

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Clear Section Separation** | Weekly Insights و Chat في sections منفصلة بـ borders |
| **Loading Skeletons** | Shimmer effect أثناء انتظار Gemini (latency عالي) |
| **Timestamps** | "آخر تحديث: منذ 3 أيام" لكل Insight |
| **Rating UI** | 👍/👎 buttons على كل Insight card |
| **RTL Layout** | كل النصوص والـ layout بالعربي |

### Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🧠 مركز التحليلات الذكية                             [Admin Only Badge] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║ 📊 التحليلات الأسبوعية              آخر تحديث: منذ 3 أيام [🔄]    ║  │
│  ╟───────────────────────────────────────────────────────────────────╢  │
│  ║ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐          ║  │
│  ║ │ 💡 Insight 1   │ │ 💡 Insight 2   │ │ 💡 Insight 3   │          ║  │
│  ║ │                │ │                │ │                │          ║  │
│  ║ │ [Content...]   │ │ [Content...]   │ │ [Content...]   │          ║  │
│  ║ │                │ │                │ │                │          ║  │
│  ║ │ [👍] [👎]      │ │ [👍] [👎]      │ │ [👍] [👎]      │          ║  │
│  ║ └────────────────┘ └────────────────┘ └────────────────┘          ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                          │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║ 💬 اسأل الذكاء الاصطناعي                                          ║  │
│  ╟───────────────────────────────────────────────────────────────────╢  │
│  ║ ┌─────────────────────────────────────────────────────────────┐   ║  │
│  ║ │ [Typing Indicator / Skeleton while loading]                 │   ║  │
│  ║ │                                                             │   ║  │
│  ║ │  🤖 مرحباً! كيف يمكنني مساعدتك في تحليل بيانات المعمل؟      │   ║  │
│  ║ │                                                             │   ║  │
│  ║ │                          👤 ما هي أعلى خدمة طلباً هذا الشهر؟│   ║  │
│  ║ │                                                             │   ║  │
│  ║ │  🤖 أعلى خدمة هي "زيركون كامل" بـ 45 طلب...                │   ║  │
│  ║ └─────────────────────────────────────────────────────────────┘   ║  │
│  ║ ┌─────────────────────────────────────────────────────┐ [إرسال]  ║  │
│  ║ │ اكتب سؤالك هنا...                                   │          ║  │
│  ║ └─────────────────────────────────────────────────────┘          ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                          │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║ 📜 المحادثات السابقة                                              ║  │
│  ║ • تحليل أداء يناير - 27 يناير                                     ║  │
│  ║ • مقارنة الخدمات - 25 يناير                                       ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Loading States

| State | UI |
|-------|-----|
| **Insights Loading** | 3 skeleton cards with shimmer animation |
| **Chat Waiting** | Typing indicator (3 dots animation) |
| **Error** | Red toast notification with retry button |

### InsightCard Component

```
┌────────────────────────────────────┐
│ 💡 [Title]                 [Icon]  │
│                                    │
│ [Insight content text here...]     │
│                                    │
│ ───────────────────────────────── │
│ منذ 3 أيام           [👍]  [👎]   │
└────────────────────────────────────┘
```

---

## 🧪 Verification Checklist

- [ ] API key works with Gemini
- [ ] Weekly insights generate correctly
- [ ] Chat responds accurately
- [ ] Conversations persist in database
- [ ] Page only accessible to admins
- [ ] Arabic RTL styling correct
- [ ] No lint errors
- [ ] Build passes

---

## 📝 Sample Prompts for Gemini

### Weekly Auto-Analysis Prompt

```
أنت محلل بيانات خبير لمعمل أسنان. بناءً على البيانات التالية:

- إجمالي الطلبات: {orderCount}
- الإيرادات: {revenue} ج.م
- المصروفات: {expenses} ج.م
- الربح: {profit} ج.م
- أعلى طبيب: {topDoctor}
- أعلى خدمة: {topService}

قدم 4-5 insights مختصرة ومفيدة عن:
1. أداء المعمل العام
2. نقاط القوة
3. نقاط للتحسين
4. توقعات قادمة

أجب بالعربية في شكل نقاط مختصرة.
```

### Chat Response Prompt

```
أنت مساعد ذكي لمعمل أسنان. لديك البيانات التالية:
{contextData}

سؤال المستخدم: {userQuestion}

أجب بدقة واختصار بالعربية.
```

---

## ⏱️ Estimated Time

| Phase | Time |
|-------|------|
| Foundation | 2-3 hours |
| UI Components | 2-3 hours |
| Integration | 2-3 hours |
| Polish | 1-2 hours |
| **Total** | **7-11 hours** |

---

## 🚀 Next Steps

After plan approval:
1. Run database migration
2. Create & deploy Edge Functions to Supabase
3. Add Gemini API Key to Supabase Secrets: `supabase secrets set GEMINI_API_KEY=your_key`
4. Implement in order: Edge Functions → Frontend Service → Components → Page → Routes
