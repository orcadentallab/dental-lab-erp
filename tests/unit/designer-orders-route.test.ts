import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../src/components/ProtectedRoute';
const auth = vi.hoisted(() => ({ user: { id: 'test', name: 'Test', username: 'test', role: 'designer' }, isAuthenticated: true, isLoading: false }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => auth }));
const render = (path = '/orders', capability: 'view_orders' | 'view_my_tasks' = 'view_orders') => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path + '?highlight=private'] },
    createElement(Routes, null, createElement(Route, { element: createElement(ProtectedRoute, { requiredCapability: capability }) },
        createElement(Route, { path, element: createElement('div', null, 'PRIVATE_ORDER_PAGE') })))));
describe('direct orders route access', () => {
    it('does not mount the orders page for a designer opening a bookmarked URL', () => {
        auth.user.role = 'designer';
        expect(render()).not.toContain('PRIVATE_ORDER_PAGE');
    });
    it('mounts orders for an authorised representative', () => {
        auth.user.role = 'representative';
        expect(render()).toContain('PRIVATE_ORDER_PAGE');
    });
});


describe('direct production route access', () => {
    it('does not mount the task queue for a designer', () => {
        auth.user.role = 'designer';
        expect(render('/production/my-tasks', 'view_my_tasks')).not.toContain('PRIVATE_ORDER_PAGE');
    });
    it('keeps the task queue available for technicians', () => {
        auth.user.role = 'technician';
        expect(render('/production/my-tasks', 'view_my_tasks')).toContain('PRIVATE_ORDER_PAGE');
    });
});
