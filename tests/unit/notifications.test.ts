import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    notificationService,
    NOTIFICATION_CHANGED_EVENT,
    type InAppNotification
} from '../../src/services/supabase/notificationService';
import { supabase } from '../../src/lib/supabase';

vi.mock('../../src/lib/supabase', () => ({
    supabase: {
        rpc: vi.fn(),
        from: vi.fn(),
        storage: {
            from: vi.fn(() => ({
                createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example' }, error: null }),
            })),
        },
    },
}));

describe('In-app Notification Center (Decisions 81-85, B09, B14, B16)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Starter Events & Recipient Routing', () => {
        it('handles Admin starter events: pending Design QC, physical inspection, bypasses, courier reconciliation', async () => {
            const adminNotifications: InAppNotification[] = [
                {
                    id: 'notif-1',
                    eventType: 'pending_design_qc',
                    entityType: 'order',
                    entityId: 'order-101',
                    title: 'تصميم بانتظار المراجعة',
                    summary: 'الحالة #ORD-101 بانتظار مراجعة النسخة 1',
                    actionUrl: '/production/design-qc?orderId=order-101',
                    metadata: { order_id: 'order-101', revision_no: 1 },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T10:00:00Z'
                },
                {
                    id: 'notif-2',
                    eventType: 'design_qc_bypassed',
                    entityType: 'order',
                    entityId: 'order-102',
                    title: 'تجاوز فحص التصميم',
                    summary: 'تم تجاوز فحص التصميم — سبب: استعجال الطبيب',
                    actionUrl: '/production/design-qc?orderId=order-102',
                    metadata: { order_id: 'order-102', reason: 'استعجال الطبيب' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T10:05:00Z'
                },
                {
                    id: 'notif-3',
                    eventType: 'physical_qc_bypassed',
                    entityType: 'order',
                    entityId: 'order-103',
                    title: 'تجاوز الفحص الفعلي',
                    summary: 'تم تجاوز الفحص الفعلي للأوردر — سبب: موافقة هاتفية',
                    actionUrl: '/production/board',
                    metadata: { order_id: 'order-103', reason: 'موافقة هاتفية' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T10:10:00Z'
                },
                {
                    id: 'notif-4',
                    eventType: 'courier_invoice_reconciliation_pending',
                    entityType: 'courier_monthly_invoice',
                    entityId: 'inv-aug',
                    title: 'فاتورة شحن بانتظار المطابقة',
                    summary: 'فاتورة شركة الشحن لشهر 2026-08 برقم INV-AUG جاهزة للمطابقة والاعتماد',
                    actionUrl: '/finance/couriers',
                    metadata: { invoice_id: 'inv-aug', invoice_ref: 'INV-AUG' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T10:15:00Z'
                }
            ];

            vi.mocked(supabase.rpc).mockResolvedValueOnce({
                data: adminNotifications,
                error: null
            } as any);

            const result = await notificationService.getNotifications(10);
            expect(result).toHaveLength(4);
            expect(result[0].eventType).toBe('pending_design_qc');
            expect(result[1].eventType).toBe('design_qc_bypassed');
            expect(result[2].eventType).toBe('physical_qc_bypassed');
            expect(result[3].eventType).toBe('courier_invoice_reconciliation_pending');
        });

        it('handles Coordinator starter events: rejection followup, shipping ready, failed delivery, admin bypass rejection', async () => {
            const coordinatorNotifications: InAppNotification[] = [
                {
                    id: 'notif-c1',
                    eventType: 'rejection_followup',
                    entityType: 'order',
                    entityId: 'order-201',
                    title: 'طلب مرفوض يحتاج متابعة جهة التنفيذ',
                    summary: 'طلب مرفوض يحتاج متابعة جهة التنفيذ — طلب ORD-201',
                    actionUrl: '/orders?search=ORD-201',
                    metadata: { order_id: 'order-201' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T11:00:00Z'
                },
                {
                    id: 'notif-c2',
                    eventType: 'shipping_ready',
                    entityType: 'order',
                    entityId: 'order-202',
                    title: 'طلب جاهز للشحن',
                    summary: 'الحالة #ORD-202 أصبحت جاهزة للشحن والتجهيز',
                    actionUrl: '/production/shipments',
                    metadata: { order_id: 'order-202' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T11:05:00Z'
                },
                {
                    id: 'notif-c3',
                    eventType: 'delivery_failed_or_returned',
                    entityType: 'shipment',
                    entityId: 'shp-301',
                    title: 'فشل توصيل شحنة',
                    summary: 'محاولة الشحن SHP-301 (فشل تسليم) — سبب: العيادة مغلقة',
                    actionUrl: '/production/shipments',
                    metadata: { shipment_code: 'SHP-301', reason: 'العيادة مغلقة' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T11:10:00Z'
                },
                {
                    id: 'notif-c4',
                    eventType: 'admin_bypass_rejection',
                    entityType: 'order',
                    entityId: 'order-203',
                    title: 'رفض لاحق لتصميم متجاوز',
                    summary: 'رفض لاحق لتصميم متجاوز — طلب ORD-203',
                    actionUrl: '/orders?search=ORD-203',
                    metadata: { order_id: 'order-203' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T11:15:00Z'
                }
            ];

            vi.mocked(supabase.rpc).mockResolvedValueOnce({
                data: coordinatorNotifications,
                error: null
            } as any);

            const result = await notificationService.getNotifications(10);
            expect(result).toHaveLength(4);
            expect(result[0].eventType).toBe('rejection_followup');
            expect(result[1].eventType).toBe('shipping_ready');
            expect(result[2].eventType).toBe('delivery_failed_or_returned');
            expect(result[3].eventType).toBe('admin_bypass_rejection');
        });

        it('handles Designer starter events with strict privacy: no supplier identity or financial leak', async () => {
            const designerNotifications: InAppNotification[] = [
                {
                    id: 'notif-d1',
                    eventType: 'designer_assigned',
                    entityType: 'order',
                    entityId: 'order-401',
                    title: 'تم إسناد تصميم حالة جديدة إليك',
                    summary: 'تم إسناد تصميم الحالة #ORD-401 إليك.',
                    actionUrl: '/dashboard',
                    metadata: { order_id: 'order-401', case_id: 'ORD-401' }, // Clean metadata, NO supplier_id or costs
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T12:00:00Z'
                },
                {
                    id: 'notif-d2',
                    eventType: 'design_returned_notes',
                    entityType: 'order',
                    entityId: 'order-401',
                    title: 'إعادة التصميم بالملاحظات',
                    summary: 'مطلوب تعديل خط الإنهاء في السن 21',
                    actionUrl: '/dashboard',
                    metadata: { order_id: 'order-401', notes: 'مطلوب تعديل خط الإنهاء في السن 21' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T12:30:00Z'
                },
                {
                    id: 'notif-d3',
                    eventType: 'design_review_decision',
                    entityType: 'order',
                    entityId: 'order-401',
                    title: 'نتيجة مراجعة التصميم',
                    summary: 'تم اعتماد تصميم الحالة #ORD-401',
                    actionUrl: '/dashboard',
                    metadata: { order_id: 'order-401', action: 'approved' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T13:00:00Z'
                }
            ];

            vi.mocked(supabase.rpc).mockResolvedValueOnce({
                data: designerNotifications,
                error: null
            } as any);

            const result = await notificationService.getNotifications(10);
            expect(result).toHaveLength(3);
            for (const notif of result) {
                expect(notif.summary).not.toContain('Harmony');
                expect(notif.summary).not.toContain('تكلفة');
                expect(notif.metadata.supplier_id).toBeUndefined();
                expect(notif.metadata.lab_cost).toBeUndefined();
                expect(notif.metadata.selling_price).toBeUndefined();
            }
        });

        it('handles Internal-production assignee starter events: printing and reprinting tasks', async () => {
            const printNotifications: InAppNotification[] = [
                {
                    id: 'notif-p1',
                    eventType: 'print_task_assigned',
                    entityType: 'order',
                    entityId: 'order-501',
                    title: 'مهمة طباعة مسندة إليك',
                    summary: 'تم إسناد مهمة طباعة للحالة #ORD-501',
                    actionUrl: '/production/tasks',
                    metadata: { order_id: 'order-501', case_id: 'ORD-501' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T14:00:00Z'
                },
                {
                    id: 'notif-p2',
                    eventType: 'print_reprint_requested',
                    entityType: 'order',
                    entityId: 'order-501',
                    title: 'طلب إعادة طباعة',
                    summary: 'مطلوب إعادة طباعة للحالة #ORD-501',
                    actionUrl: '/production/tasks',
                    metadata: { order_id: 'order-501', case_id: 'ORD-501', rework_of: 'run-prev' },
                    isRead: false,
                    readAt: null,
                    createdAt: '2026-11-16T14:30:00Z'
                }
            ];

            vi.mocked(supabase.rpc).mockResolvedValueOnce({
                data: printNotifications,
                error: null
            } as any);

            const result = await notificationService.getNotifications(10);
            expect(result).toHaveLength(2);
            expect(result[0].eventType).toBe('print_task_assigned');
            expect(result[1].eventType).toBe('print_reprint_requested');
        });
    });

    describe('Read State vs Task Resolution (Decision 82)', () => {
        it('marking a notification as read updates read state without altering or closing the task', async () => {
            const fakeDispatch = vi.fn();
            vi.stubGlobal('window', { dispatchEvent: fakeDispatch, Event: class {} });

            vi.mocked(supabase.rpc).mockResolvedValueOnce({
                data: true,
                error: null
            } as any);

            const success = await notificationService.markAsRead('notif-1');
            expect(success).toBe(true);
            expect(supabase.rpc).toHaveBeenCalledWith('mark_notification_read', {
                p_notification_id: 'notif-1'
            });
            expect(fakeDispatch).toHaveBeenCalled();

            vi.unstubAllGlobals();
        });

        it('markAllAsRead updates unread count and notifies listeners', async () => {
            const fakeDispatch = vi.fn();
            vi.stubGlobal('window', { dispatchEvent: fakeDispatch, Event: class {} });

            vi.mocked(supabase.rpc).mockResolvedValueOnce({
                data: 5,
                error: null
            } as any);

            const updatedCount = await notificationService.markAllAsRead();
            expect(updatedCount).toBe(5);
            expect(supabase.rpc).toHaveBeenCalledWith('mark_all_notifications_read');

            vi.unstubAllGlobals();
        });

        it('getUnreadCount returns accurate unread count from RPC', async () => {
            vi.mocked(supabase.rpc).mockResolvedValueOnce({
                data: 3,
                error: null
            } as any);

            const count = await notificationService.getUnreadCount();
            expect(count).toBe(3);
            expect(supabase.rpc).toHaveBeenCalledWith('get_unread_notification_count');
        });
    });
});
