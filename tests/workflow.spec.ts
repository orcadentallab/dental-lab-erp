import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    PRODUCTION_STATUSES,
    ISSUE_STATES,
    PRODUCTION_STATUS_LABELS_AR,
    ISSUE_STATE_LABELS_AR,
    isProductionStatus,
    isIssueState,
    ORDER_EVENT_SOURCES,
    WORKFLOW_STRICT_REP_FLAG,
    REP_AUDIT_IN_PROGRESS_FLAG,
} from '../src/constants/workflow';
import {
    ORDER_EDIT_REASON_CODES,
    ORDER_EDIT_REASON_LABELS_AR,
    isOrderEditReasonCode,
    reasonRequiresNote,
} from '../src/constants/orderEditReasons';
import {
    REP_AUDITED_ALLOW_LIST,
    REP_AUDITED_ALLOW_LIST_CAMEL,
    REP_FIELD_TO_DB,
    isRepAuditedField,
    LAB_BLOCKED_ISSUE_STATES,
    REP_FIELD_STATE_GUARDS,
} from '../src/lib/workflowPermissions';
import { ORDER_EVENT_TYPES } from '../src/constants/orderEvents';

const MIGRATION_PATH = resolve('supabase/migrations/086_add_production_status_and_issue_state_to_orders.sql');
// Rollback file lives outside `supabase/migrations/` so the Supabase CLI does
// NOT auto-apply it after the forward migration during `db reset`.
const ROLLBACK_PATH = resolve('supabase/manual/086_rollback.sql');
const PERMISSIONS_DOC_PATH = resolve('docs/orders-field-permissions.md');

test.describe('WF-1: workflow constants', () => {
    test('PRODUCTION_STATUSES is exactly the 8 approved values', () => {
        expect([...PRODUCTION_STATUSES]).toEqual([
            'not_started', 'designing', 'in_production', 'try_in_ready',
            'waiting_doctor', 'finalization', 'final_ready', 'final_delivered',
        ]);
    });

    test('ISSUE_STATES is exactly the 6 approved values', () => {
        expect([...ISSUE_STATES]).toEqual(['none', 'returned', 'rejected', 'cancelled', 'on_hold', 'redo']);
    });

    test('every production_status has a non-empty Arabic label', () => {
        for (const s of PRODUCTION_STATUSES) {
            expect(PRODUCTION_STATUS_LABELS_AR[s]).toBeTruthy();
        }
    });

    test('every issue_state has a non-empty Arabic label', () => {
        for (const s of ISSUE_STATES) {
            expect(ISSUE_STATE_LABELS_AR[s]).toBeTruthy();
        }
    });

    test('isProductionStatus / isIssueState type guards are accurate', () => {
        expect(isProductionStatus('final_ready')).toBe(true);
        expect(isProductionStatus('bogus')).toBe(false);
        expect(isIssueState('returned')).toBe(true);
        expect(isIssueState('bogus')).toBe(false);
    });

    test('ORDER_EVENT_SOURCES enumerates the four canonical sources', () => {
        expect([...ORDER_EVENT_SOURCES]).toEqual([
            'representative_edit', 'workflow_transition', 'admin_correction', 'lab_operation',
        ]);
    });

    test('feature flag names are stable', () => {
        expect(WORKFLOW_STRICT_REP_FLAG).toBe('app.workflow_strict_rep');
        expect(REP_AUDIT_IN_PROGRESS_FLAG).toBe('app.rep_audit_in_progress');
    });
});

test.describe('WF-1: order edit reason codes', () => {
    test('ORDER_EDIT_REASON_CODES contains the 14 approved values', () => {
        expect(ORDER_EDIT_REASON_CODES.length).toBe(14);
        expect(ORDER_EDIT_REASON_CODES).toContain('other');
        expect(ORDER_EDIT_REASON_CODES).toContain('doctor_requested');
        expect(ORDER_EDIT_REASON_CODES).toContain('external_lab_reassigned');
    });

    test('every reason code has an Arabic label', () => {
        for (const code of ORDER_EDIT_REASON_CODES) {
            expect(ORDER_EDIT_REASON_LABELS_AR[code]).toBeTruthy();
        }
    });

    test("reason 'other' requires a note; others do not", () => {
        expect(reasonRequiresNote('other')).toBe(true);
        expect(reasonRequiresNote('doctor_requested')).toBe(false);
        expect(reasonRequiresNote('internal_correction')).toBe(false);
    });

    test('isOrderEditReasonCode rejects unknown values', () => {
        expect(isOrderEditReasonCode('doctor_requested')).toBe(true);
        expect(isOrderEditReasonCode('not_a_real_reason')).toBe(false);
    });
});

test.describe('WF-1: representative permission constants', () => {
    test('REP_AUDITED_ALLOW_LIST has the 8 approved fields and excludes items', () => {
        expect([...REP_AUDITED_ALLOW_LIST].sort()).toEqual([
            'delivery_date', 'designer_id', 'images_url', 'is_urgent',
            'patient_name', 'priority', 'stl_url', 'supplier_id',
        ]);
        expect(REP_AUDITED_ALLOW_LIST as readonly string[]).not.toContain('items');
        expect(REP_AUDITED_ALLOW_LIST as readonly string[]).not.toContain('total_price');
        expect(REP_AUDITED_ALLOW_LIST as readonly string[]).not.toContain('cost');
    });

    test('camelCase mirror matches snake_case allow-list one-to-one', () => {
        expect(REP_AUDITED_ALLOW_LIST_CAMEL.length).toBe(REP_AUDITED_ALLOW_LIST.length);
        for (const camel of REP_AUDITED_ALLOW_LIST_CAMEL) {
            expect(REP_FIELD_TO_DB[camel]).toBeTruthy();
            expect(REP_AUDITED_ALLOW_LIST as readonly string[]).toContain(REP_FIELD_TO_DB[camel]);
        }
    });

    test('isRepAuditedField rejects fields outside the allow-list', () => {
        expect(isRepAuditedField('patient_name')).toBe(true);
        expect(isRepAuditedField('total_price')).toBe(false);
        expect(isRepAuditedField('items')).toBe(false);
    });

    test('lab is blocked from issue_state rejected/cancelled', () => {
        expect([...LAB_BLOCKED_ISSUE_STATES].sort()).toEqual(['cancelled', 'rejected']);
    });

    test('state guard: supplier_id forbidden after final_ready', () => {
        expect(REP_FIELD_STATE_GUARDS.supplier_id({ productionStatus: 'in_production', issueState: 'none' })).toBe(true);
        expect(REP_FIELD_STATE_GUARDS.supplier_id({ productionStatus: 'final_ready', issueState: 'none' })).toBe(false);
        expect(REP_FIELD_STATE_GUARDS.supplier_id({ productionStatus: 'in_production', issueState: 'returned' })).toBe(false);
    });

    test('state guard: designer_id requires split workflow', () => {
        expect(REP_FIELD_STATE_GUARDS.designer_id({ productionStatus: 'designing', issueState: 'none', workflowType: 'split' })).toBe(true);
        expect(REP_FIELD_STATE_GUARDS.designer_id({ productionStatus: 'designing', issueState: 'none', workflowType: 'full' })).toBe(false);
        expect(REP_FIELD_STATE_GUARDS.designer_id({ productionStatus: 'finalization', issueState: 'none', workflowType: 'split' })).toBe(false);
    });

    test('state guard: is_urgent always allowed (escalate or de-escalate via RPC with reason)', () => {
        expect(REP_FIELD_STATE_GUARDS.is_urgent({ productionStatus: 'final_delivered', issueState: 'none' })).toBe(true);
        expect(REP_FIELD_STATE_GUARDS.is_urgent({ productionStatus: 'in_production', issueState: 'returned' })).toBe(true);
    });

    test('state guard: patient_name forbidden after final delivery or while issue is open', () => {
        expect(REP_FIELD_STATE_GUARDS.patient_name({ productionStatus: 'in_production', issueState: 'none' })).toBe(true);
        expect(REP_FIELD_STATE_GUARDS.patient_name({ productionStatus: 'final_delivered', issueState: 'none' })).toBe(false);
        expect(REP_FIELD_STATE_GUARDS.patient_name({ productionStatus: 'in_production', issueState: 'returned' })).toBe(false);
    });
});

test.describe('WF-1: dormant order_events types', () => {
    test('new event type constants are present', () => {
        expect(ORDER_EVENT_TYPES.patientNameChanged).toBe('patient_name_changed');
        expect(ORDER_EVENT_TYPES.stlUrlChanged).toBe('stl_url_changed');
        expect(ORDER_EVENT_TYPES.imagesUrlChanged).toBe('images_url_changed');
        expect(ORDER_EVENT_TYPES.urgencyChanged).toBe('urgency_changed');
        expect(ORDER_EVENT_TYPES.priorityChanged).toBe('priority_changed');
        expect(ORDER_EVENT_TYPES.supplierChanged).toBe('supplier_changed');
        expect(ORDER_EVENT_TYPES.designerChanged).toBe('designer_changed');
        expect(ORDER_EVENT_TYPES.issueStateChanged).toBe('issue_state_changed');
        expect(ORDER_EVENT_TYPES.caseReturned).toBe('case_returned');
        expect(ORDER_EVENT_TYPES.caseRejected).toBe('case_rejected');
        expect(ORDER_EVENT_TYPES.caseCancelled).toBe('case_cancelled');
        expect(ORDER_EVENT_TYPES.caseHeld).toBe('case_held');
        expect(ORDER_EVENT_TYPES.caseResumed).toBe('case_resumed');
        expect(ORDER_EVENT_TYPES.finalReady).toBe('final_ready');
        expect(ORDER_EVENT_TYPES.finalDelivered).toBe('final_delivered');
        expect(ORDER_EVENT_TYPES.finalizationStarted).toBe('finalization_started');
        expect(ORDER_EVENT_TYPES.tryInReady).toBe('try_in_ready');
        expect(ORDER_EVENT_TYPES.orderFieldChanged).toBe('order_field_changed');
    });
});

test.describe('WF-1: migration 086 source snapshot', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');

    test('declares both new columns NOT NULL with defaults', () => {
        expect(sql).toContain("ADD COLUMN IF NOT EXISTS production_status TEXT NOT NULL DEFAULT 'not_started'");
        expect(sql).toContain("ADD COLUMN IF NOT EXISTS issue_state TEXT NOT NULL DEFAULT 'none'");
    });

    test('declares CHECK constraints for both new columns', () => {
        expect(sql).toMatch(/orders_production_status_check[\s\S]*not_started[\s\S]*final_delivered/);
        expect(sql).toMatch(/orders_issue_state_check[\s\S]*none[\s\S]*on_hold/);
    });

    test('hard rule: legacy Delivered always maps to final_delivered', () => {
        expect(sql).toMatch(/status\s+IN\s*\(\s*'Delivered'\s*,\s*'Completed'\s*\)\s+THEN\s+'final_delivered'/);
    });

    test('Try In with delivery_type=TryIn maps to try_in_ready (conservative default)', () => {
        expect(sql).toMatch(/status\s*=\s*'Try In'\s+AND\s+delivery_type\s*=\s*'TryIn'\s+THEN\s+'try_in_ready'/);
    });

    test('Returned/Rejected fallback is final_ready; Cancelled fallback is not_started', () => {
        expect(sql).toContain("WHEN 'Cancelled' THEN 'not_started'");
        expect(sql).toContain("ELSE 'final_ready'");
    });

    test('terminal-row backfill walks status_history JSONB', () => {
        expect(sql).toContain('jsonb_array_elements(r.status_history)');
        expect(sql).toMatch(/status\s+IN\s*\(\s*'Returned for Adjustments'\s*,\s*'Rejected'\s*,\s*'Cancelled'\s*\)/);
    });

    test('does NOT modify orders.status enum', () => {
        expect(sql).not.toMatch(/orders_status_check/i);
    });

    test('installs orders_role_field_guard with NULL-role bypass', () => {
        expect(sql).toContain('CREATE OR REPLACE FUNCTION orders_role_field_guard()');
        expect(sql).toMatch(/IF\s+v_role\s+IS\s+NULL\s+THEN\s+RETURN\s+NEW/);
    });

    test('representative branch is feature-flag-gated by app.workflow_strict_rep', () => {
        expect(sql).toContain("current_setting('app.workflow_strict_rep'");
        expect(sql).toMatch(/v_strict_rep\s+IS\s+DISTINCT\s+FROM\s+'on'/);
    });

    test('strict mode requires the audited RPC tx-flag', () => {
        expect(sql).toContain("current_setting('app.rep_audit_in_progress'");
        expect(sql).toMatch(/representative updates must go through rep_update_order_fields_with_audit/);
    });

    test('lab cannot set issue_state rejected/cancelled', () => {
        expect(sql).toMatch(/lab role cannot set issue_state/);
    });

    test('declares the rep RPC with the approved signature', () => {
        expect(sql).toMatch(/CREATE OR REPLACE FUNCTION rep_update_order_fields_with_audit\(\s*p_order_id\s+UUID/);
        expect(sql).toContain('SECURITY DEFINER');
    });

    test('RPC enforces reason_note required when reason_code=other', () => {
        expect(sql).toMatch(/reason_note required when reason_code=other/);
    });

    test('RPC sets the tx-local audit flag before UPDATE', () => {
        expect(sql).toMatch(/set_config\(\s*'app\.rep_audit_in_progress'\s*,\s*'true'\s*,\s*true\s*\)/);
    });

    test('RPC writes per-field events with explicit event types for each field', () => {
        expect(sql).toContain("'patient_name_changed'");
        expect(sql).toContain("'stl_url_changed'");
        expect(sql).toContain("'images_url_changed'");
        expect(sql).toContain("'delivery_date_changed'");
        expect(sql).toContain("'urgency_changed'");
        expect(sql).toContain("'priority_changed'");
        expect(sql).toContain("'supplier_changed'");
        expect(sql).toContain("'designer_changed'");
    });

    test('RPC excludes items from the allow-list (deferred to WF-1b)', () => {
        // Allow-list literal: locate the v_allowed_keys initializer and verify
        // it has the 8 approved keys and not 'items'.
        const allowListMatch = sql.match(/v_allowed_keys\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/);
        expect(allowListMatch).not.toBeNull();
        const allowList = allowListMatch![1];
        expect(allowList).toContain("'patient_name'");
        expect(allowList).toContain("'supplier_id'");
        expect(allowList).toContain("'designer_id'");
        expect(allowList).not.toContain("'items'");
        expect(allowList).not.toContain("'total_price'");
    });

    test('RPC grants EXECUTE only to authenticated', () => {
        expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+rep_update_order_fields_with_audit[\s\S]+FROM\s+PUBLIC/);
        expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+rep_update_order_fields_with_audit[\s\S]+TO\s+authenticated/);
    });

    test('does not modify existing trigger check_order_update_permissions', () => {
        // Comments may reference the trigger for context; assert no CREATE/DROP.
        expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+check_order_update_permissions/i);
        expect(sql).not.toMatch(/DROP\s+(?:TRIGGER|FUNCTION)[^\n]*check_order_update_permissions/i);
    });

    test('does not modify existing RLS policies on orders', () => {
        expect(sql).not.toMatch(/CREATE\s+POLICY[^"]*ON\s+orders/i);
        expect(sql).not.toMatch(/DROP\s+POLICY[^"]*ON\s+orders/i);
    });
});

test.describe('WF-1: rollback companion snapshot', () => {
    const sql = readFileSync(ROLLBACK_PATH, 'utf-8');

    test('drops everything migration 086 created in reverse order', () => {
        expect(sql).toContain('DROP FUNCTION IF EXISTS rep_update_order_fields_with_audit');
        expect(sql).toContain('DROP TRIGGER IF EXISTS trigger_orders_role_field_guard');
        expect(sql).toContain('DROP FUNCTION IF EXISTS orders_role_field_guard');
        expect(sql).toContain('DROP INDEX IF EXISTS idx_orders_issue_state');
        expect(sql).toContain('DROP INDEX IF EXISTS idx_orders_production_status');
        expect(sql).toContain('DROP COLUMN IF EXISTS issue_state');
        expect(sql).toContain('DROP COLUMN IF EXISTS production_status');
    });
});

test.describe('WF-1: canonical permissions doc', () => {
    const md = readFileSync(PERMISSIONS_DOC_PATH, 'utf-8');

    test('documents the 8-value production_status', () => {
        for (const s of PRODUCTION_STATUSES) {
            expect(md).toContain(s);
        }
    });

    test('documents the 5-value issue_state', () => {
        for (const s of ISSUE_STATES) {
            expect(md).toContain(s);
        }
    });

    test('documents the rep allow-list and feature flag', () => {
        for (const f of REP_AUDITED_ALLOW_LIST) {
            expect(md).toContain(f);
        }
        expect(md).toContain('app.workflow_strict_rep');
        expect(md).toContain('rep_update_order_fields_with_audit');
    });
});
