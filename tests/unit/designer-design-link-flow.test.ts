import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const dashboardSource = readFileSync(resolve('src/pages/DesignerDashboard.tsx'), 'utf8');
const ordersSource = readFileSync(resolve('src/services/supabase/orders.ts'), 'utf8');

function between(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
}

describe('designer design-link flow', () => {
    test('approving a new case advances it to design automatically', () => {
        const approval = between(dashboardSource, 'const handleTechAction', 'useEffect(() => {');
        expect(approval).toContain("action === 'Approved'");
        expect(approval).toContain("order.status === 'New Case'");
        expect(approval).toContain("updateOrderStatus(orderId, 'Under Design'");
    });

    test('submitting a design link does not manufacture an order comment', () => {
        const submission = between(dashboardSource, 'const submitDesign = async', 'const handleAddComment');
        const helper = between(ordersSource, 'export async function submitDesignForApproval', 'export async function getDoctorTotalCost');

        expect(submission).not.toContain('comment');
        expect(helper).not.toContain('comment:');
    });

    test('designer view exposes an explicit copy action without opening the link', () => {
        expect(dashboardSource).toContain('navigator.clipboard.writeText');
        expect(dashboardSource).toContain('aria-label="نسخ أحدث رابط تصميم"');
    });
});
