// @ts-ignore: Deno URL imports
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore: Deno URL imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore: Deno npm specifier
import webpush from 'npm:web-push@3.6.7'

type PushCategory = 'case_update' | 'promotional'
type DoctorStage = 'received' | 'design' | 'production' | 'ready' | 'delivered'
type PushLanguage = 'en' | 'ar'
type AudienceKind = 'single' | 'selection' | 'group' | 'all'

interface CaseUpdatePayload {
  category?: 'case_update'
  user_ids: string[]
  event_type: 'case_stage' | 'support_reply'
  stage?: DoctorStage | null
  case_id?: string | null
  order_id?: string | null
  message_id?: string | null
}

interface PromotionalPayload {
  category: 'promotional'
  title_en: string
  title_ar: string
  body_en: string
  body_ar: string
  audience_kind: AudienceKind
  audience_summary?: string
  doctor_ids?: string[]
}

type PushRequestPayload = CaseUpdatePayload | PromotionalPayload

interface SubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  preferred_language: PushLanguage | null
  promotional_enabled: boolean
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-webhook-secret',
}

const STAGE_COPY: Record<DoctorStage, { en: { title: string; body: (c: string) => string }; ar: { title: string; body: (c: string) => string } }> = {
  received: {
    en: {
      title: 'Case received',
      body: (c) => c ? `Case ${c} has been received by Orca Lab.` : 'Your case has been received by Orca Lab.',
    },
    ar: {
      title: 'استلام الحالة',
      body: (c) => c ? `تم استلام الحالة ${c} في معمل أوركا.` : 'تم استلام حالتك في معمل أوركا.',
    },
  },
  design: {
    en: {
      title: 'Digital design',
      body: (c) => c ? `Case ${c} is now in digital design.` : 'Your case is now in digital design.',
    },
    ar: {
      title: 'التصميم الرقمي',
      body: (c) => c ? `الحالة ${c} الآن في مرحلة التصميم الرقمي.` : 'حالتك الآن في مرحلة التصميم الرقمي.',
    },
  },
  production: {
    en: {
      title: 'In production',
      body: (c) => c ? `Case ${c} is now in manufacturing and finishing.` : 'Your case is now in manufacturing and finishing.',
    },
    ar: {
      title: 'قيد التصنيع',
      body: (c) => c ? `الحالة ${c} الآن في مرحلة التصنيع والمعالجة.` : 'حالتك الآن في مرحلة التصنيع والمعالجة.',
    },
  },
  ready: {
    en: {
      title: 'Ready for delivery',
      body: (c) => c ? `Case ${c} is ready for delivery.` : 'Your case is ready for delivery.',
    },
    ar: {
      title: 'جاهزة للتسليم',
      body: (c) => c ? `الحالة ${c} جاهزة للتسليم.` : 'حالتك جاهزة للتسليم.',
    },
  },
  delivered: {
    en: {
      title: 'Case delivered',
      body: (c) => c ? `Case ${c} has been delivered.` : 'Your case has been delivered.',
    },
    ar: {
      title: 'تم تسليم الحالة',
      body: (c) => c ? `تم تسليم الحالة ${c}.` : 'تم تسليم حالتك.',
    },
  },
}

function buildCaseNotification(event: CaseUpdatePayload, lang: PushLanguage | null) {
  const caseRef = (event.case_id || '').trim()

  let enTitle: string
  let enBody: string
  let arTitle: string
  let arBody: string
  let url: string
  let tag: string

  if (event.event_type === 'support_reply') {
    enTitle = 'New lab reply'
    enBody = caseRef ? `Orca Lab replied to your message for case ${caseRef}.` : 'Orca Lab replied to your support message.'
    arTitle = 'رد جديد من المعمل'
    arBody = caseRef ? `رد معمل أوركا على رسالتك للحالة ${caseRef}.` : 'رد معمل أوركا على رسالتك.'
    url = '/doctor/support'
    tag = `orca-support-${event.message_id || 'reply'}`
  } else {
    const stage: DoctorStage = event.stage && event.stage in STAGE_COPY ? event.stage : 'received'
    const copy = STAGE_COPY[stage]
    enTitle = copy.en.title
    enBody = copy.en.body(caseRef)
    arTitle = copy.ar.title
    arBody = copy.ar.body(caseRef)
    url = '/doctor/my-orders'
    tag = `orca-case-${event.order_id || caseRef || stage}-${stage}`
  }

  if (lang === 'en') {
    return { title: enTitle, body: enBody, url, tag, category: 'case_update' as PushCategory }
  }
  if (lang === 'ar') {
    return { title: arTitle, body: arBody, url, tag, category: 'case_update' as PushCategory }
  }
  return {
    title: `${enTitle} | ${arTitle}`,
    body: `${enBody}\n${arBody}`,
    url,
    tag,
    category: 'case_update' as PushCategory,
  }
}

function buildPromotionalNotification(event: PromotionalPayload, lang: PushLanguage | null) {
  const titleEn = event.title_en.trim()
  const titleAr = event.title_ar.trim()
  const bodyEn = event.body_en.trim()
  const bodyAr = event.body_ar.trim()
  const url = '/doctor/my-orders'
  const tag = 'orca-promo'

  if (lang === 'en') {
    return { title: titleEn, body: bodyEn, url, tag, category: 'promotional' as PushCategory }
  }
  if (lang === 'ar') {
    return { title: titleAr, body: bodyAr, url, tag, category: 'promotional' as PushCategory }
  }
  return {
    title: `${titleEn} | ${titleAr}`,
    body: `${bodyEn}\n${bodyAr}`,
    url,
    tag,
    category: 'promotional' as PushCategory,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// @ts-ignore: Deno serve
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // @ts-ignore: Deno env
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  // @ts-ignore: Deno env
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  // @ts-ignore: Deno env
  const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') || ''
  // @ts-ignore: Deno env
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') || ''
  // @ts-ignore: Deno env
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || ''
  // @ts-ignore: Deno env
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@orcadentallab.com'

  let payload: PushRequestPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400)
  }

  const category: PushCategory = payload.category === 'promotional' ? 'promotional' : 'case_update'

  const providedSecret = req.headers.get('x-push-webhook-secret') || ''
  const authHeader = req.headers.get('authorization') || ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  const authorizedBySecret = Boolean(webhookSecret) && providedSecret === webhookSecret
  const authorizedByServiceRole = Boolean(serviceRoleKey) && bearerToken === serviceRoleKey

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  let adminUserId: string | null = null

  if (category === 'case_update') {
    if (!authorizedBySecret && !authorizedByServiceRole) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }
  } else {
    if (authorizedByServiceRole) {
      adminUserId = null
    } else if (bearerToken) {
      const { data: userData, error: userErr } = await adminClient.auth.getUser(bearerToken)
      if (userErr || !userData?.user) {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }
      const { data: profile, error: profErr } = await adminClient
        .from('users')
        .select('role, is_active')
        .eq('auth_id', userData.user.id)
        .single()
      if (profErr || !profile || profile.role !== 'admin' || profile.is_active === false) {
        return jsonResponse({ error: 'Forbidden' }, 403)
      }
      adminUserId = userData.user.id
    } else {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    return jsonResponse({ error: 'VAPID keys are not configured' }, 500)
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  if (category === 'case_update') {
    const casePayload = payload as CaseUpdatePayload
    if (!Array.isArray(casePayload.user_ids) || casePayload.user_ids.length === 0) {
      return jsonResponse({ sent: 0, deleted: 0 })
    }

    // case_update NEVER filters by promotional_enabled.
    const { data: subscriptions, error } = await adminClient
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth, preferred_language, promotional_enabled')
      .in('user_id', casePayload.user_ids)

    if (error) {
      return jsonResponse({ error: error.message }, 500)
    }

    const rows = (subscriptions || []) as SubscriptionRow[]
    let sent = 0
    const staleIds: string[] = []
    const deliveries: Array<{ endpoint: string; language: string; notification: ReturnType<typeof buildCaseNotification> }> = []

    await Promise.all(
      rows.map(async (sub) => {
        const notification = buildCaseNotification(casePayload, sub.preferred_language)
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(notification),
          )
          sent += 1
          deliveries.push({
            endpoint: sub.endpoint,
            language: sub.preferred_language || 'bilingual',
            notification,
          })
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode
          if (statusCode === 404 || statusCode === 410) {
            staleIds.push(sub.id)
          } else {
            console.error('Push delivery failed for subscription', sub.id, statusCode)
          }
        }
      }),
    )

    if (staleIds.length > 0) {
      await adminClient.from('push_subscriptions').delete().in('id', staleIds)
    }

    return jsonResponse({ sent, deleted: staleIds.length, deliveries })
  }

  // Promotional send path
  const promo = payload as PromotionalPayload
  if (!promo.title_en?.trim() || !promo.title_ar?.trim() || !promo.body_en?.trim() || !promo.body_ar?.trim()) {
    return jsonResponse({ error: 'All EN and AR title/body fields are required' }, 400)
  }

  let userQuery = adminClient
    .from('users')
    .select('auth_id, entity_id')
    .eq('role', 'doctor')
    .eq('is_active', true)
    .not('auth_id', 'is', null)

  if (promo.audience_kind !== 'all') {
    const doctorIds = Array.isArray(promo.doctor_ids) ? promo.doctor_ids : []
    if (doctorIds.length === 0) {
      return jsonResponse({ error: 'No doctors selected' }, 400)
    }
    userQuery = userQuery.in('entity_id', doctorIds)
  }

  const { data: doctorUsers, error: usersError } = await userQuery
  if (usersError) {
    return jsonResponse({ error: usersError.message }, 500)
  }

  const targetUserIds = Array.from(
    new Set((doctorUsers || []).map((u: { auth_id: string | null }) => u.auth_id).filter(Boolean) as string[]),
  )

  let rows: SubscriptionRow[] = []
  if (targetUserIds.length > 0) {
    const { data: subs, error: subsError } = await adminClient
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth, preferred_language, promotional_enabled')
      .in('user_id', targetUserIds)
      .eq('promotional_enabled', true)

    if (subsError) {
      return jsonResponse({ error: subsError.message }, 500)
    }
    rows = (subs || []) as SubscriptionRow[]
  }

  let deliveredCount = 0
  let failedCount = 0
  const staleIds: string[] = []
  const deliveries: Array<{ endpoint: string; language: string; notification: ReturnType<typeof buildPromotionalNotification> }> = []

  await Promise.all(
    rows.map(async (sub) => {
      const notification = buildPromotionalNotification(promo, sub.preferred_language)
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(notification),
        )
        deliveredCount += 1
        deliveries.push({
          endpoint: sub.endpoint,
          language: sub.preferred_language || 'bilingual',
          notification,
        })
      } catch (err: unknown) {
        failedCount += 1
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(sub.id)
        } else {
          console.error('Promotional push failed for subscription', sub.id, statusCode)
        }
      }
    }),
  )

  if (staleIds.length > 0) {
    await adminClient.from('push_subscriptions').delete().in('id', staleIds)
  }

  const sentBy = adminUserId || targetUserIds[0]
  if (sentBy) {
    await adminClient.from('announcement_sends').insert({
      sent_by: sentBy,
      title_en: promo.title_en.trim(),
      title_ar: promo.title_ar.trim(),
      body_en: promo.body_en.trim(),
      body_ar: promo.body_ar.trim(),
      audience_kind: promo.audience_kind,
      audience_summary: promo.audience_summary || promo.audience_kind,
      recipient_count: rows.length,
      delivered_count: deliveredCount,
      failed_count: failedCount,
    })
  }

  return jsonResponse({
    recipient_count: rows.length,
    delivered_count: deliveredCount,
    failed_count: failedCount,
    deleted: staleIds.length,
    deliveries,
  })
})
