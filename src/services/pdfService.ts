/* eslint-disable @typescript-eslint/no-explicit-any */
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import JSZip from 'jszip';
import type { Order, Doctor } from './db';
import type { StatementResult } from './statementService';
import { formatCurrency, type LabInfo } from '../utils/finance';

// ===================== HTML → PDF CORE =====================

async function htmlToPdfPage(doc: jsPDF, html: string, isFirstPage: boolean = true): Promise<void> {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:white;';
    container.innerHTML = html;
    document.body.appendChild(container);

    try {
        const canvas = await html2canvas(container, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: 794,
            windowWidth: 794,
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.75);
        const pdfWidth = 210;
        const pdfHeight = 297;
        const imgWidth = pdfWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        if (!isFirstPage) doc.addPage();

        if (imgHeight > pdfHeight) {
            const scale = pdfHeight / imgHeight;
            doc.addImage(imgData, 'JPEG', 0, 0, imgWidth * scale, imgHeight * scale);
        } else {
            doc.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
        }
    } finally {
        document.body.removeChild(container);
    }
}

function createPdf(): jsPDF {
    return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
}

// ===================== DESIGN SYSTEM =====================

const COLORS = {
    primary: '#0f766e',       // teal-700
    primaryLight: '#14b8a6',  // teal-500
    primaryBg: '#f0fdfa',     // teal-50
    dark: '#0f172a',          // slate-900
    darkMuted: '#334155',     // slate-700
    muted: '#64748b',         // slate-500
    light: '#94a3b8',         // slate-400
    border: '#e2e8f0',        // slate-200
    bgSoft: '#f8fafc',        // slate-50
    danger: '#dc2626',        // red-600
    dangerBg: '#fef2f2',      // red-50
    success: '#16a34a',       // green-600
    successBg: '#f0fdf4',     // green-50
    accentBg: '#eff6ff',      // blue-50
    accent: '#1e40af',        // blue-800
    white: '#ffffff',
};

const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }
    .doc {
        direction: rtl;
        font-family: 'Tahoma', 'Arial', 'Cairo', sans-serif;
        padding: 0;
        color: ${COLORS.dark};
        font-size: 12px;
        line-height: 1.5;
        background: white;
        letter-spacing: normal !important;
        font-variant-ligatures: normal !important;
        text-rendering: optimizeLegibility !important;
    }

    /* ===== HEADER BAND ===== */
    .header-band {
        background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%);
        padding: 24px 40px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: white;
    }

    .lab-brand {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
    }
    .lab-logo {
        height: 80px;
        width: auto;
        margin-bottom: 8px;
        filter: brightness(0) invert(1); /* Make white for dark background */
    }
    .lab-brand .lab-sub {
        font-size: 11px;
        opacity: 0.9;
        font-weight: 500;
    }
    .doc-badge {
        background: rgba(255,255,255,0.2);
        backdrop-filter: blur(4px);
        border: 1px solid rgba(255,255,255,0.3);
        padding: 8px 24px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 700;
    }

    /* ===== BODY ===== */
    .body { padding: 28px 40px 20px; }

    /* ===== META STRIP ===== */
    .meta-strip {
        display: flex;
        justify-content: space-between;
        margin-bottom: 24px;
        gap: 20px;
    }
    .meta-group { }
    .meta-label { font-size: 9px; color: ${COLORS.light}; text-transform: uppercase; margin-bottom: 2px; font-weight: 600; }
    .meta-value { font-size: 13px; font-weight: 700; color: ${COLORS.dark}; }
    .meta-value.large { font-size: 18px; }
    .meta-value.code { font-family: 'Courier New', monospace; direction: ltr; text-align: left; color: ${COLORS.muted}; font-size: 11px; }

    /* ===== DETAIL BOX ===== */
    .detail-box {
        background: ${COLORS.bgSoft};
        border: 1px solid ${COLORS.border};
        border-radius: 10px;
        padding: 14px 20px;
        display: flex;
        gap: 40px;
        margin-bottom: 24px;
    }
    .detail-item .d-label { font-size: 9px; color: ${COLORS.light}; font-weight: 600; text-transform: uppercase; }
    .detail-item .d-value { font-size: 13px; font-weight: 600; color: ${COLORS.darkMuted}; }

    /* ===== TABLE ===== */
    table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 20px; border-radius: 10px; overflow: hidden; border: 1px solid ${COLORS.border}; }
    thead th {
        background: ${COLORS.dark};
        color: white;
        padding: 12px 14px;
        font-size: 11px;
        font-weight: 700;
        text-align: center;
    }
    tbody td {
        padding: 11px 14px;
        border-bottom: 1px solid ${COLORS.border};
        text-align: center;
        font-size: 12px;
        color: ${COLORS.darkMuted};
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:nth-child(even) { background: ${COLORS.bgSoft}; }
    tbody td:first-child { text-align: right; font-weight: 600; color: ${COLORS.dark}; }

    /* ===== TOTALS ===== */
    .totals-section {
        display: flex;
        justify-content: flex-start;
        margin-top: 4px;
    }
    .totals-block {
        width: 280px;
        border: 1px solid ${COLORS.border};
        border-radius: 10px;
        overflow: hidden;
    }
    .total-row {
        display: flex;
        justify-content: space-between;
        padding: 10px 16px;
        font-size: 12px;
        border-bottom: 1px solid ${COLORS.border};
    }
    .total-row:last-child { border-bottom: none; }
    .total-row .t-label { color: ${COLORS.muted}; }
    .total-row .t-value { font-weight: 700; font-family: 'Courier New', monospace; direction: ltr; }
    .total-row.danger .t-value { color: ${COLORS.danger}; }
    .total-row.success .t-value { color: ${COLORS.success}; }
    .total-row.grand {
        background: ${COLORS.primary};
        color: white;
        padding: 14px 16px;
        font-size: 14px;
        border-bottom: none;
    }
    .total-row.grand .t-label { color: rgba(255,255,255,0.85); font-weight: 600; }
    .total-row.grand .t-value { color: white; font-size: 16px; }

    /* ===== SUMMARY CARDS ===== */
    .summary-cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 24px;
    }
    .s-card {
        border-radius: 10px;
        padding: 14px 16px;
        text-align: center;
        border: 1px solid ${COLORS.border};
    }
    .s-card.opening { background: ${COLORS.bgSoft}; }
    .s-card.debit { background: ${COLORS.dangerBg}; border-color: #fecaca; }
    .s-card.credit { background: ${COLORS.successBg}; border-color: #bbf7d0; }
    .s-card.balance { background: ${COLORS.accentBg}; border-color: #bfdbfe; }
    .s-card .sc-label { font-size: 9px; color: ${COLORS.muted}; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; }
    .s-card .sc-value { font-size: 16px; font-weight: 800; color: ${COLORS.dark}; font-family: 'Courier New', monospace; direction: ltr; }
    .s-card.debit .sc-value { color: ${COLORS.danger}; }
    .s-card.credit .sc-value { color: ${COLORS.success}; }
    .s-card.balance .sc-value { color: ${COLORS.accent}; }

    /* ===== FOOTER ===== */
    tfoot td {
        background: ${COLORS.bgSoft};
        padding: 12px 14px;
        font-weight: 700;
        border-top: 2px solid ${COLORS.border};
        font-size: 12px;
    }
    .balance-banner {
        background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%);
        border-radius: 10px;
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: white;
        margin-top: 12px;
    }
    .balance-banner .bb-label { font-size: 13px; font-weight: 600; opacity: 0.9; }
    .balance-banner .bb-value { font-size: 22px; font-weight: 800; font-family: 'Courier New', monospace; direction: ltr; }

    .doc-footer {
        margin-top: 28px;
        padding-top: 16px;
        border-top: 1px solid ${COLORS.border};
        text-align: center;
        font-size: 10px;
        color: ${COLORS.light};
    }

    /* ===== STAMP-LIKE BADGE ===== */
    .ref-tag {
        display: inline-block;
        background: ${COLORS.primaryBg};
        color: ${COLORS.primary};
        border: 1px solid ${COLORS.primaryLight};
        padding: 2px 10px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 700;
        font-family: 'Courier New', monospace;
        direction: ltr;
    }
`;

// ===================== DOCTOR INVOICE PDF =====================

export async function generateDoctorInvoicePDF(
    order: Order,
    doctor: Doctor | undefined,
    labInfo: LabInfo,
    previousBalance?: number
): Promise<void> {
    const html = buildInvoiceHTML(order, doctor, labInfo, previousBalance);
    const doc = createPdf();
    await htmlToPdfPage(doc, html);
    const doctorName = doctor?.name || 'doctor';
    doc.save(`invoice_${order.caseId}_${doctorName}.pdf`);
}

function buildInvoiceHTML(
    order: Order,
    doctor: Doctor | undefined,
    labInfo: LabInfo,
    previousBalance?: number
): string {
    const items = (order.items || []).map((item: any) => {
        const teethCount = Array.isArray(item.teethNumbers) && item.teethNumbers.length > 0 ? item.teethNumbers.length : 1;
        const teethDisplay = Array.isArray(item.teethNumbers) && item.teethNumbers.length > 0 ? item.teethNumbers.join(', ') : '-';

        // Fallback for various price field names from legacy data
        let unitPrice = Number(item.price || item.sellingPrice || item.unitPrice || 0);

        // Critical Fallback: If unit price is 0 but we have an order Total, and it's a single item (or we can assume),
        // we derive the unit price from the order Total.
        if (unitPrice === 0 && (order.items || []).length === 1 && order.totalPrice > 0) {
            unitPrice = order.totalPrice / teethCount;
        }

        const lineTotal = unitPrice * teethCount;

        return `<tr>
            <td>${item.serviceType || '-'}</td>
            <td style="direction:ltr">${teethDisplay}</td>
            <td>${teethCount}</td>
            <td style="font-family:'Courier New',monospace;direction:ltr">${formatCurrency(unitPrice)}</td>
            <td style="font-family:'Courier New',monospace;direction:ltr;font-weight:700">${formatCurrency(lineTotal)}</td>
        </tr>`;
    }).join('');

    const subtotal = order.totalPrice || 0;
    const discount = order.discount || 0;
    const grandTotal = subtotal - discount;
    const totalWithBalance = grandTotal + (previousBalance || 0);

    const discountRow = discount > 0 ? `
        <div class="total-row danger">
            <span class="t-label">الخصم</span>
            <span class="t-value">-${formatCurrency(discount)}</span>
        </div>` : '';

    const prevBalanceRow = (previousBalance !== undefined && previousBalance !== 0) ? `
        <div class="total-row ${previousBalance > 0 ? 'danger' : 'success'}">
            <span class="t-label">الرصيد السابق</span>
            <span class="t-value">${formatCurrency(previousBalance)}</span>
        </div>` : '';

    return `<div class="doc"><style>${styles}</style>
        <div class="header-band">
            <div class="lab-brand">
                <img src="${window.location.origin}/orca-logo.png" class="lab-logo" alt="ORCA" />
                <div class="lab-sub">${labInfo.address} · ${labInfo.phone}</div>
            </div>
            <div class="doc-badge">فاتورة</div>
        </div>

        <div class="body">
            <div class="meta-strip">
                <div class="meta-group">
                    <div class="meta-label">فاتورة إلى</div>
                    <div class="meta-value large">${doctor?.name || 'طبيب غير مسجل'}</div>
                    ${doctor?.address ? `<div style="font-size:11px;color:${COLORS.muted}">${doctor.address}</div>` : ''}
                    ${doctor?.phone ? `<div style="font-size:11px;color:${COLORS.muted};direction:ltr;text-align:right">${doctor.phone}</div>` : ''}
                </div>
                <div class="meta-group" style="text-align:left">
                    <div class="meta-label">رقم الفاتورة</div>
                    <div class="ref-tag">INV-${order.caseId}</div>
                    <div class="meta-label" style="margin-top:10px">التاريخ</div>
                    <div class="meta-value code">${new Date().toLocaleDateString('en-GB')}</div>
                </div>
            </div>

            <div class="detail-box">
                <div class="detail-item">
                    <div class="d-label">المريض</div>
                    <div class="d-value">${order.patientName}</div>
                </div>
                <div class="detail-item">
                    <div class="d-label">تاريخ التسليم</div>
                    <div class="d-value" style="direction:ltr;text-align:right">${order.deliveryDate || '-'}</div>
                </div>
                <div class="detail-item">
                    <div class="d-label">رقم الحالة</div>
                    <div class="d-value" style="font-family:'Courier New',monospace;direction:ltr;text-align:right">${order.caseId || '-'}</div>
                </div>
            </div>

            <table>
                <thead><tr>
                    <th style="text-align:right">الخدمة</th>
                    <th>الأسنان</th>
                    <th>العدد</th>
                    <th>سعر الوحدة</th>
                    <th>الإجمالي</th>
                </tr></thead>
                <tbody>${items || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">لا توجد خدمات</td></tr>'}</tbody>
            </table>

            <div class="totals-section">
                <div class="totals-block">
                    <div class="total-row">
                        <span class="t-label">إجمالي الفاتورة</span>
                        <span class="t-value">${formatCurrency(subtotal)}</span>
                    </div>
                    ${discountRow}
                    ${prevBalanceRow}
                    <div class="total-row grand">
                        <span class="t-label">الإجمالي المستحق</span>
                        <span class="t-value">${formatCurrency(totalWithBalance)} EGP</span>
                    </div>
                </div>
            </div>

            <div class="doc-footer">
                تم استخراج هذا المستند آلياً من نظام ORCA — يرجى المراجعة والإفادة خلال ٣ أيام عمل
            </div>
        </div>
    </div>`;
}

// ===================== DOCTOR STATEMENT PDF =====================

export async function generateDoctorStatementPDF(
    statement: StatementResult,
    dateRange: { start: string; end: string },
    labInfo: LabInfo
): Promise<void> {
    const html = buildStatementHTML(statement, dateRange, labInfo);
    const doc = createPdf();
    await htmlToPdfPage(doc, html);
    const safeName = (statement.doctorName || 'doctor').replace(/[\/\\?%*:|"<>]/g, '_');
    doc.save(`statement_${safeName}.pdf`);
}

function buildStatementHTML(
    statement: StatementResult,
    dateRange: { start: string; end: string },
    labInfo: LabInfo
): string {
    const startLabel = dateRange.start || '-';
    const endLabel = dateRange.end || '-';

    const rows = statement.items.length > 0
        ? statement.items.map(item => `
            <tr>
                <td>${item.description || '-'}</td>
                <td style="direction:ltr">${item.date ? new Date(item.date).toLocaleDateString('en-GB') : '-'}</td>
                <td style="font-family:'Courier New',monospace;direction:ltr;color:${COLORS.danger};font-weight:600">${item.type === 'debit' ? formatCurrency(item.amount) : '-'}</td>
                <td style="font-family:'Courier New',monospace;direction:ltr;color:${COLORS.success};font-weight:600">${item.type === 'credit' ? formatCurrency(item.amount) : '-'}</td>
            </tr>
        `).join('')
        : `<tr><td colspan="4" style="text-align:center;color:${COLORS.light};padding:28px">لا توجد حركات في هذه الفترة</td></tr>`;

    return `<div class="doc"><style>${styles}</style>
        <div class="header-band">
            <div class="lab-brand">
                <img src="${window.location.origin}/orca-logo.png" class="lab-logo" alt="ORCA" />
                <div class="lab-sub">${labInfo.address} · ${labInfo.phone}</div>
            </div>
            <div class="doc-badge">كشف حساب</div>
        </div>

        <div class="body">
            <div class="meta-strip">
                <div class="meta-group">
                    <div class="meta-label">الطبيب</div>
                    <div class="meta-value large">${statement.doctorName || '-'}</div>
                    ${statement.doctorCode ? `<span class="ref-tag">${statement.doctorCode}</span>` : ''}
                </div>
                <div class="meta-group" style="text-align:left">
                    <div class="meta-label">الفترة</div>
                    <div class="meta-value code">${startLabel}  →  ${endLabel}</div>
                    <div class="meta-label" style="margin-top:8px">تاريخ الاستخراج</div>
                    <div class="meta-value code">${new Date().toLocaleDateString('en-GB')}</div>
                </div>
            </div>

            <div class="summary-cards">
                <div class="s-card opening">
                    <div class="sc-label">الرصيد الافتتاحي</div>
                    <div class="sc-value">${formatCurrency(statement.totals.openingBalance)}</div>
                </div>
                <div class="s-card debit">
                    <div class="sc-label">إجمالي المدين</div>
                    <div class="sc-value">${formatCurrency(statement.totals.totalDebit)}</div>
                </div>
                <div class="s-card credit">
                    <div class="sc-label">إجمالي الدائن</div>
                    <div class="sc-value">${formatCurrency(statement.totals.totalCredit)}</div>
                </div>
                <div class="s-card balance">
                    <div class="sc-label">الرصيد الحالي</div>
                    <div class="sc-value">${formatCurrency(statement.totals.balance)}</div>
                </div>
            </div>

            <table>
                <thead><tr>
                    <th style="text-align:right">البيان</th>
                    <th>التاريخ</th>
                    <th>مدين</th>
                    <th>دائن</th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr>
                    <td style="text-align:right">الإجمالي</td>
                    <td></td>
                    <td style="font-family:'Courier New',monospace;direction:ltr;color:${COLORS.danger}">${formatCurrency(statement.totals.totalDebit)}</td>
                    <td style="font-family:'Courier New',monospace;direction:ltr;color:${COLORS.success}">${formatCurrency(statement.totals.totalCredit)}</td>
                </tr></tfoot>
            </table>

            <div class="balance-banner">
                <span class="bb-label">الرصيد النهائي</span>
                <span class="bb-value">${formatCurrency(statement.totals.balance)} EGP</span>
            </div>

            <div class="doc-footer">
                تم استخراج هذا المستند آلياً من نظام ORCA — يرجى المراجعة والإفادة خلال ٣ أيام عمل
            </div>
        </div>
    </div>`;
}

// ===================== BULK STATEMENTS PDF =====================

export async function generateBulkStatementsPDF(
    statements: StatementResult[],
    dateRange: { start: string; end: string },
    labInfo: LabInfo,
    format: 'merged' | 'zip' = 'merged'
): Promise<void> {
    if (statements.length === 0) return;

    if (format === 'zip') {
        await generateStatementsZip(statements, dateRange, labInfo);
    } else {
        await generateMergedStatementsPDF(statements, dateRange, labInfo);
    }
}

async function generateMergedStatementsPDF(
    statements: StatementResult[],
    dateRange: { start: string; end: string },
    labInfo: LabInfo
): Promise<void> {
    const doc = createPdf();

    for (let i = 0; i < statements.length; i++) {
        const html = buildStatementHTML(statements[i], dateRange, labInfo);
        await htmlToPdfPage(doc, html, i === 0);
    }

    const startLabel = dateRange.start || 'all';
    const endLabel = dateRange.end || 'now';
    doc.save(`bulk_statements_${startLabel}_${endLabel}.pdf`);
}

async function generateStatementsZip(
    statements: StatementResult[],
    dateRange: { start: string; end: string },
    labInfo: LabInfo
): Promise<void> {
    const zip = new JSZip();

    for (const statement of statements) {
        const html = buildStatementHTML(statement, dateRange, labInfo);
        const doc = createPdf();
        await htmlToPdfPage(doc, html);

        const pdfBlob = doc.output('arraybuffer');
        const safeName = (statement.doctorName || 'unknown').replace(/[\/\\?%*:|"<>]/g, '_');
        zip.file(`${safeName}.pdf`, pdfBlob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    const startLabel = dateRange.start || 'all';
    const endLabel = dateRange.end || 'now';
    link.download = `bulk_statements_${startLabel}_${endLabel}.zip`;
    link.click();
    URL.revokeObjectURL(url);
}

// ===================== ORDERS LIST PDF =====================

export async function generateOrdersListPDF(
    ordersData: { caseId: string; doctor: string; patient: string; status: string; price: number; date: string }[],
    labInfo: LabInfo
): Promise<void> {
    const rows = ordersData.map(o => `
        <tr>
            <td style="font-family:'Courier New',monospace;direction:ltr">${o.caseId}</td>
            <td>${o.doctor}</td>
            <td>${o.patient}</td>
            <td>${o.status}</td>
            <td style="font-family:'Courier New',monospace;direction:ltr;font-weight:700">${formatCurrency(o.price)}</td>
            <td style="direction:ltr">${o.date || '-'}</td>
        </tr>
    `).join('');

    const html = `<div class="doc"><style>${styles}</style>
        <div class="header-band">
            <div class="lab-brand">
                <img src="${window.location.origin}/orca-logo.png" class="lab-logo" alt="ORCA" />
                <div class="lab-sub">${labInfo.address} · ${labInfo.phone}</div>
            </div>
            <div class="doc-badge">قائمة الأوردرات</div>
        </div>

        <div class="body">
            <table>
                <thead><tr>
                    <th>رقم الحالة</th>
                    <th>الطبيب</th>
                    <th>المريض</th>
                    <th>الحالة</th>
                    <th>السعر</th>
                    <th>تاريخ التسليم</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>

            <div class="doc-footer">
                تم استخراج هذا المستند آلياً من نظام ORCA · ${new Date().toLocaleDateString('en-GB')}
            </div>
        </div>
    </div>`;

    const doc = createPdf();
    await htmlToPdfPage(doc, html);
    doc.save(`orders_list_${new Date().toISOString().split('T')[0]}.pdf`);
}

// ===================== GENERIC TABLE PDF =====================

export async function generateGenericTablePDF(
    title: string,
    columns: { header: string; key: string }[],
    data: Record<string, any>[],
    labInfo: LabInfo
): Promise<void> {
    const tableHeaders = columns.map(c => `<th>${c.header}</th>`).join('');

    const tableRows = data.map(row => {
        const cells = columns.map(col => {
            const val = row[col.key];
            const isNum = typeof val === 'number';
            const displayVal = val ?? '-';
            // Simple heuristic to detect if it might be an amount/number for styling
            const style = isNum ? `font-family:'Courier New',monospace;direction:ltr;font-weight:600` : '';
            return `<td style="${style}">${displayVal}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    const html = `<div class="doc"><style>${styles}</style>
        <div class="header-band">
            <div class="lab-brand">
                <img src="${window.location.origin}/orca-logo.png" class="lab-logo" alt="ORCA" />
                <div class="lab-sub">${labInfo.address} · ${labInfo.phone}</div>
            </div>
            <div class="doc-badge">${title}</div>
        </div>

        <div class="body">
            <div class="meta-strip">
                <div class="meta-group">
                    <div class="meta-label">تاريخ التقرير</div>
                    <div class="meta-value code">${new Date().toLocaleDateString('en-GB')}</div>
                </div>
                <div class="meta-group" style="text-align:left">
                    <div class="meta-label">عدد السجلات</div>
                    <div class="meta-value">${data.length}</div>
                </div>
            </div>

            <table>
                <thead><tr>${tableHeaders}</tr></thead>
                <tbody>${tableRows}</tbody>
            </table>

            <div class="doc-footer">
                تم استخراج هذا التقرير آلياً من نظام ORCA
            </div>
        </div>
    </div>`;

    const doc = createPdf();
    await htmlToPdfPage(doc, html);
    doc.save(`report_${new Date().toISOString().split('T')[0]}.pdf`);
}
