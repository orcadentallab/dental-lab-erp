// AI Chat Edge Function — Groq
// Model: llama-3.3-70b-versatile (Free tier: 1000 req/day, 30 RPM)

// @ts-ignore: Deno URL imports
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore: Deno URL imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-ignore: Deno global
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

const SYSTEM_PROMPT = `أنت مساعد تحليل بيانات لمعمل أسنان فقط.

قواعد صارمة:
1. أجب فقط على أسئلة متعلقة ببيانات المعمل (طلبات، مالية، أطباء، خدمات)
2. لا تجب على أسئلة شخصية أو عامة أو سياسية
3. لو السؤال خارج النطاق، قل: "عذراً، أنا متخصص في تحليل بيانات المعمل فقط."
4. لا تخترع بيانات — استخدم فقط البيانات المقدمة لك
5. لو البيانات غير كافية، قل: "لا تتوفر لدي بيانات كافية للإجابة."
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
        productionCosts: number
        operatingExpenses: number
        expenses: number
        profit: number
        topDoctors: { name: string; orderCount: number }[]
        topServices: { name: string; count: number }[]
        recentOrders: { patientName: string; status: string; total: number }[]
    }
    conversationHistory?: { role: string; content: string }[]
}

// @ts-ignore: Deno serve
serve(async (req: any) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        if (!GROQ_API_KEY) {
            console.error('GROQ_API_KEY not configured')
            return new Response(
                JSON.stringify({ error: 'Groq API key not configured. Please set GROQ_API_KEY secret.' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseClient = createClient(
            // @ts-ignore: Deno global
            Deno.env.get('SUPABASE_URL') ?? '',
            // @ts-ignore: Deno global
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const authHeader = req.headers.get('Authorization')
        if (authHeader) {
            const token = authHeader.replace('Bearer ', '')
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
            console.log('Chat User found:', !!user)
            if (authError) console.log('Auth Error:', authError.message)
        }

        const { message, context, conversationHistory = [] }: ChatRequest = await req.json()

        const contextString = `
بيانات المعمل الحالية:
- إجمالي الطلبات: ${context.orderCount || 0}
- إجمالي الإيرادات: ${(context.revenue || 0).toLocaleString()} ج.م
- تكاليف الإنتاج: ${(context.productionCosts || 0).toLocaleString()} ج.م
- مصاريف التشغيل: ${(context.operatingExpenses || 0).toLocaleString()} ج.م
- إجمالي المصروفات: ${((context.productionCosts || 0) + (context.operatingExpenses || 0) || context.expenses || 0).toLocaleString()} ج.م
- صافي الربح: ${(context.profit || 0).toLocaleString()} ج.م
- أعلى الأطباء: ${context.topDoctors?.map(d => `${d.name} (${d.orderCount} طلب)`).join('، ') || 'غير متاح'}
- أعلى الخدمات: ${context.topServices?.map(s => `${s.name} (${s.count})`).join('، ') || 'غير متاح'}
`

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT + '\n\n' + contextString },
            { role: 'assistant', content: 'مرحباً! أنا مساعد تحليل بيانات المعمل. كيف يمكنني مساعدتك؟' },
            ...conversationHistory.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            })),
            { role: 'user', content: message }
        ]

        const groqResponse = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages,
                temperature: 0.7,
                max_tokens: 1024,
            })
        })

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text()
            console.error('Groq API error:', errorText)
            return new Response(
                JSON.stringify({ error: 'حدث خطأ في التحليل، يرجى المحاولة لاحقاً' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const groqData = await groqResponse.json()
        const responseText = groqData.choices?.[0]?.message?.content || 'عذراً، لم أتمكن من الإجابة'

        return new Response(
            JSON.stringify({
                response: responseText,
                model_version: MODEL,
                prompt_version: 'v3.0-groq'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Edge function error:', error)
        return new Response(
            JSON.stringify({ error: 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
