// Gemini Analyze Edge Function
// Generates AI analysis insights with strict JSON output format
// API Key is stored in Supabase secrets
// Output format: { record_type, analysis_scope, analysis_id, generated_at, period, executive_summary, insights, confidence_level }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Generate UUID-like string
function generateUUID(): string {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    array[6] = (array[6] & 0x0f) | 0x40
    array[8] = (array[8] & 0x3f) | 0x80
    const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const ANALYSIS_PROMPT = `You are an AI analytics assistant embedded inside a Dental Lab ERP system.
You MUST respond entirely in Arabic (العربية). All titles, summaries, and content must be in Arabic.

CRITICAL RULES:
1. Every analysis you generate is a NEW, standalone, historical record.
2. Analyses must NEVER overwrite, update, merge with, or replace previous analyses.
3. Do NOT reference, summarize, or rely on any earlier analyses.
4. Assume each response will be permanently archived exactly as returned.
5. Do NOT include markdown, comments, explanations, or extra text outside the required JSON.
6. ALL TEXT MUST BE IN ARABIC (العربية) - titles, summaries, and content.

YOUR TASK:
- Generate a clear, complete analytical response based solely on the provided data.
- Treat this response as an independent archived insight.
- Focus on clarity, executive readability, and actionability.
- Do not guess missing numbers or fabricate data.

OUTPUT FORMAT (STRICT — MUST FOLLOW EXACTLY):

{
  "executive_summary": "جملة واحدة واضحة تشرح الوضع العام بالعربية",
  "insights": [
    {
      "title": "عنوان واضح ومحدد بالعربية",
      "content": "شرح واضح بالعربية، جملتين كحد أقصى. يجب أن يكون مرئياً بالكامل في الواجهة.",
      "category": "performance | finance | operations | risk | opportunity",
      "severity": "positive | neutral | negative"
    }
  ],
  "confidence_level": "high | medium | low"
}

FINAL CONSTRAINTS:
- Return VALID JSON only.
- Ensure the response is complete and not truncated.
- Keep all text concise and readable IN ARABIC.
- Never output partial structures.
- Generate 4-5 insights maximum.
- Each insight content must be maximum 2 sentences IN ARABIC.`

serve(async (req) => {
    // [DEBUG] Log immediately to confirm function is reached
    console.log('===== gemini-analyze function called =====')
    console.log('Request Method:', req.method)
    console.log('Headers:', Object.fromEntries(req.headers.entries()))

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY not configured')
            return new Response(
                JSON.stringify({ error: 'Gemini API not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Auth check with logging (matches gemini-chat pattern)
        const authHeader = req.headers.get('Authorization')
        console.log('Analyze Auth Header Present:', !!authHeader)

        let userId: string | null = null
        if (authHeader) {
            const token = authHeader.replace('Bearer ', '')
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
            console.log('Analyze User found:', !!user)
            if (authError) console.log('Analyze Auth Error:', authError.message)
            userId = user?.id || null
        } else {
            console.log('Analyze No Auth Header provided')
        }

        // Proceed with request...
        const { context, insightType = 'on_demand' } = await req.json()

        // Calculate period dates
        const today = new Date()
        const periodTo = today.toISOString().split('T')[0]
        const periodFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

        const dataSummary = `
DATA CONTEXT (Dental Lab - Period: ${periodFrom} to ${periodTo}):

📊 ALL-TIME TOTALS (منذ بداية النظام):
- إجمالي الأرباح التاريخية: ${(context.allTime?.profit || context.profit || 0).toLocaleString()} EGP
- إجمالي الديون المعلقة (لكامل الفترات): ${(context.allTime?.pendingPayments || context.pendingPayments || 0).toLocaleString()} EGP
- إجمالي الإيرادات التاريخية: ${(context.allTime?.revenue || context.revenue || 0).toLocaleString()} EGP

📅 CURRENT MONTH PERFORMANCE (أداء الشهر الحالي):
- إيرادات الشهر: ${(context.currentMonth?.revenue || context.revenue || 0).toLocaleString()} EGP
- أرباح الشهر: ${(context.currentMonth?.profit || context.profit || 0).toLocaleString()} EGP
- تكاليف التشغيل: ${(context.currentMonth?.operatingExpenses || context.operatingExpenses || 0).toLocaleString()} EGP
- تكاليف الإنتاج: ${(context.currentMonth?.productionCosts || context.productionCosts || 0).toLocaleString()} EGP
- الطلبات المكتملة: ${context.currentMonth?.completedOrders || context.completedOrders || 0}
- الطلبات المعلقة: ${context.currentMonth?.pendingOrders || context.pendingOrders || 0}

📆 PREVIOUS MONTH PERFORMANCE (أداء الشهر السابق للمقارنة):
- إيرادات الشهر السابق: ${(context.previousMonth?.revenue || 0).toLocaleString()} EGP
- أرباح الشهر السابق: ${(context.previousMonth?.profit || 0).toLocaleString()} EGP
- الطلبات المكتملة السابق: ${context.previousMonth?.completedOrders || 0}

👨‍⚕️ TOP DOCTORS (CURRENT MONTH):
${(context.topDoctors || []).map((d: { name: string; orderCount: number; revenue: number }, i: number) => `${i + 1}. ${d.name}: ${d.orderCount} orders (${d.revenue.toLocaleString()} EGP)`).join('\n')}

🦷 TOP SERVICES (CURRENT MONTH):
${(context.topServices || []).map((s: { name: string; count: number; revenue: number }, i: number) => `${i + 1}. ${s.name}: ${s.count} units (${s.revenue.toLocaleString()} EGP)`).join('\n')}

📈 ORDERS BY STATUS (CURRENT MONTH):
${(context.ordersByStatus || []).map((s: { status: string; count: number }) => `- ${s.status}: ${s.count}`).join('\n')}
`

        const prompt = `${ANALYSIS_PROMPT}\n\n${dataSummary}`
        const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: prompt }]
                }]
            })
        })

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text()
            throw new Error(`Gemini API Error: ${errorText}`)
        }

        const geminiData = await geminiResponse.json()
        const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''

        // Parse JSON response
        const parsedResponse: {
            executive_summary: string;
            insights: { id: string; title: string; content: string; category: string; severity: string }[];
            confidence_level: string;
        } = {
            executive_summary: '',
            insights: [],
            confidence_level: 'medium'
        }

        try {
            let cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim()

            // Extract JSON object
            const firstBrace = cleanText.indexOf('{')
            const lastBrace = cleanText.lastIndexOf('}')

            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanText = cleanText.substring(firstBrace, lastBrace + 1)
            }

            const parsed = JSON.parse(cleanText)
            parsedResponse.executive_summary = parsed.executive_summary || 'Analysis completed.'
            parsedResponse.confidence_level = parsed.confidence_level || 'medium'

            // Add unique ID to each insight
            parsedResponse.insights = (parsed.insights || []).map((insight: Record<string, unknown>) => ({
                id: generateUUID(),
                title: String(insight.title || 'Insight'),
                content: String(insight.content || ''),
                category: String(insight.category || 'performance'),
                severity: String(insight.severity || 'neutral')
            }))
        } catch (parseError) {
            console.error('Failed to parse Gemini response:', parseError)

            // Fallback strategy: Try regex if strict parse failed
            try {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/)
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0])
                    parsedResponse.executive_summary = parsed.executive_summary || 'Analysis completed.'
                    parsedResponse.confidence_level = parsed.confidence_level || 'medium'
                    parsedResponse.insights = (parsed.insights || []).map((insight: Record<string, unknown>) => ({
                        id: generateUUID(),
                        title: String(insight.title || 'Insight'),
                        content: String(insight.content || ''),
                        category: String(insight.category || 'performance'),
                        severity: String(insight.severity || 'neutral')
                    }))
                }
            } catch {
                // Final Fallback: Return raw text as single insight
                parsedResponse.executive_summary = 'Unable to parse structured response.'
                parsedResponse.confidence_level = 'low'
                parsedResponse.insights = [{
                    id: generateUUID(),
                    title: 'Raw Analysis',
                    content: responseText.replace(/```json/g, '').replace(/```/g, '').substring(0, 200),
                    category: 'operations',
                    severity: 'neutral'
                }]
            }
        }

        // Build the full response object with new schema
        const analysisId = generateUUID()
        const generatedAt = new Date().toISOString()
        const modelVersion = 'gemini-1.5-flash'
        const promptVersion = 'v2.0-strict-json'

        const fullResponse = {
            record_type: 'ai_analysis',
            analysis_scope: insightType === 'weekly_auto' ? 'weekly_auto' : 'on_demand_chat',
            analysis_id: analysisId,
            generated_at: generatedAt,
            period: {
                from: periodFrom,
                to: periodTo
            },
            executive_summary: parsedResponse.executive_summary,
            insights: parsedResponse.insights,
            confidence_level: parsedResponse.confidence_level,
            // Keep these for backwards compatibility
            model_version: modelVersion,
            prompt_version: promptVersion
        }

        // Save to Database
        console.log('Attempting to save to ai_insights table...')
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

        if (saveError) {
            console.error('Database Save Error:', saveError)
        } else {
            console.log('Successfully saved with ID:', savedData?.id)
        }

        // Include database ID and debug info in response
        fullResponse.analysis_id = savedData?.id || analysisId
        // @ts-expect-error - debug field
        fullResponse._debug = {
            saved: !saveError,
            savedId: savedData?.id,
            saveError: saveError?.message || null
        }

        return new Response(
            JSON.stringify(fullResponse),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error: unknown) {
        console.error('Edge function error:', error)
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(
            JSON.stringify({
                error: `Internal Error: ${errorMessage}`,
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
