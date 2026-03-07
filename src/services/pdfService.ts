/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
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

    // Capture footer separately if it exists
    const footerEl = container.querySelector('.doc-footer');
    let footerImg: string | null = null;
    let footerHeightMm = 0;

    if (footerEl) {
        // Extract footer to its own container to capture it as an image
        const footerContainer = document.createElement('div');
        footerContainer.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;';
        footerContainer.appendChild(footerEl.cloneNode(true));
        document.body.appendChild(footerContainer);

        const fCanvas = await html2canvas(footerContainer, { scale: 2, useCORS: true });
        footerImg = fCanvas.toDataURL('image/jpeg', 0.8);
        footerHeightMm = (fCanvas.height * 210) / fCanvas.width;

        document.body.removeChild(footerContainer);
        // Hide original footer from main capture to avoid duplicates
        (footerEl as HTMLElement).style.display = 'none';
    }

    try {
        const canvas = await html2canvas(container, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: 794,
            windowWidth: 794,
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.8);
        const pdfWidth = 210;
        const pdfHeight = 297;
        const imgWidth = pdfWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        if (!isFirstPage) doc.addPage();

        if (imgHeight <= (pdfHeight - footerHeightMm)) {
            doc.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
            if (footerImg) {
                doc.addImage(footerImg, 'JPEG', 0, pdfHeight - footerHeightMm, pdfWidth, footerHeightMm);
            }
        } else {
            // SMART ROW-AWARE SLICING
            const MARGIN_TOP = 8;
            const MARGIN_BOTTOM = 5;
            const FOOT_H = footerHeightMm;

            const breakableElements = Array.from(container.querySelectorAll('tr, .s-card, .balance-banner, .doc-notice, .detail-box, .meta-strip, .totals-section'));
            const containerBox = container.getBoundingClientRect();

            let currentYPx = 0;
            let pageNum = 1;

            while (currentYPx < canvas.height) {
                if (pageNum > 1) doc.addPage();

                const mTopMm = pageNum === 1 ? 0 : MARGIN_TOP;
                const mBottomMm = MARGIN_BOTTOM;
                const availHMm = pdfHeight - FOOT_H - mTopMm - mBottomMm;
                const availHPx = (availHMm / imgWidth) * canvas.width;

                // Find optimal break point
                let sliceHPx = Math.min(availHPx, canvas.height - currentYPx);

                if (currentYPx + availHPx < canvas.height) {
                    let bestBreakPx = 0;
                    for (const el of breakableElements) {
                        const elBox = el.getBoundingClientRect();
                        const elTopPx = (elBox.top - containerBox.top) * 2;
                        const elBottomPx = (elBox.bottom - containerBox.top) * 2;

                        if (elBottomPx <= currentYPx + availHPx) {
                            bestBreakPx = elBottomPx;
                        } else if (elTopPx > currentYPx + availHPx) {
                            break;
                        }
                    }
                    if (bestBreakPx > currentYPx) {
                        sliceHPx = bestBreakPx - currentYPx;
                    }
                }

                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = sliceHPx;
                const ctx = sliceCanvas.getContext('2d')!;
                ctx.drawImage(canvas, 0, currentYPx, canvas.width, sliceHPx, 0, 0, canvas.width, sliceHPx);

                const sliceImgH = (sliceHPx * imgWidth) / canvas.width;
                doc.addImage(sliceCanvas.toDataURL('image/jpeg', 0.8), 'JPEG', 0, mTopMm, imgWidth, sliceImgH);
                if (footerImg) doc.addImage(footerImg, 'JPEG', 0, pdfHeight - FOOT_H, pdfWidth, FOOT_H);

                currentYPx += sliceHPx;
                pageNum++;
                if (currentYPx >= canvas.height - 5) break;
            }
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
    primary: '#1e3a8a',       // Deep Royal Blue (Orca)
    primaryLight: '#3b82f6',  // Blue-500
    primaryBg: '#eff6ff',     // Blue-50
    dark: '#0f172a',          // Slate-900
    darkMuted: '#334155',     // Slate-700
    muted: '#64748b',         // Slate-500
    light: '#94a3b8',         // Slate-400
    border: '#e2e8f0',        // Slate-200
    bgSoft: '#f8fafc',        // Slate-50
    danger: '#ef4444',        // Red-500
    dangerBg: '#fef2f2',      // Red-50
    success: '#10b981',       // Emerald-500
    successBg: '#ecfdf5',     // Emerald-50
    accentBg: '#e0f2fe',      // Sky-100
    accent: '#0ea5e9',        // Sky-500 (Precision Blue)
    white: '#ffffff',
};

const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }
    .doc {
        direction: rtl;
        font-family: 'Cairo', 'Tahoma', 'Arial', sans-serif;
        padding: 0;
        color: ${COLORS.dark};
        font-size: 11px;
        line-height: 1.5;
        background: white;
        position: relative;
        letter-spacing: normal !important;
        font-variant-ligatures: normal !important;
        text-rendering: optimizeLegibility !important;
    }

    /* ===== SPLIT HEADER (Premium) ===== */
    .header-split {
        display: flex;
        height: 180px;
        position: relative;
        overflow: visible;
        border-bottom: 4px solid ${COLORS.accent};
    }
    .header-half {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 0 40px;
    }
    .header-white {
        background: white;
        align-items: center; /* Centered Horizontally */
        justify-content: center; /* Centered Vertically */
    }
    .header-blue {
        background: ${COLORS.primary};
        color: white;
        align-items: flex-end;
        text-align: right;
    }
    .header-logo {
        height: 120px; /* Larger Logo */
        width: auto;
        display: block;
    }
    .header-info-line {
        font-size: 15px;
        font-weight: 800;
        margin-bottom: 2px;
        letter-spacing: 0.5px;
    }
    .header-slogan {
        font-size: 11px;
        font-weight: 500;
        margin-top: 6px;
        opacity: 0.9;
        font-style: italic;
    }

    .doc-badge-centered {
        position: absolute;
        left: 50%;
        bottom: -20px;
        transform: translateX(-50%);
        background: ${COLORS.accent};
        color: white;
        padding: 10px 36px;
        border-radius: 4px;
        font-size: 18px;
        font-weight: 800;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 100;
        white-space: nowrap;
        border: 2px solid white;
    }

    /* ===== BODY ===== */
    .body { padding: 48px 40px 60px; }

    /* ===== META STRIP ===== */
    .meta-strip {
        display: flex;
        justify-content: space-between;
        margin-bottom: 24px;
        gap: 20px;
        border-bottom: 1px dashed ${COLORS.border};
        padding-bottom: 20px;
    }
    .meta-group { }
    .meta-label { font-size: 9px; color: ${COLORS.light}; margin-bottom: 4px; font-weight: 700; }
    .meta-value { font-size: 13px; font-weight: 700; color: ${COLORS.dark}; }
    .meta-value.large { font-size: 18px; color: ${COLORS.primary}; }
    .meta-value.code { font-family: 'Courier New', monospace; direction: ltr; text-align: left; color: ${COLORS.muted}; font-size: 11px; }

    /* ===== DETAIL BOX ===== */
    .detail-box {
        background: ${COLORS.bgSoft};
        border-right: 4px solid ${COLORS.accent};
        border-radius: 4px;
        padding: 14px 20px;
        display: flex;
        gap: 40px;
        margin-bottom: 24px;
    }
    .detail-item .d-label { font-size: 9px; color: ${COLORS.muted}; font-weight: 600; }
    .detail-item .d-value { font-size: 13px; font-weight: 700; color: ${COLORS.darkMuted}; }

    /* ===== TABLES & CARDS (Break Avoidance) ===== */
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    .summary-cards { page-break-inside: avoid; break-inside: avoid; }
    .s-card { page-break-inside: avoid; break-inside: avoid; }
    thead th {
        background: ${COLORS.primary};
        color: white;
        padding: 10px 12px;
        font-size: 10px;
        font-weight: 700;
        text-align: center;
        border-bottom: 2px solid ${COLORS.primaryLight};
    }
    thead th:first-child { border-top-right-radius: 6px; }
    thead th:last-child { border-top-left-radius: 6px; }
    
    tbody td {
        padding: 10px 12px;
        border-bottom: 1px solid ${COLORS.border};
        text-align: center;
        font-size: 11px;
        color: ${COLORS.darkMuted};
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:nth-child(even) { background: ${COLORS.bgSoft}; }
    tbody td:first-child { text-align: right; font-weight: 600; color: ${COLORS.dark}; }

    /* ===== TOTALS ===== */
    .totals-section {
        display: flex;
        justify-content: flex-end; /* Align right (Arabic LTR needs thinking, but flex-end in RTL is left) -> flex-end puts it on left in RTL? No, flex-start is right. flex-end is left. */
        margin-top: 12px;
    }
    /* Wait, in RTL: flex-start = Right, flex-end = Left. We want totals on the left/end. */
    
    .totals-block {
        width: 260px;
        background: ${COLORS.bgSoft};
        border: 1px solid ${COLORS.border};
        border-radius: 8px;
        overflow: hidden;
    }
    .total-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 14px;
        font-size: 11px;
        border-bottom: 1px solid ${COLORS.border};
    }
    .total-row:last-child { border-bottom: none; }
    .total-row .t-label { color: ${COLORS.muted}; font-weight: 600; }
    .total-row .t-value { font-weight: 700; font-family: 'Courier New', monospace; direction: ltr; }
    .total-row.danger .t-value { color: ${COLORS.danger}; }
    .total-row.success .t-value { color: ${COLORS.success}; }
    .total-row.grand {
        background: ${COLORS.primary};
        color: white;
        padding: 12px 14px;
        font-size: 13px;
        border-bottom: none;
    }
    .total-row.grand .t-label { color: rgba(255,255,255,0.9); }
    .total-row.grand .t-value { color: white; font-size: 15px; }

    /* ===== SUMMARY CARDS (Statement) ===== */
    .summary-cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 24px;
    }
    .s-card {
        border-radius: 8px;
        padding: 12px;
        text-align: center;
        border: 1px solid ${COLORS.border};
        background: white;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .s-card.opening { border-top: 3px solid ${COLORS.muted}; }
    .s-card.debit { border-top: 3px solid ${COLORS.danger}; background: ${COLORS.dangerBg}; }
    .s-card.credit { border-top: 3px solid ${COLORS.success}; background: ${COLORS.successBg}; }
    .s-card.balance { border-top: 3px solid ${COLORS.primary}; background: ${COLORS.primaryBg}; }
    
    .s-card .sc-label { font-size: 9px; color: ${COLORS.muted}; font-weight: 700; margin-bottom: 4px; }
    .s-card .sc-value { font-size: 15px; font-weight: 800; color: ${COLORS.dark}; font-family: 'Courier New', monospace; direction: ltr; }
    .s-card.debit .sc-value { color: ${COLORS.danger}; }
    .s-card.credit .sc-value { color: ${COLORS.success}; }
    .s-card.balance .sc-value { color: ${COLORS.primary}; }

    /* ===== FOOTER ===== */
    tfoot td {
        background: ${COLORS.bgSoft};
        padding: 10px 12px;
        font-weight: 700;
        border-top: 2px solid ${COLORS.border};
        font-size: 11px;
    }
    .balance-banner {
        background: ${COLORS.primary};
        border-radius: 8px;
        padding: 12px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: white;
        margin-top: 12px;
        box-shadow: 0 4px 6px -1px rgba(30, 58, 138, 0.2);
    }
    .balance-banner .bb-label { font-size: 12px; font-weight: 600; opacity: 0.9; }
    .balance-banner .bb-value { font-size: 20px; font-weight: 800; font-family: 'Courier New', monospace; direction: ltr; }

    /* ===== FOOTER BAR (Premium) ===== */
    .doc-footer {
        background: ${COLORS.accent};
        padding: 12px 40px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: white;
        font-size: 10px;
        position: relative;
        width: 794px;
    }
    .footer-slogan {
        font-weight: 800;
        font-size: 13px;
        text-align: left; /* Pull to the left in RTL */
    }
    .footer-social {
        display: flex;
        align-items: center;
        gap: 8px; /* Gap between icons and username */
        font-weight: 700;
        font-size: 11px;
    }
    .social-item {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .social-icons {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .doc-notice {
        margin-top: 40px;
        padding-top: 12px;
        border-top: 1px solid ${COLORS.border};
        text-align: center;
        font-size: 10px;
        color: ${COLORS.muted};
        opacity: 0.7;
    }

    /* ===== STAMP-LIKE BADGE ===== */
    .ref-tag {
        display: inline-block;
        background: ${COLORS.bgSoft};
        color: ${COLORS.darkMuted};
        border: 1px solid ${COLORS.border};
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-family: 'Courier New', monospace;
        direction: ltr;
        font-weight: 600;
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
    _labInfo: LabInfo,
    previousBalance?: number
): string {
    const items = (order.items || []).map((item: { serviceType?: string; teethNumbers?: string[]; price?: number; sellingPrice?: number; unitPrice?: number }) => {
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
        <div class="header-split">
            <div class="header-half header-white">
                <img src="${window.location.origin}/orca-logo.png" class="header-logo" alt="ORCA" />
            </div>
            <div class="header-half header-blue">
                <div class="header-info-line">ORCA DENTAL LAB</div>
                <div class="header-info-line">01034141917</div>
                <div class="header-info-line">CAIRO</div>
                <div class="header-slogan">.A dentist's touch behind every detail</div>
            </div>
            <div class="doc-badge-centered">فاتورة</div>
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

            <div class="doc-notice">
                تم استخراج هذا المستند آلياً من نظام ORCA — يرجى المراجعة والإفادة خلال ٣ أيام عمل
            </div>

            <div class="doc-footer">
                <div class="footer-social">
                    <div class="social-item">
                        <div class="social-icons">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 2.04c-5.5 0-10 4.5-10 10 0 5 3.66 9.15 8.44 9.9v-7h-2.54v-2.9h2.54V9.82c0-2.5 1.49-3.89 3.77-3.89 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.86h2.78l-.45 2.9h-2.33v7c4.78-.75 8.44-4.9 8.44-9.9 0-5.5-4.5-10-10-10z"/></svg>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                        </div>
                        <span style="direction:ltr;margin-left:4px">orca.labeg</span>
                    </div>
                </div>
                <div class="footer-slogan">A dentist's touch behind every detail.</div>
            </div>
        </div>
    </div>`;
}

// ===================== DOCTOR STATEMENT PDF =====================

export async function generateDoctorStatementPDF(
    statement: StatementResult,
    dateRange: { start: string; end: string },
    labInfo: LabInfo,
    options: { print?: boolean } = {}
): Promise<void> {
    const html = buildStatementHTML(statement, dateRange, labInfo);
    const doc = createPdf();
    await htmlToPdfPage(doc, html);

    if (options.print) {
        doc.autoPrint();
        window.open(doc.output('bloburl'), '_blank');
    } else {
        const safeName = (statement.doctorName || 'doctor').replace(/[/\\?%*:|"<>]/g, '_');
        doc.save(`statement_${safeName}.pdf`);
    }
}

function buildStatementHTML(
    statement: StatementResult,
    dateRange: { start: string; end: string },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _labInfo?: LabInfo
): string {
    const startLabel = dateRange.start || '-';
    const endLabel = dateRange.end || '-';

    const rows = statement.items.length > 0
        ? statement.items.map(item => `
            <tr>
                <td>${item.description || '-'}</td>
                <td style="font-size:10px;color:${COLORS.darkMuted}">${item.services || '-'}</td>
                <td>${item.count ? `(${item.count})` : '-'}</td>
                <td style="direction:ltr">${item.date ? new Date(item.date).toLocaleDateString('en-GB') : '-'}</td>
                <td style="font-family:'Courier New',monospace;direction:ltr;color:${COLORS.danger};font-weight:600">${item.type === 'debit' ? formatCurrency(item.amount) : '-'}</td>
                <td style="font-family:'Courier New',monospace;direction:ltr;color:${COLORS.success};font-weight:600">${item.type === 'credit' ? formatCurrency(item.amount) : '-'}</td>
            </tr>
        `).join('')
        : `<tr><td colspan="6" style="text-align:center;color:${COLORS.light};padding:28px">لا توجد حركات في هذه الفترة</td></tr>`;

    return `<div class="doc"><style>${styles}</style>
        <div class="header-split">
            <div class="header-half header-white">
                <img src="${window.location.origin}/orca-logo.png" class="header-logo" alt="ORCA" />
            </div>
            <div class="header-half header-blue">
                <div class="header-info-line">ORCA DENTAL LAB</div>
                <div class="header-info-line">01034141917</div>
                <div class="header-info-line">CAIRO</div>
                <div class="header-slogan">.A dentist's touch behind every detail</div>
            </div>
            <div class="doc-badge-centered">كشف حساب</div>
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
                    <th>الخدمات</th>
                    <th>العدد</th>
                    <th>التاريخ</th>
                    <th>مدين</th>
                    <th>دائن</th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr>
                    <td style="text-align:right">الإجمالي</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td style="font-family:'Courier New',monospace;direction:ltr;color:${COLORS.danger}">${formatCurrency(statement.totals.totalDebit)}</td>
                    <td style="font-family:'Courier New',monospace;direction:ltr;color:${COLORS.success}">${formatCurrency(statement.totals.totalCredit)}</td>
                </tr></tfoot>
            </table>

            <div class="balance-banner">
                <span class="bb-label">الرصيد النهائي</span>
                <span class="bb-value">${formatCurrency(statement.totals.balance)} EGP</span>
            </div>

            <div class="doc-notice">
                تم استخراج هذا المستند آلياً من نظام ORCA — يرجى المراجعة والإفادة خلال ٣ أيام عمل
            </div>

            <div class="doc-footer">
                <div class="footer-social">
                    <div class="social-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="white" style="margin-left:4px"><path d="M12 2.04c-5.5 0-10 4.5-10 10 0 5 3.66 9.15 8.44 9.9v-7h-2.54v-2.9h2.54V9.82c0-2.5 1.49-3.89 3.77-3.89 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.86h2.78l-.45 2.9h-2.33v7c4.78-.75 8.44-4.9 8.44-9.9 0-5.5-4.5-10-10-10z"/></svg>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                        <span style="direction:ltr">orca.labeg</span>
                    </div>
                </div>
                <div class="footer-slogan">A dentist's touch behind every detail.</div>
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
        const safeName = (statement.doctorName || 'unknown').replace(/[/\\?%*:|"<>]/g, '_');
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
