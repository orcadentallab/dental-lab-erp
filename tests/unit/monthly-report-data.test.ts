import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMonthlyReportAdjustments, fetchMonthlyReportIssues } from '../../src/services/supabase/monthlyReportData';

const { mockQuery, pages, state } = vi.hoisted(() => {
    const pages: Record<string, { data: unknown[]; error: Error | null }[]> = {};
    const state = { table: '', offset: 0 };
    const mockQuery = {
        select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(),
        then: (resolve: (result: unknown) => unknown) => Promise.resolve(pages[state.table][state.offset / 1000]).then(resolve)
    };
    return { mockQuery, pages, state };
});
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: (table: string) => { state.table = table; return mockQuery; } } }));

beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.select.mockReturnValue(mockQuery);
    mockQuery.eq.mockReturnValue(mockQuery);
    mockQuery.order.mockReturnValue(mockQuery);
    mockQuery.range.mockImplementation((offset: number) => { state.offset = offset; return mockQuery; });
});

describe('complete monthly reporting datasets', () => {
    it('fetches adjustments and issue events beyond the 1000-row API limit with a stable secondary sort', async () => {
        const adjustment = { id: 'a1', entity_type: 'doctor', entity_id: 'd1', type: 'charge', amount: 1, date: '2026-08-01' };
        pages.adjustments = [{ data: Array.from({ length: 1000 }, (_, index) => ({ ...adjustment, id: `a${index}` })), error: null }, { data: [{ ...adjustment, id: 'last' }], error: null }];
        expect(await fetchMonthlyReportAdjustments()).toHaveLength(1001);
        const issue = { id: 'i1', order_id: 'o1', issue_type: 'redo', cause_category: 'fit', created_at: '2026-08-31T21:30:00Z', is_voided: false };
        pages.order_issues = [{ data: Array(1000).fill(issue), error: null }, { data: [{ ...issue, id: 'last' }], error: null }];
        const issues = await fetchMonthlyReportIssues();
        expect(issues).toHaveLength(1001);
        expect(issues[1000]).toMatchObject({ id: 'last', date: '2026-09-01', orderId: 'o1' });
        expect(mockQuery.order).toHaveBeenCalledWith('id');
        expect(mockQuery.range).toHaveBeenCalledWith(1000, 1999);
    });

    it('fails instead of returning partial financial data if a later page cannot be fetched', async () => {
        pages.adjustments = [{ data: Array(1000).fill({}), error: null }, { data: [], error: new Error('database failed') }];
        await expect(fetchMonthlyReportAdjustments()).rejects.toThrow('database failed');
    });
});
