import { expect, test } from '@playwright/test';

import {
    getEffectiveProductionStatus,
    getEffectiveIssueState,
    getCaseLocation,
} from '../src/constants/orderLifecycle';
import { canEditOrderField } from '../src/lib/workflowPermissions';

test.describe('WF-2: getEffectiveProductionStatus', () => {
    test('prefers column value when present and valid', () => {
        const order = { status: 'New Case', productionStatus: 'in_production' } as any;
        expect(getEffectiveProductionStatus(order)).toBe('in_production');
    });

    test('falls back to legacy derivation when column is missing', () => {
        const order = { status: 'Delivered' } as any;
        expect(getEffectiveProductionStatus(order)).toBe('final_delivered');
    });

    test('falls back when column has invalid value', () => {
        const order = { status: 'Ready', productionStatus: 'bogus' } as any;
        expect(getEffectiveProductionStatus(order)).toBe('final_ready');
    });
});

test.describe('WF-2: getEffectiveIssueState', () => {
    test('prefers column value when present', () => {
        const order = { status: 'Under Production', issueState: 'on_hold' } as any;
        expect(getEffectiveIssueState(order)).toBe('on_hold');
    });

    test('falls back to legacy derivation', () => {
        const order = { status: 'Returned for Adjustments' } as any;
        expect(getEffectiveIssueState(order)).toBe('returned');
    });
});

test.describe('WF-2: getCaseLocation', () => {
    test('on_hold overrides production status', () => {
        expect(getCaseLocation('in_production', 'on_hold')).toBe('on_hold');
    });

    test('cancelled maps to closed', () => {
        expect(getCaseLocation('in_production', 'cancelled')).toBe('closed');
    });

    test('returned maps to issue_review', () => {
        expect(getCaseLocation('final_ready', 'returned')).toBe('issue_review');
    });

    test('normal flow maps correctly', () => {
        expect(getCaseLocation('not_started', 'none')).toBe('pending_intake');
        expect(getCaseLocation('designing', 'none')).toBe('internal_design');
        expect(getCaseLocation('in_production', 'none')).toBe('internal_production');
        expect(getCaseLocation('try_in_ready', 'none')).toBe('with_doctor_waiting');
        expect(getCaseLocation('waiting_doctor', 'none')).toBe('with_doctor_waiting');
        expect(getCaseLocation('finalization', 'none')).toBe('internal_finalization');
        expect(getCaseLocation('final_ready', 'none')).toBe('internal_ready_final');
        expect(getCaseLocation('final_delivered', 'none')).toBe('with_doctor_final');
        expect(getCaseLocation('designing', 'none', { workflowType: 'split' })).toBe('with_designer');
        expect(getCaseLocation('in_production', 'none', { supplierId: 'sup-1' })).toBe('with_external_lab');
    });
});

test.describe('WF-2: canEditOrderField', () => {
    test('admin can always edit', () => {
        expect(canEditOrderField('admin', 'total_price', 'final_delivered', 'none')).toBe(true);
    });

    test('rep can edit allowed field in valid state', () => {
        expect(canEditOrderField('representative', 'patient_name', 'in_production', 'none')).toBe(true);
    });

    test('rep cannot edit denied field', () => {
        expect(canEditOrderField('representative', 'manual_cost', 'in_production', 'none')).toBe(false);
    });

    test('rep cannot edit allowed field in invalid state', () => {
        expect(canEditOrderField('representative', 'patient_name', 'in_production', 'returned')).toBe(false);
    });

    test('designer can only edit design fields', () => {
        expect(canEditOrderField('designer', 'design_url', 'designing', 'none')).toBe(true);
        expect(canEditOrderField('designer', 'patient_name', 'designing', 'none')).toBe(false);
    });

    test('accountant can edit financial fields', () => {
        expect(canEditOrderField('accountant', 'total_price', 'in_production', 'none')).toBe(true);
        expect(canEditOrderField('accountant', 'patient_name', 'in_production', 'none')).toBe(false);
    });

    test('doctor cannot edit anything', () => {
        expect(canEditOrderField('doctor', 'patient_name', 'not_started', 'none')).toBe(false);
    });
});

import { getForwardActions, getIssueActions } from '../src/constants/workflowTransitions';

test.describe('WF-4: getForwardActions', () => {
    test('not_started with split workflow shows start_design', () => {
        const actions = getForwardActions('not_started', 'none', { workflowType: 'split', status: 'New Case' });
        expect(actions.some(a => a.id === 'start_design')).toBe(true);
    });

    test('not_started with full workflow shows only start_production', () => {
        const actions = getForwardActions('not_started', 'none', { workflowType: 'full', status: 'New Case' });
        expect(actions.some(a => a.id === 'start_design')).toBe(false);
        expect(actions.some(a => a.id === 'start_production')).toBe(true);
    });

    test('Pending Review shows no forward actions', () => {
        const actions = getForwardActions('not_started', 'none', { status: 'Pending Review' });
        expect(actions.length).toBe(0);
    });

    test('in_production with TryIn shows try_in_ready', () => {
        const actions = getForwardActions('in_production', 'none', { deliveryType: 'TryIn' });
        expect(actions[0].id).toBe('try_in_ready');
    });

    test('in_production with Final shows ready', () => {
        const actions = getForwardActions('in_production', 'none', { deliveryType: 'Final' });
        expect(actions[0].id).toBe('ready');
    });

    test('final_ready shows deliver with confirmation', () => {
        const actions = getForwardActions('final_ready', 'none', {});
        expect(actions[0].id).toBe('deliver');
        expect(actions[0].requiresConfirmation).toBe(true);
    });

    test('final_delivered shows no forward actions', () => {
        expect(getForwardActions('final_delivered', 'none', {}).length).toBe(0);
    });

    test('returned issue state shows resume regardless of productionStatus', () => {
        const actions = getForwardActions('in_production', 'returned', {});
        expect(actions[0].id).toBe('resume_production');
    });

    test('rejected issue state shows no actions', () => {
        expect(getForwardActions('in_production', 'rejected', {}).length).toBe(0);
    });
});

test.describe('WF-4: getIssueActions', () => {
    test('normal state lab user sees return action only', () => {
        const actions = getIssueActions('none', 'lab');
        expect(actions.some(a => a.id === 'return')).toBe(true);
        expect(actions.some(a => a.id === 'reject')).toBe(false);
    });

    test('admin sees return, reject, and cancel', () => {
        const actions = getIssueActions('none', 'admin');
        expect(actions.some(a => a.id === 'return')).toBe(true);
        expect(actions.some(a => a.id === 'reject')).toBe(true);
        expect(actions.some(a => a.id === 'cancel')).toBe(true);
    });

    test('rejected state shows no actions even for admin', () => {
        expect(getIssueActions('rejected', 'admin').length).toBe(0);
    });

    test('returned state does not show return again', () => {
        const actions = getIssueActions('returned', 'admin');
        expect(actions.some(a => a.id === 'return')).toBe(false);
    });
});
