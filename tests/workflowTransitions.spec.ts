import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe('WF-3 & WF-4: Workflow service operations wiring', () => {
    const serviceSource = readFileSync(resolve('src/services/supabase/orderWorkflow.ts'), 'utf8');

    test('implements changeProductionStatus with role checks and double-column updates', () => {
        expect(serviceSource).toContain('export async function changeProductionStatus');
        expect(serviceSource).toContain('getCallerRoleAndId()');
        expect(serviceSource).toContain('canChangeProductionStatus(');
        expect(serviceSource).toContain('mapProductionStatusToLegacy(');
        expect(serviceSource).toContain('productionStatus: newStatus');
        expect(serviceSource).toContain('status: targetLegacyStatus');
        expect(serviceSource).toContain('addOrderEvent(');
        expect(serviceSource).toContain('getStatusChangeEventType(');
    });

    test('implements changeIssueState with role checks, issue-to-legacy mapping, and double-column updates', () => {
        expect(serviceSource).toContain('export async function changeIssueState');
        expect(serviceSource).toContain('canChangeIssueState(');
        expect(serviceSource).toContain('issueState: newIssueState');
        expect(serviceSource).toContain('status: targetLegacyStatus');
        expect(serviceSource).toContain('productionStatus: targetProductionStatus');
        expect(serviceSource).toContain('getIssueEventDetails(');
    });

    test('implements updateAssignmentWithReason with role permissions and event logging', () => {
        expect(serviceSource).toContain('export async function updateAssignmentWithReason');
        expect(serviceSource).toContain('canEditOrderField(userRole, \'supplier_id\'');
        expect(serviceSource).toContain('canEditOrderField(userRole, \'designer_id\'');
        expect(serviceSource).toContain('ORDER_EVENT_TYPES.supplierChanged');
        expect(serviceSource).toContain('ORDER_EVENT_TYPES.designerChanged');
    });

    test('implements updateUrgencyWithReason with role permissions and event logging', () => {
        expect(serviceSource).toContain('export async function updateUrgencyWithReason');
        expect(serviceSource).toContain('canEditOrderField(userRole, \'is_urgent\'');
        expect(serviceSource).toContain('ORDER_EVENT_TYPES.urgencyChanged');
    });
});
