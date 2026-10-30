import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import OrderCard from '../../src/components/orders/OrderCard';
import type { Order } from '../../src/services/db';
vi.mock('../../src/services/db', () => ({ db: {} }));
vi.mock('../../src/context/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
const render = (role: string) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(OrderCard, {
    order: { id: 'test', patientName: 'Patient Example', doctorId: 'doctor', supplierId: 'lab', designerId: 'designer', status: 'Under Production', productionStatus: 'in_production', issueState: 'none', intakeState: 'pending_review', workflowType: 'split', items: [], createdAt: '2026-10-24', deliveryDate: '2026-10-27' } as unknown as Order,
    doctors: { doctor: 'Private Doctor' }, suppliers: { lab: 'Private Lab' }, users: { designer: 'Designer' },
    userRole: role, onStatusChange: vi.fn(), onExportInvoice: vi.fn(), onAccept: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onRedo: vi.fn(),
    currentUser: { role, customPermissions: { edit_orders: true } },
})));
describe('designer order privacy', () => {
    it('keeps patient details while hiding business data and production controls', () => {
        const html = render('designer');
        expect(html).toContain('Patient Example');
        for (const text of ['Private Doctor', 'Private Lab', 'فاتورة PDF', 'عرض سجل الأوردر', 'عند المعمل الخارجي', 'جاهز للتسليم', 'رجوع للتصميم', 'تعديل الأوردر', 'حذف الأوردر', 'Accept Order', 'أرشفة']) expect(html).not.toContain(text);
    });
    it('preserves administrator business information and controls', () => {
        const html = render('admin');
        for (const text of ['Private Doctor', 'Private Lab', 'فاتورة PDF', 'عرض سجل الأوردر', 'جاهز للتسليم', 'رجوع للتصميم']) expect(html).toContain(text);
    });
});
