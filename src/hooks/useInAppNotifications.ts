import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    notificationService,
    type InAppNotification,
    NOTIFICATION_CHANGED_EVENT
} from '../services/supabase/notificationService';

export function useInAppNotifications() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<InAppNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(true);
    const inFlightRef = useRef(false);

    const loadData = useCallback(async () => {
        if (!user?.id || inFlightRef.current) return;
        inFlightRef.current = true;
        try {
            const [list, count] = await Promise.all([
                notificationService.getNotifications(30),
                notificationService.getUnreadCount()
            ]);
            setNotifications(list);
            setUnreadCount(count);
        } catch (error) {
            console.error('Failed to load in-app notifications:', error);
        } finally {
            inFlightRef.current = false;
            setLoading(false);
        }
    }, [user?.id]);

    const markAsRead = useCallback(async (id: string) => {
        // Optimistic update
        setNotifications(prev =>
            prev.map(n => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n))
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
        await notificationService.markAsRead(id);
    }, []);

    const markAllAsRead = useCallback(async () => {
        setNotifications(prev =>
            prev.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
        );
        setUnreadCount(0);
        await notificationService.markAllAsRead();
    }, []);

    useEffect(() => {
        if (!user?.id) return;

        void loadData();

        const onEvent = () => void loadData();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void loadData();
        };

        window.addEventListener(NOTIFICATION_CHANGED_EVENT, onEvent);
        window.addEventListener('focus', onVisibility);
        document.addEventListener('visibilitychange', onVisibility);

        const timer = window.setInterval(onVisibility, 30000);

        return () => {
            window.removeEventListener(NOTIFICATION_CHANGED_EVENT, onEvent);
            window.removeEventListener('focus', onVisibility);
            document.removeEventListener('visibilitychange', onVisibility);
            clearInterval(timer);
        };
    }, [user?.id, loadData]);

    return {
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        refresh: loadData
    };
}
