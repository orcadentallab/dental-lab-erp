import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import GlobalSearch from '../../src/components/GlobalSearch';
import Orders from '../../src/pages/Orders';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { ToastProvider } from '../../src/context/ToastContext';
import { db, type Order } from '../../src/services/db';
import '../../src/index.css';

const doctor = { id: 'doctor-search', name: 'حسام جابر', doctorCode: '1043' };
const orders = [
    { id: 'delivered-search', caseId: '1043-260709-506', patientName: 'وسام', status: 'Delivered' },
    { id: 'archived-search', caseId: '1043-260709-507', patientName: 'وسام مؤرشف', status: 'Delivered', isArchived: true },
].map(order => ({
    ...order, doctorId: doctor.id, items: [], comments: [], totalPrice: 0, cost: 0,
    createdAt: '2026-07-09T12:00:00Z', deliveryDate: '2026-07-10', priority: 'Normal',
})) as Order[];

Object.assign(db, {
    getDoctors: async () => [doctor],
    getSuppliers: async () => [],
    getUsers: async () => [],
    getOrdersByIds: async () => [],
    getRedoOrdersByOriginalIds: async () => [],
    getOrders: async (page = 1, size = 50, filters: Record<string, unknown> = {}) => {
        const data = orders.filter(order =>
            (!filters.search || `${order.caseId} ${order.patientName}`.includes(String(filters.search))) &&
            (!filters.doctorId || order.doctorId === filters.doctorId) &&
            (!filters.hideDelivered || order.status !== 'Delivered') &&
            (!filters.status || order.status === filters.status) &&
            (filters.includeArchived || Boolean(order.isArchived) === Boolean(filters.showArchived))
        );
        return { data: data.slice((page - 1) * size, page * size), count: data.length };
    },
});

function Fixture() {
    const location = useLocation();
    return <>
        <output data-testid="location">{location.search}</output>
        <GlobalSearch />
        <Orders />
    </>;
}

createRoot(document.getElementById('root')!).render(
    <LanguageProvider><ToastProvider>
        <MemoryRouter initialEntries={['/orders?q=old&status=New+Case&page=3&view=board']}>
            <Fixture />
        </MemoryRouter>
    </ToastProvider></LanguageProvider>,
);
