// AI Analyze Edge Function — Groq
// Model: llama-3.3-70b-versatile (Free tier: 1000 req/day, 30 RPM)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function generateUUID(): string {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    array[6] = (array[6] & 0x0f) | 0x40
    array[8] = (array[8] & 0x3f) | 0x80
    const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const SYSTEM_PROMPT = `You are an AI analytics assistant for a Dental Lab.
You MUST respond entirely in Arabic (العربية).

MAIN TASKS:
1. Period Comparison: Compare the current period revenue/profit with the previous comparison period. Be smart: if it's Month-to-Date (MTD), explain that this is a fair comparison up to the current day of the month, avoiding false claims of "performance decline" when it is just a partial month comparison.
2. Doctor Performance: Check "Top Doctors" of the current period vs the previous period. If a major doctor from the previous period is missing or has significantly lower orders, FLAG it as a risk (Account Management).
3. Operations: Report on the current period's delivery rate (efficiency).
4. Delays: Mention the count of "Delayed Orders" (> 7 days) as a critical operations insight.
5. Debt: Use "All-time Pending Payments" for the actual financial debt context.

CRITICAL RULES:
- Do NOT fabricate data.
- Max 5 insights.
- Return ONLY valid JSON.
- ALL TEXT IN ARABIC.

REQUIRED OUTPUT FORMAT:
{
  "executive_summary": "ملخص تنفيذي للموقف الحالي بالعربية",
  "insights": [
    {
      "title": "عنوان بالعربية",
      "content": "تحليل دقيق بناءً على الأرقام. جملتين كحد أقصى.",
      "category": "performance | finance | operations | risk | opportunity",
      "severity": "positive | neutral | negative"
    }
  ],
  "confidence_level": "high | medium | low"
}`

serve(async (req) => {
    console.log('===== ai-analyze (Groq) called =====')

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        if (!GROQ_API_KEY) {
            console.error('GROQ_API_KEY not configured')
            return new Response(
                JSON.stringify({ error: 'Groq API key not configured. Please set GROQ_API_KEY secret.' }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const authHeader = req.headers.get('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
            return new Response(
                JSON.stringify({ error: 'Authentication required' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const token = authHeader.slice('Bearer '.length)
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid authentication token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { data: profile, error: profileError } = await supabaseClient
            .from('users')
            .select('role')
            .eq('auth_id', user.id)
            .single()

        if (profileError || profile?.role !== 'admin') {
            return new Response(
                JSON.stringify({ error: 'Admin access required' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const userId = user.id
        const { context, insightType = 'on_demand' } = await req.json()

        const today = new Date()
        const periodTo = today.toISOString().split('T')[0]
        const periodFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

        // Dynamic labels based on selected period
        const periodType = context.comparisonPeriod || 'full_month';
        const currentPeriodLabel = context.currentPeriodLabel || 'الشهر الحالي';
        const previousPeriodLabel = context.previousPeriodLabel || 'الشهر السابق';

        let periodExplanation = '';
        if (periodType === 'month_to_date') {
            periodExplanation = `\n⚠️ تنبيه هام للذكاء الاصطناعي: هذه مقارنة متكافئة لبيانات الشهر الحالي حتى اليوم (Month-to-Date) مقارنة بنفس الفترة من الشهر السابق (نفس عدد الأيام). لا تذكر أن هناك انخفاضاً حاداً في الأداء لمجرد أن الشهر لم ينته بعد، بل قارن الأرقام بإنصاف بناءً على الأيام المنقضية فقط.`;
        } else if (periodType === 'last_7_days') {
            periodExplanation = `\n⚠️ تنبيه هام للذكاء الاصطناعي: التحليل يخص آخر 7 أيام مقارنة بالـ 7 أيام التي سبقتها.`;
        } else if (periodType === 'last_30_days') {
            periodExplanation = `\n⚠️ تنبيه هام للذكاء الاصطناعي: التحليل يخص آخر 30 يوماً مقارنة بالـ 30 يوماً التي سبقتها.`;
        }

        const userMessage = `
تحليل معمل الأسنان للفترة الحالية والمقارنة السابقة:
نوع فترة المقارنة: ${periodType} (${currentPeriodLabel} مقارنة بـ ${previousPeriodLabel})${periodExplanation}

📊 الإجماليات (كل الوقت):
- إجمالي الإيرادات: ${(context.allTime?.revenue || 0).toLocaleString()} ج.م
- إجمالي الأرباح: ${(context.allTime?.profit || 0).toLocaleString()} ج.م
- الديون المعلقة (حقيقية): ${(context.allTime?.pendingPayments || 0).toLocaleString()} ج.م (هذا هو المبلغ الذي لم يتم تحصيله بعد).

📅 ${currentPeriodLabel} (النشاط الحالي):
- إيرادات الفترة الحالية: ${(context.currentMonth?.revenue || 0).toLocaleString()} ج.م
- أرباح الفترة الحالية: ${(context.currentMonth?.profit || 0).toLocaleString()} ج.م
- الطلبات الجديدة: ${context.currentMonth?.newOrders || 0} طلب.
- الطلبات المكتملة: ${context.currentMonth?.completedOrders || 0} طلب.
- نسبة الإنجاز والتسليم (لهذه الفترة): ${(context.currentMonth?.deliveryRate || 0).toFixed(1)}%
- طلبات متأخرة (> 7 أيام بدون تسليم): ${context.delayedOrdersCount || 0} طلب.

📆 ${previousPeriodLabel} (للمقارنة):
- إيرادات فترة المقارنة: ${(context.previousMonth?.revenue || 0).toLocaleString()} ج.م
- طلبات مكتملة في فترة المقارنة: ${context.previousMonth?.completedOrders || 0} طلب.

👨‍⚕️ الأطباء الأكثر نشاطاً (الشهر الحالي):
${(context.topDoctors || []).map((d: any, i: number) =>
    `${i + 1}. ${d.name}: ${d.count || d.orderCount} طلب — ${(Number(d.revenue) || 0).toLocaleString()} ج.م`
).join('\n')}

👨‍⚕️ الأطباء الأكثر نشاطاً (الشهر السابق):
${(context.previousMonth?.topDoctors || []).map((d: any, i: number) =>
    `${i + 1}. ${d.name}: ${d.count || d.orderCount} طلب — ${(Number(d.revenue) || 0).toLocaleString()} ج.م`
).join('\n')}

🦷 أعلى الخدمات (الشهر الحالي):
${(context.topServices || []).map((s: any, i: number) =>
    `${i + 1}. ${s.name}: ${s.count} وحدة — ${(Number(s.revenue) || 0).toLocaleString()} ج.م`
).join('\n')}

المطلوب:
1. قارن أداء الشهر الحالي بالسابق.
2. ابحث عن الأطباء الذين قل نشاطهم بشكل ملحوظ مقارنة بالشهر السابق.
3. حلل نسبة الإنجاز والطلبات المتأخرة.
4. صغ النتائج في JSON فقط باللغة العربية.`

        // Call Groq API
        const groqResponse = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.3,
                max_tokens: 2048,
                response_format: { type: 'json_object' }, // Force JSON output
            })
        })

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text()
            throw new Error(`Groq API Error: ${errorText}`)
        }

        const groqData = await groqResponse.json()
        const responseText = groqData.choices?.[0]?.message?.content || ''
        // Parse response
        const parsedResponse: {
            executive_summary: string
            insights: { id: string; title: string; content: string; category: string; severity: string }[]
            confidence_level: string
        } = { executive_summary: '', insights: [], confidence_level: 'medium' }

        try {
            let cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim()
            const firstBrace = cleanText.indexOf('{')
            const lastBrace = cleanText.lastIndexOf('}')
            if (firstBrace !== -1 && lastBrace !== -1) cleanText = cleanText.substring(firstBrace, lastBrace + 1)

            const parsed = JSON.parse(cleanText)
            parsedResponse.executive_summary = parsed.executive_summary || 'تم إكمال التحليل.'
            parsedResponse.confidence_level = parsed.confidence_level || 'medium'
            parsedResponse.insights = (parsed.insights || []).map((ins: Record<string, unknown>) => ({
                id: generateUUID(),
                title: String(ins.title || 'ملاحظة'),
                content: String(ins.content || ''),
                category: String(ins.category || 'performance'),
                severity: String(ins.severity || 'neutral')
            }))
        } catch (parseErr) {
            console.error('JSON parse failed:', parseErr)
            parsedResponse.executive_summary = 'تعذّر تحليل البيانات بشكل منظم.'
            parsedResponse.confidence_level = 'low'
            parsedResponse.insights = [{
                id: generateUUID(),
                title: 'ملاحظة',
                content: responseText.substring(0, 300),
                category: 'operations',
                severity: 'neutral'
            }]
        }

        // Build and save response
        const analysisId = generateUUID()
        const generatedAt = new Date().toISOString()
        const modelVersion = MODEL
        const promptVersion = 'v4.0-groq'

        const fullResponse = {
            record_type: 'ai_analysis',
            analysis_scope: insightType === 'weekly_auto' ? 'weekly_auto' : 'on_demand_chat',
            analysis_id: analysisId,
            generated_at: generatedAt,
            period: { from: periodFrom, to: periodTo },
            executive_summary: parsedResponse.executive_summary,
            insights: parsedResponse.insights,
            confidence_level: parsedResponse.confidence_level,
            model_version: modelVersion,
            prompt_version: promptVersion
        }

        const { data: savedData, error: saveError } = await supabaseClient
            .from('ai_insights')
            .insert({
                insight_type: insightType,
                content: JSON.stringify(fullResponse),
                data_context: context,
                model_version: modelVersion,
                prompt_version: promptVersion,
                created_by: userId
            })
            .select('id')
            .single()

        if (saveError) console.error('DB Save Error:', saveError)
        else console.log('Saved insight ID:', savedData?.id)

        fullResponse.analysis_id = savedData?.id || analysisId

        return new Response(
            JSON.stringify(fullResponse),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error: unknown) {
        console.error('Edge function error:', error)
        const msg = error instanceof Error ? error.message : String(error)
        return new Response(
            JSON.stringify({ error: `AI Analysis Error: ${msg}` }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
