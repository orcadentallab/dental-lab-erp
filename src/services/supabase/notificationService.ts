import { supabase } from '../../lib/supabase';

export interface InAppNotification {
    id: string;
    eventType: string;
    entityType: string;
    entityId: string;
    title: string;
    summary: string;
    actionUrl: string;
    metadata: Record<string, unknown>;
    isRead: boolean;
    readAt: string | null;
    createdAt: string;
}

export const NOTIFICATION_CHANGED_EVENT = 'IN_APP_NOTIFICATION_CHANGED';

export function notifyNotificationStateChange(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(NOTIFICATION_CHANGED_EVENT));
    }
}

export const notificationService = {
    /**
     * Fetch the user's notifications.
     */
    async getNotifications(limit = 50, unreadOnly = false): Promise<InAppNotification[]> {
        const { data, error } = await supabase.rpc('get_in_app_notifications', {
            p_limit: limit,
            p_unread_only: unreadOnly
        });

        if (error) {
            // Fallback to direct select if RPC is unavailable during transition
            const query = supabase
                .from('in_app_notifications')
                .select('id, event_type, entity_type, entity_id, title, summary, action_url, metadata, is_read, read_at, created_at')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (unreadOnly) {
                query.eq('is_read', false);
            }

            const fallback = await query;
            if (fallback.error) {
                console.error('Failed to load notifications:', fallback.error);
                return [];
            }
            return (fallback.data || []).map((row: any) => ({
                id: row.id,
                eventType: row.event_type || row.eventType,
                entityType: row.entity_type || row.entityType,
                entityId: row.entity_id || row.entityId,
                title: row.title,
                summary: row.summary,
                actionUrl: row.action_url || row.actionUrl,
                metadata: row.metadata || {},
                isRead: row.is_read ?? row.isRead ?? false,
                readAt: row.read_at ?? row.readAt ?? null,
                createdAt: row.created_at || row.createdAt
            }));
        }

        return (data || []).map((row: any) => ({
            id: row.id,
            eventType: row.event_type || row.eventType,
            entityType: row.entity_type || row.entityType,
            entityId: row.entity_id || row.entityId,
            title: row.title,
            summary: row.summary,
            actionUrl: row.action_url || row.actionUrl,
            metadata: row.metadata || {},
            isRead: row.is_read ?? row.isRead ?? false,
            readAt: row.read_at ?? row.readAt ?? null,
            createdAt: row.created_at || row.createdAt
        }));
    },

    /**
     * Get the current user's unread notification count.
     */
    async getUnreadCount(): Promise<number> {
        const { data, error } = await supabase.rpc('get_unread_notification_count');
        if (error) {
            const fallback = await supabase
                .from('in_app_notifications')
                .select('id', { count: 'exact', head: true })
                .eq('is_read', false);

            if (fallback.error) {
                console.error('Failed to load unread count:', fallback.error);
                return 0;
            }
            return fallback.count || 0;
        }
        return Number(data || 0);
    },

    /**
     * Mark a single notification as read.
     * Note: Reading a notification does NOT mark or resolve the underlying task (Decision 82).
     */
    async markAsRead(notificationId: string): Promise<boolean> {
        const { error } = await supabase.rpc('mark_notification_read', {
            p_notification_id: notificationId
        });

        if (error) {
            const fallback = await supabase
                .from('in_app_notifications')
                .update({ is_read: true, read_at: new Date().toISOString() })
                .eq('id', notificationId);

            if (fallback.error) {
                console.error('Failed to mark notification read:', fallback.error);
                return false;
            }
        }

        notifyNotificationStateChange();
        return true;
    },

    /**
     * Mark all notifications as read for current user.
     */
    async markAllAsRead(): Promise<number> {
        const { data, error } = await supabase.rpc('mark_all_notifications_read');
        if (error) {
            const fallback = await supabase
                .from('in_app_notifications')
                .update({ is_read: true, read_at: new Date().toISOString() })
                .eq('is_read', false);

            if (fallback.error) {
                console.error('Failed to mark all notifications read:', fallback.error);
                return 0;
            }
            notifyNotificationStateChange();
            return 1;
        }

        notifyNotificationStateChange();
        return Number(data || 0);
    }
};
