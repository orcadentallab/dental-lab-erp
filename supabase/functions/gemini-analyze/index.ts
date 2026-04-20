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
1. Monthly Comparison: Compare current month revenue/profit with previous month.
2. Doctor Performance: Check "Top Doctors" of current month vs previous month. If a major doctor from last month is missing or has significantly lower orders, FLAG it as a risk (Account Management).
3. Operations: Report on "Monthly Delivery Rate" (efficiency).
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

        // Auth
        const authHeader = req.headers.get('Authorization')
        let userId: string | null = null
        if (authHeader) {
            const token = authHeader.replace('Bearer ', '')
            const { data: { user } } = await supabaseClient.auth.getUser(token)
            userId = user?.id || null
        }

        const { context, insightType = 'on_demand' } = await req.json()

        const today = new Date()
        const periodTo = today.toISOString().split('T')[0]
        const periodFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

        const userMessage = `
تحليل معمل الأسنان للفترة الحالية والمقارنة السابقة:

📊 الإجماليات (كل الوقت):
- إجمالي الإيرادات: ${(context.allTime?.revenue || 0).toLocaleString()} ج.م
- إجمالي الأرباح: ${(context.allTime?.profit || 0).toLocaleString()} ج.م
- الديون المعلقة (حقيقية): ${(context.allTime?.pendingPayments || 0).toLocaleString()} ج.م (هذا هو المبلغ الذي لم يتم تحصيله بعد).

📅 الشهر الحالي (نشاط الشهر):
- إيرادات الشهر: ${(context.currentMonth?.revenue || 0).toLocaleString()} ج.م
- أرباح الشهر: ${(context.currentMonth?.profit || 0).toLocaleString()} ج.م
- الطلبات الجديدة: ${context.currentMonth?.newOrders || 0} طلب.
- الطلبات المكتملة: ${context.currentMonth?.completedOrders || 0} طلب.
- نسبة الإنجاز والتسليم (لهذا الشهر): ${(context.currentMonth?.deliveryRate || 0).toFixed(1)}%
- طلبات متأخرة (> 7 أيام بدون تسليم): ${context.delayedOrdersCount || 0} طلب.

📆 الشهر السابق (للمقارنة):
- إيرادات: ${(context.previousMonth?.revenue || 0).toLocaleString()} ج.م
- طلبات مكتملة: ${context.previousMonth?.completedOrders || 0} طلب.

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
        console.log('Groq raw response:', responseText.substring(0, 200))

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
