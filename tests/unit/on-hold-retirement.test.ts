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
        expect(canChangeIssueState('lab', 'none', 'on_hold')).toBe(false);
    });

    test('authorized users can move a historical row out of on_hold', () => {
        expect(canChangeIssueState('admin', 'on_hold', 'none')).toBe(true);
        expect(canChangeIssueState('lab', 'on_hold', 'none')).toBe(true);
    });
});
