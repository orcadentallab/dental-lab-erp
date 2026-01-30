// Gemini Chat Edge Function
// Handles chat requests from the frontend and proxies to Gemini API
// API Key is stored in Supabase secrets (never exposed to frontend)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

// System prompt with guardrails
const SYSTEM_PROMPT = `أنت مساعد تحليل بيانات لمعمل أسنان فقط.

قواعد صارمة:
1. أجب فقط على أسئلة متعلقة ببيانات المعمل (طلبات، مالية، أطباء، خدمات)
2. لا تجب على أسئلة شخصية أو عامة أو سياسية
3. لو السؤال خارج النطاق، قل: "عذراً، أنا متخصص في تحليل بيانات المعمل فقط. هل لديك سؤال عن الطلبات أو المالية؟"
4. لا تخترع بيانات - استخدم فقط البيانات المقدمة
5. لو البيانات غير كافية، قل: "لا تتوفر لدي بيانات كافية للإجابة على هذا السؤال"
6. أجب بالعربية دائماً
7. كن مختصراً ومفيداً`

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ChatRequest {
    message: string
    context: {
        orderCount: number
        revenue: number
        expenses: number
        profit: number
        topDoctors: { name: string; orderCount: number }[]
        topServices: { name: string; count: number }[]
        recentOrders: { patientName: string; status: string; total: number }[]
    }
    conversationHistory?: { role: string; content: string }[]
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Check API key is configured
        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY not configured')
            return new Response(
                JSON.stringify({ error: 'Gemini API not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Create Supabase client (Environment variables only)
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Debug: Log auth header presence
        const authHeader = req.headers.get('Authorization')
        console.log('Chat Auth Header Present:', !!authHeader)

        // BYPASS AUTH CHECK FOR DEBUGGING
        if (authHeader) {
            const token = authHeader.replace('Bearer ', '')
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
            console.log('Chat User found:', !!user)
            if (authError) console.log('Chat Auth Error:', authError.message)
        } else {
            console.log('Chat No Auth Header provided')
        }

        // Proceed...

        // Parse request body
        const { message, context, conversationHistory = [] }: ChatRequest = await req.json()

        // Build context string for Gemini
        const contextString = `
بيانات المعمل الحالية:
- إجمالي الطلبات: ${context.orderCount}
- إجمالي الإيرادات: ${context.revenue.toLocaleString()} ج.م
- إجمالي المصروفات: ${context.expenses.toLocaleString()} ج.م
- صافي الربح: ${context.profit.toLocaleString()} ج.م
- أعلى الأطباء: ${context.topDoctors.map(d => `${d.name} (${d.orderCount} طلب)`).join('، ')}
- أعلى الخدمات: ${context.topServices.map(s => `${s.name} (${s.count})`).join('، ')}
`

        // Build conversation for Gemini
        const contents = [
            {
                role: 'user',
                parts: [{ text: SYSTEM_PROMPT + '\n\n' + contextString }]
            },
            {
                role: 'model',
                parts: [{ text: 'مرحباً! أنا مساعد تحليل بيانات المعمل. كيف يمكنني مساعدتك؟' }]
            },
            ...conversationHistory.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            })),
            {
                role: 'user',
                parts: [{ text: message }]
            }
        ]

        // Call Gemini API
        const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents,
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024,
                },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                ]
            })
        })

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text()
            console.error('Gemini API error:', errorText)
            return new Response(
                JSON.stringify({ error: 'حدث خطأ في التحليل، يرجى المحاولة لاحقاً' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const geminiData = await geminiResponse.json()
        const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'عذراً، لم أتمكن من الإجابة'

        return new Response(
            JSON.stringify({
                response: responseText,
                model_version: 'gemini-1.5-flash',
                prompt_version: 'v1.0'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Edge function error:', error)
        return new Response(
            JSON.stringify({ error: 'حدث خطأ غير متوقع' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
