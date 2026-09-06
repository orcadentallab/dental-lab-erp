import { describe, expect, test } from 'vitest';

import { ACTIVE_ISSUE_STATES, ISSUE_STATES } from '../../src/constants/workflow';
import { canChangeIssueState } from '../../src/lib/workflowPermissions';

describe('retired on_hold workflow state', () => {
    test('remains readable for historical rows but is not active', () => {
        expect(ISSUE_STATES).toContain('on_hold');
        expect(ACTIVE_ISSUE_STATES).not.toContain('on_hold');
    });

    test('no role can create or re-enter on_hold', () => {
        expect(canChangeIssueState('admin', 'none', 'on_hold')).toBe(false);
        expect(canChangeIssueState('production_manager', 'none', 'on_hold')).toBe(false);
        // 'lab' is an external supplier since 20260905050000 and now moves
        // nothing, so it is asserted here as a plain refusal.
        expect(canChangeIssueState('lab', 'none', 'on_hold')).toBe(false);
    });

    test('authorized users can move a historical row out of on_hold', () => {
        expect(canChangeIssueState('admin', 'on_hold', 'none')).toBe(true);
        expect(canChangeIssueState('production_manager', 'on_hold', 'none')).toBe(true);
        // The release is production authority, which 'lab' no longer has.
        expect(canChangeIssueState('lab', 'on_hold', 'none')).toBe(false);
    });
});
