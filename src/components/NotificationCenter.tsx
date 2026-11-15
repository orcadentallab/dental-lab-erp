import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ExternalLink, Inbox } from 'lucide-react';
import { useInAppNotifications } from '../hooks/useInAppNotifications';

function formatNotificationTime(isoString: string): string {
    const timestamp = Date.parse(isoString);
    if (!Number.isFinite(timestamp)) return '';
    const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSeconds < 60) return 'الآن';
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 60) return `منذ ${minutes} د`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} س`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `منذ ${days} ي`;
    return isoString.split('T')[0];
}

export default function NotificationCenter() {
    const navigate = useNavigate();
    const {
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead
    } = useInAppNotifications();

    const [isOpen, setIsOpen] = useState(false);
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target;
            if (target instanceof Node && containerRef.current?.contains(target)) return;
            setIsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen]);

    const displayedNotifications = filter === 'unread'
        ? notifications.filter(n => !n.isRead)
        : notifications;

    const handleItemClick = (notification: { id: string; actionUrl: string; isRead: boolean }) => {
        if (!notification.isRead) {
            void markAsRead(notification.id);
        }
        setIsOpen(false);
        navigate(notification.actionUrl);
    };

    return (
        <div ref={containerRef} className="relative print:hidden" dir="rtl">
            <button
                type="button"
                onClick={() => setIsOpen(open => !open)}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-label={`الإشعارات ${unreadCount > 0 ? `(${unreadCount} غير مقروء)` : ''}`}
                className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-200/80 bg-white/90 p-2 text-teal-800 shadow-sm transition-all hover:border-teal-300 hover:bg-teal-50/70 focus:outline-none focus:ring-2 focus:ring-teal-500/20 active:scale-95"
            >
                <Bell size={18} className="text-teal-700" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -start-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white shadow-sm ring-2 ring-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div
                    role="dialog"
                    aria-label="قائمة الإشعارات"
                    className="absolute start-0 top-full z-50 mt-2 w-80 sm:w-96 rounded-2xl border border-teal-100 bg-white p-3 shadow-xl backdrop-blur-xl animate-in fade-in-0 zoom-in-95"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-teal-50 pb-2.5">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-teal-950">الإشعارات</span>
                            {unreadCount > 0 && (
                                <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800">
                                    {unreadCount} جديد
                                </span>
                            )}
                        </div>
                        {unreadCount > 0 && (
                            <button
                                type="button"
                                onClick={() => void markAllAsRead()}
                                className="inline-flex items-center gap-1 text-[12px] font-medium text-cyan-700 hover:text-cyan-800 hover:underline"
                            >
                                <CheckCheck size={14} />
                                <span>تحديد الكل كمقروء</span>
                            </button>
                        )}
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex items-center gap-1 pt-2 pb-1 text-xs">
                        <button
                            type="button"
                            onClick={() => setFilter('all')}
                            className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                                filter === 'all'
                                    ? 'bg-teal-100/70 text-teal-900 font-bold'
                                    : 'text-gray-500 hover:bg-gray-100'
                            }`}
                        >
                            الكل ({notifications.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter('unread')}
                            className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                                filter === 'unread'
                                    ? 'bg-teal-100/70 text-teal-900 font-bold'
                                    : 'text-gray-500 hover:bg-gray-100'
                            }`}
                        >
                            غير المقروء ({unreadCount})
                        </button>
                    </div>

                    {/* Notifications List */}
                    <div className="mt-1 max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-teal-100">
                        {loading && notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                                <span className="text-xs">جاري التحميل...</span>
                            </div>
                        ) : displayedNotifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                                <Inbox size={28} className="mb-2 text-gray-300" />
                                <span className="text-xs">لا توجد إشعارات حالياً</span>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {displayedNotifications.map(item => (
                                    <div
                                        key={item.id}
                                        onClick={() => handleItemClick(item)}
                                        className={`group flex cursor-pointer items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-teal-50/50 ${
                                            !item.isRead ? 'bg-cyan-50/40' : ''
                                        }`}
                                    >
                                        <div className="mt-1 flex shrink-0">
                                            {!item.isRead ? (
                                                <span className="h-2 w-2 rounded-full bg-cyan-600 ring-2 ring-cyan-200" />
                                            ) : (
                                                <span className="h-2 w-2 rounded-full bg-transparent" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-1">
                                                <p className="truncate text-xs font-bold text-gray-900 group-hover:text-cyan-800">
                                                    {item.title}
                                                </p>
                                                <span className="shrink-0 text-[10px] text-gray-400">
                                                    {formatNotificationTime(item.createdAt)}
                                                </span>
                                            </div>
                                            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-gray-600">
                                                {item.summary}
                                            </p>
                                            <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-cyan-700 opacity-80 group-hover:opacity-100">
                                                <span>فتح الإجراء</span>
                                                <ExternalLink size={10} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
