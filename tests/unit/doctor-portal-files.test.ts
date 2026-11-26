import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
import { validateCaseFile } from '../../src/lib/storage';
describe('doctor case file limits', () => {
    it('accepts browser scans with missing MIME and rejects scans over 50 MB', () => {
        expect(() => validateCaseFile({ name: 'upper.stl', type: '', size: 50 * 1024 * 1024 } as File)).not.toThrow();
        expect(() => validateCaseFile({ name: 'lower.ply', type: '', size: 50 * 1024 * 1024 + 1 } as File)).toThrow('50 ميجا');
    });
    it('keeps the existing 10 MB photo limit', () => {
        expect(() => validateCaseFile({ name: 'shade.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 } as File)).toThrow('10 ميجا');
    });
    it('rejects executable or HTML attachments', () => {
        expect(() => validateCaseFile({ name: 'page.html', type: 'text/html', size: 20 } as File)).toThrow();
    });
});
