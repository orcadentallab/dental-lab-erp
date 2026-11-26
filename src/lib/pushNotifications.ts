import { supabase } from './supabase';

export type PushSubscribeStatus = 'subscribed' | 'denied' | 'unsupported' | 'unconfigured';

export function isPushSupported(): boolean {
    return (
        typeof window !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window
    );
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const buffer = new ArrayBuffer(rawData.length);
    const outputArray = new Uint8Array(buffer);
    for (let i = 0; i < rawData.length; i += 1) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function getPortalLanguage(): 'en' | 'ar' {
    try {
        return localStorage.getItem('orca-doctor-language') === 'ar' ? 'ar' : 'en';
    } catch {
        return 'en';
    }
}

export async function subscribeToPush(
    userId: string,
    preferredLanguage: 'en' | 'ar' = getPortalLanguage(),
): Promise<PushSubscribeStatus> {
    if (!isPushSupported()) return 'unsupported';

    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) return 'unconfigured';

    if (Notification.permission === 'denied') return 'denied';

    const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

    if (permission !== 'granted') return 'denied';

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
    }

    const json = subscription.toJSON();
    const endpoint = json.endpoint;
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!endpoint || !p256dh || !auth) return 'unsupported';

    await supabase.from('push_subscriptions').upsert(
        {
            user_id: userId,
            endpoint,
            p256dh,
            auth,
            user_agent: navigator.userAgent,
            preferred_language: preferredLanguage,
            last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
    );

    return 'subscribed';
}

export async function refreshPushSubscription(
    userId: string,
    preferredLanguage: 'en' | 'ar' = getPortalLanguage(),
): Promise<void> {
    if (!isPushSupported() || Notification.permission !== 'granted') return;
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return;

        const json = subscription.toJSON();
        const endpoint = json.endpoint;
        const p256dh = json.keys?.p256dh;
        const auth = json.keys?.auth;
        if (!endpoint || !p256dh || !auth) return;

        await supabase.from('push_subscriptions').upsert(
            {
                user_id: userId,
                endpoint,
                p256dh,
                auth,
                user_agent: navigator.userAgent,
                preferred_language: preferredLanguage,
                last_seen_at: new Date().toISOString(),
            },
            { onConflict: 'endpoint' },
        );
    } catch {
        // Silent failure: never interrupt login/session flow.
    }
}

export async function unsubscribeFromPush(): Promise<void> {
    if (!isPushSupported()) return;
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return;

        const endpoint = subscription.endpoint;
        await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
        await subscription.unsubscribe();
    } catch {
        // Silent failure: never block sign-out.
    }
}

export async function hasActivePushSubscription(): Promise<boolean> {
    if (!isPushSupported() || Notification.permission !== 'granted') return false;
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        return subscription !== null;
    } catch {
        return false;
    }
}

export async function getPromotionalPreference(userId: string): Promise<boolean> {
    try {
        const { data, error } = await supabase
            .from('push_subscriptions')
            .select('promotional_enabled')
            .eq('user_id', userId);
        if (error || !data || data.length === 0) return true;
        return data.some((row: { promotional_enabled?: boolean }) => row.promotional_enabled !== false);
    } catch {
        return true;
    }
}

export async function setPromotionalPreference(userId: string, enabled: boolean): Promise<void> {
    const { error } = await supabase
        .from('push_subscriptions')
        .update({ promotional_enabled: enabled })
        .eq('user_id', userId);
    if (error) {
        throw new Error(error.message);
    }
}
