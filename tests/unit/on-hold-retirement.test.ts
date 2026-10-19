import { describe, expect, test } from 'vitest';

import { CASE_LOCATIONS, ISSUE_STATES, isIssueState } from '../../src/constants/workflow';

describe('removed on_hold workflow state', () => {
    test('is absent from every active workflow vocabulary', () => {
        expect(ISSUE_STATES as readonly string[]).not.toContain('on_hold');
        expect(CASE_LOCATIONS as readonly string[]).not.toContain('on_hold');
        expect(isIssueState('on_hold')).toBe(false);
    });
});
