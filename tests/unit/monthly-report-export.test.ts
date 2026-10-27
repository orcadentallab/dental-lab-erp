import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { generateBulkMonthlyComprehensiveReports } from '../../src/services/comprehensiveReportService';
import { analyticsService } from '../../src/services/supabase/analyticsService';
import { db } from '../../src/services/db';
import { renderMonthlyReportPdf } from '../../src/services/reports/monthlyReportPdf';
import { fetchMonthlyReportAdjustments, fetchMonthlyReportIssues } from '../../src/services/supabase/monthlyReportData';
import { emptyReportSummary } from '../fixtures/monthly-report';

vi.mock('../../src/services/db', () => ({
    db: {
        getAllOrdersUnpaginated: vi.fn().mockResolvedValue([]),
        getTransactions: vi.fn().mockResolvedValue([]),
        getDoctors: vi.fn().mockResolvedValue([]),
        getSuppliers: vi.fn().mockResolvedValue([]),
        getServices: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('../../src/services/supabase/analyticsService', () => ({
    analyticsService: {
        getSummary: vi.fn().mockResolvedValue({}),
        getTopDoctors: vi.fn().mockResolvedValue([]),
        getTopServices: vi.fn().mockResolvedValue([]),
        getTopExpenseCategories: vi.fn().mockResolvedValue([]),
        getIssuesSummary: vi.fn().mockResolvedValue({}),
        getTopFamilies: vi.fn().mockResolvedValue({ families: [] })
    }
}));

vi.mock('../../src/services/reports/monthlyReportPdf', () => ({
    loadReportFonts: vi.fn().mockResolvedValue({ regular: '', bold: '' }),
    renderMonthlyReportPdf: vi.fn().mockImplementation(() => ({ output: () => new TextEncoder().encode('%PDF-test').buffer }))
}));
vi.mock('../../src/services/supabase/monthlyReportData', () => ({
    fetchMonthlyReportAdjustments: vi.fn().mockResolvedValue([]),
    fetchMonthlyReportIssues: vi.fn().mockResolvedValue([])
}));

describe('monthly report archive', () => {
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    let archive: Blob;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(analyticsService.getSummary).mockResolvedValue(emptyReportSummary());
        vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
        vi.stubGlobal('document', {
            createElement: () => link,
            body: { appendChild: vi.fn(), removeChild: vi.fn() }
        });
        vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
            archive = blob as Blob;
            return 'blob:test';
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('downloads 15 separate PDFs covering every complete month from July 2025 through September 2026', async () => {
        const onProgress = vi.fn();
        await generateBulkMonthlyComprehensiveReports({ onProgress });

        const zip = await JSZip.loadAsync(await archive.arrayBuffer());
        const files = Object.keys(zip.files);
        expect(files).toHaveLength(15);
        expect(files[0]).toContain('2025_07');
        expect(files[14]).toContain('2026_09');
        expect(files.every(name => name.endsWith('.pdf'))).toBe(true);
        expect(link.download).toContain('2025_07_إلى_2026_09.zip');
        expect(link.click).toHaveBeenCalledTimes(1);
        expect(renderMonthlyReportPdf).toHaveBeenCalledTimes(15);
        expect(db.getAllOrdersUnpaginated).toHaveBeenCalledTimes(1);
        expect(fetchMonthlyReportAdjustments).toHaveBeenCalledTimes(1);
        expect(fetchMonthlyReportIssues).toHaveBeenCalledTimes(1);
        expect(analyticsService.getSummary).toHaveBeenCalledTimes(16);

        for (let index = 0; index < 15; index++) {
            const monthDate = new Date(Date.UTC(2025, 6 + index, 1));
            const endDate = new Date(Date.UTC(2025, 7 + index, 0));
            expect(analyticsService.getSummary).toHaveBeenCalledWith(
                monthDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)
            );
        }
        expect(onProgress).toHaveBeenCalledWith(15, 15, 'سبتمبر 2026');
        expect(onProgress).toHaveBeenLastCalledWith(15, 15, 'ضغط التقارير وتجهيز التنزيل...');
    });

    it('does not download an incomplete archive if one monthly report fails', async () => {
        vi.mocked(renderMonthlyReportPdf).mockImplementationOnce(() => { throw new Error('render failed'); });
        await expect(generateBulkMonthlyComprehensiveReports()).rejects.toThrow('render failed');
        expect(link.click).not.toHaveBeenCalled();
    });
});
