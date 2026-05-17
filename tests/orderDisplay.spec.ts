import { expect, test } from '@playwright/test';
import {
    DELIVERY_DATE_AUDIT_PREFIX,
    filterVisibleOrderComments,
    getLatestVisibleOrderComment,
    getOrderCardDisplayDate,
    isInternalDeliveryDateAuditComment,
} from '../src/utils/orderDisplay';

const comment = (id: string, text: string) => ({
    id,
    text,
    userId: 'user-1',
    userName: 'User',
    createdAt: '2026-05-08T10:00:00.000Z',
});

test.describe('order display helpers', () => {
    test('hides internal delivery date audit comments while keeping normal comments visible', () => {
        const visible = comment('1', 'Normal user note');
        const audit = comment('2', `System: ${DELIVERY_DATE_AUDIT_PREFIX}|2026-05-14|2026-05-13|user|User|representative`);

        expect(isInternalDeliveryDateAuditComment(audit)).toBe(true);
        expect(filterVisibleOrderComments([visible, audit])).toEqual([visible]);
        expect(getLatestVisibleOrderComment([audit, visible])).toEqual(visible);
    });

    test('Delivered and Completed cards show actual delivery date with legacy fallback', () => {
        expect(getOrderCardDisplayDate({
            status: 'Delivered',
            deliveryDate: '2026-05-10',
            actualDeliveryDate: '2026-05-08',
        }).date).toBe('2026-05-08');

        expect(getOrderCardDisplayDate({
            status: 'Completed',
            deliveryDate: '2026-05-10',
            actualDeliveryDate: undefined,
        })).toEqual({
            label: 'تاريخ التسليم الفعلي',
            date: '2026-05-10',
        });
    });

    test('non-delivered cards keep planned requested delivery date', () => {
        expect(getOrderCardDisplayDate({
            status: 'Ready',
            deliveryDate: '2026-05-10',
            actualDeliveryDate: '2026-05-08',
        })).toEqual({
            label: 'تاريخ التسليم المطلوب',
            date: '2026-05-10',
        });
    });
});
