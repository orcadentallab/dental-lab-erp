import { useCallback, useEffect, useState } from 'react';
import { doctorPortalService, type SupportThread } from '../services/doctorPortalService';

export const DOCTOR_CHAT_CHANGED = 'doctor-chat-changed';

export function refreshDoctorChat() {
    window.dispatchEvent(new Event(DOCTOR_CHAT_CHANGED));
}

export function useDoctorChatPolling(refresh: () => Promise<void>, enabled = true) {
    useEffect(() => {
        if (!enabled) return;
        const update = () => { void refresh(); };
        update();
        const timer = window.setInterval(update, 30_000);
        window.addEventListener('focus', update);
        window.addEventListener(DOCTOR_CHAT_CHANGED, update);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', update);
            window.removeEventListener(DOCTOR_CHAT_CHANGED, update);
        };
    }, [refresh, enabled]);
}

export function useDoctorChat(orderId?: string, threadId?: string) {
    const [threads, setThreads] = useState<SupportThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const refresh = useCallback(async () => {
        try {
            setThreads(await doctorPortalService.chat(orderId, threadId));
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [orderId, threadId]);
    useDoctorChatPolling(refresh);
    return { threads, loading, failed, refresh };
}

export function useCaseChatUnread(orderIds: string[], enabled: boolean) {
    const key = orderIds.join(',');
    const [counts, setCounts] = useState<Record<string, number>>({});
    const refresh = useCallback(async () => {
        if (!key) return;
        try {
            const rows = await doctorPortalService.caseChatUnread(key.split(','));
            setCounts(Object.fromEntries(rows.map(row => [row.order_id, row.unread])));
        } catch {
            // Missing counts leave the case chat available.
        }
    }, [key]);
    useDoctorChatPolling(refresh, enabled);
    return counts;
}
