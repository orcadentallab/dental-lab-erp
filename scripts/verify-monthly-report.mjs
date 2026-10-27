import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run against a local Vite server. Uses synthetic fixtures and makes no database requests.
const baseUrl = process.env.REPORT_PREVIEW_URL || 'http://127.0.0.1:5178';
await mkdir('tmp/pdfs', { recursive: true });
await mkdir('output/pdf', { recursive: true });
await writeFile('tmp/pdfs/preview.html', '<!doctype html><html><body>Monthly report rendering QA</body></html>');
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseUrl}/tmp/pdfs/preview.html`);
    for (const [count, file] of [[18, 'output/pdf/monthly-report-preview.pdf'], [64, 'tmp/pdfs/monthly-report-long-tables.pdf']]) {
        const result = await page.evaluate(async count => {
            const { monthlyReportFixture } = await import('/tests/fixtures/monthly-report.ts');
            const { loadReportFonts, renderMonthlyReportPdf } = await import('/src/services/reports/monthlyReportPdf.ts');
            const { DEFAULT_LAB_INFO } = await import('/src/utils/finance.ts');
            const doc = renderMonthlyReportPdf(monthlyReportFixture(count), DEFAULT_LAB_INFO, await loadReportFonts());
            return { bytes: Array.from(new Uint8Array(doc.output('arraybuffer'))), pages: doc.getNumberOfPages() };
        }, count);
        await writeFile(file, Buffer.from(result.bytes));
        console.log(JSON.stringify({ path: path.resolve(file), services: count, pages: result.pages, bytes: result.bytes.length }));
    }
    const emptyPages = await page.evaluate(async () => {
        const { monthlyReportFixture } = await import('/tests/fixtures/monthly-report.ts');
        const { loadReportFonts, renderMonthlyReportPdf } = await import('/src/services/reports/monthlyReportPdf.ts');
        const { DEFAULT_LAB_INFO } = await import('/src/utils/finance.ts');
        const doc = renderMonthlyReportPdf(monthlyReportFixture(0), DEFAULT_LAB_INFO, await loadReportFonts());
        if (!doc.output('arraybuffer').byteLength) throw new Error('Empty report did not render');
        return doc.getNumberOfPages();
    });
    console.log(JSON.stringify({ emptyMonthRendered: true, pages: emptyPages }));
    if (errors.length) throw new Error(errors.join('\n'));
} finally {
    await browser.close();
}
