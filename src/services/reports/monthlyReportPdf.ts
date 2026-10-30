import { jsPDF } from 'jspdf';
import autoTable, { type UserOptions } from 'jspdf-autotable';
import type { LabInfo } from '../../utils/finance';
import { issueCauseLabel } from '../../constants/issueCauses';
import { comparisonChange, percentage, type MonthlyReportModel } from './monthlyReportModel';

export interface ReportFonts { regular: string; bold: string; logoData?: string }
let fontPromise: Promise<ReportFonts> | undefined;

async function assetFile(path: string): Promise<string> {
    const response = await fetch(`${import.meta.env.BASE_URL || '/'}${path}`);
    if (!response.ok) throw new Error(`Could not load report asset: ${path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return btoa(binary);
}

export function loadReportFonts(): Promise<ReportFonts> {
    if (!fontPromise) {
        fontPromise = Promise.all([assetFile('fonts/IBMPlexSansArabic-Regular.ttf'), assetFile('fonts/IBMPlexSansArabic-Bold.ttf'), assetFile('orca-logo.png')])
            .then(([regular, bold, logo]) => ({ regular, bold, logoData: `data:image/png;base64,${logo}` }))
            .catch(error => { fontPromise = undefined; throw error; });
    }
    return fontPromise;
}

export const reportNumber = (number: number, digits = 0): string => Number.isFinite(number)
    ? number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '-';
const pct = (value: number | null): string => value == null ? 'غير متاح' : `${reportNumber(value, 1)}%`;
const money = (value: number): string => reportNumber(value, 2);
const DARK = '#15283F';
const BLUE = '#176A9A';
const GREEN = '#18754D';
const RED = '#B33846';
const GRAY = '#627084';
const W = 182;
const RIGHT = 196;
const BOTTOM = 274;
const dateLabel = (value: string): string => new Date(`${value}T12:00:00Z`).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' });

/** Native text, embedded Arabic fonts and vector tables; no page screenshots. */
export function renderMonthlyReportPdf(model: MonthlyReportModel, lab: LabInfo, fonts: ReportFonts): jsPDF {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
    doc.addFileToVFS('IBMPlexSansArabic-Regular.ttf', fonts.regular);
    doc.addFileToVFS('IBMPlexSansArabic-Bold.ttf', fonts.bold);
    doc.addFont('IBMPlexSansArabic-Regular.ttf', 'ReportArabic', 'normal');
    doc.addFont('IBMPlexSansArabic-Bold.ttf', 'ReportArabic', 'bold');
    doc.setFont('ReportArabic', 'normal');
    doc.setR2L(false);
    doc.setProperties({ title: `التقرير الشهري - ${model.label}`, subject: 'الأداء المالي والتشغيلي؛ أرصدة معاد احتسابها حتى نهاية الفترة', author: lab.name, creator: 'ORCA Monthly Reports v2', keywords: 'monthly report, financial, ORCA' });
    const sections = new Map<number, string>();
    let y = 42;
    let sectionName = '';

    const font = (size: number, bold = false, color = DARK) => {
        doc.setFont('ReportArabic', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(color);
    };
    const text = (value: string, x: number, yy: number, size = 11, bold = false, color = DARK, align: 'right' | 'left' | 'center' = 'right') => {
        font(size, bold, color);
        doc.text(value, x, yy, { align });
    };
    const nextPage = () => { doc.addPage(); sections.set(doc.getNumberOfPages(), sectionName); y = 42; };
    const ensure = (height: number) => { if (y + height > BOTTOM) nextPage(); };
    const title = (value: string) => {
        ensure(36);
        text(value, RIGHT, y, 14, true);
        doc.setDrawColor('#CEE0EB');
        doc.setLineWidth(0.5);
        doc.line(14, y + 3, RIGHT, y + 3);
        y += 11;
    };
    const paragraph = (value: string, color = GRAY, size = 10) => {
        font(size, false, color);
        const lines = doc.splitTextToSize(value, W - 2) as string[];
        for (const line of lines) {
            ensure(6);
            text(line, RIGHT, y, size, false, color);
            y += 5.6;
        }
        y += 2;
    };
    const section = (value: string, first = false) => {
        sectionName = value;
        if (!first) nextPage();
        sections.set(doc.getNumberOfPages(), value);
        title(value);
    };
    const table = (head: string[], body: (string | number)[][], options: Partial<UserOptions> = {}) => {
        ensure(24);
        const startPage = doc.getNumberOfPages();
        autoTable(doc, {
            startY: y, margin: { top: 42, bottom: 24, left: 14, right: 14 }, tableWidth: W,
            head: [head], body: body.length ? body : [head.map((_, index) => index === head.length - 1 ? 'لا توجد بيانات في هذه الفترة' : '-')],
            theme: 'grid', rowPageBreak: 'avoid', showHead: 'everyPage', showFoot: 'lastPage',
            styles: { font: 'ReportArabic', fontStyle: 'normal', fontSize: 10, textColor: DARK, halign: 'right', valign: 'middle', cellPadding: 2, lineColor: '#DFE7EE', lineWidth: 0.15, overflow: 'linebreak' },
            headStyles: { fillColor: DARK, textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 10 },
            footStyles: { fillColor: '#EAF3F8', textColor: DARK, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: '#F6F9FB' },
            ...options
        });
        for (let page = startPage; page <= doc.getNumberOfPages(); page++) sections.set(page, sectionName);
        y = ((doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 8;
    };
    const { summary: s, details: d } = model;
    const financialOptions: Partial<UserOptions> = {
        styles: { font: 'ReportArabic', fontSize: 9.5, textColor: DARK, halign: 'right', valign: 'middle', cellPadding: { top: 0.8, bottom: 0.8, left: 2, right: 2 }, lineColor: '#DFE7EE', lineWidth: 0.15 },
        columnStyles: { 0: { cellWidth: 49, halign: 'center' } },
        pageBreak: 'avoid'
    };
    const gross = s.total_sales_value - s.total_cost_of_goods;
    const net = gross - s.operating_expenses;
    const cashNet = s.cash_total_income - s.cash_total_expenses;

    section('ملخص الشهر ومقارنته بالشهر السابق', true);
    if (model.previewNotice) paragraph(model.previewNotice, RED, 10);

    const cards = [
        { label: 'المبيعات المسجلة', value: money(s.total_sales_value), note: 'جنيه مصري', color: BLUE },
        { label: 'صافي الربح التشغيلي', value: money(net), note: `الهامش ${pct(percentage(net, s.total_sales_value))}`, color: net >= 0 ? GREEN : RED },
        { label: 'المصروفات التشغيلية', value: money(s.operating_expenses), note: 'جنيه مصري - أساس الاستحقاق', color: RED },
        { label: 'صافي التدفق النقدي', value: money(cashNet), note: 'جنيه مصري - حركة النقد الفعلية', color: cashNet >= 0 ? GREEN : RED },
        { label: 'الحالات المنتهية', value: reportNumber(d.closedCases), note: 'تسليم أو رفض أو إلغاء', color: BLUE },
        { label: 'الوحدات المنتجة', value: reportNumber(d.units), note: 'وفق نطاق الوحدات المحاسبي', color: BLUE },
        { label: 'ذمم نهاية الفترة', value: money(d.closing.total), note: `حتى ${dateLabel(d.closing.cutoff)}`, color: BLUE },
        { label: 'حالات منتهية سجلت مشاكل', value: `${d.issues.closedAffectedCases} / ${d.closedCases}`, note: `النسبة ${pct(d.issues.rate)}`, color: d.issues.closedAffectedCases > 0 ? RED : GREEN }
    ];
    const cardY = y;
    for (let index = 0; index < cards.length; index++) {
        const card = cards[index];
        const x = 14 + (3 - index % 4) * 46.5;
        const yy = cardY + Math.floor(index / 4) * 31;
        doc.setFillColor('#F5F8FA');
        doc.setDrawColor('#DFE7EE');
        doc.roundedRect(x, yy, 42.5, 27, 2, 2, 'FD');
        doc.setFillColor(card.color);
        doc.rect(x + 1, yy, 40.5, 0.8, 'F');
        text(card.label, x + 40, yy + 6.5, 10, true);
        text(card.value, x + 40, yy + 16, 17, true, card.color);
        text(card.note, x + 40, yy + 23, 8.2, false, GRAY);
    }
    y += 67;
    if (model.previous) {
        const p = model.previous;
        const previousNet = p.summary.total_sales_value - p.summary.total_cost_of_goods - p.summary.operating_expenses;
        paragraph(`المقارنة مع الشهر السابق: من ${dateLabel(p.period.start)} إلى ${dateLabel(p.period.end)}. التغير محسوب على القيمة المطلقة للشهر السابق.`);
        const comparisons = [
            ['المبيعات', s.total_sales_value, p.summary.total_sales_value],
            ['صافي الربح التشغيلي', net, previousNet],
            ['المصروفات التشغيلية', s.operating_expenses, p.summary.operating_expenses],
            ['الوحدات المنتجة', d.units, p.details.units],
            ['الحالات المنتهية ذات المشاكل', d.issues.closedAffectedCases, p.details.issues.closedAffectedCases]
        ] as [string, number, number][];
        table(['التغير %', 'الفرق', 'الشهر السابق', 'هذا الشهر', 'المؤشر'], comparisons.map(([label, current, previous], index) => {
            const change = comparisonChange(current, previous);
            const digits = index >= 3 ? 0 : 2;
            return [change == null ? 'لا أساس للمقارنة' : `${change > 0 ? '+' : ''}${reportNumber(change, 1)}%`, reportNumber(current - previous, digits), reportNumber(previous, digits), reportNumber(current, digits), label];
        }), {
            columnStyles: { 0: { cellWidth: 31, halign: 'center' }, 1: { cellWidth: 29, halign: 'center' }, 2: { cellWidth: 29, halign: 'center' }, 3: { cellWidth: 29, halign: 'center' }, 4: { cellWidth: 64 } },
            didParseCell: hook => {
                if (hook.section !== 'body' || hook.column.index !== 0) return;
                const [, current, previous] = comparisons[hook.row.index];
                if (current === previous || previous === 0) return;
                const lowerIsBetter = hook.row.index === 2 || hook.row.index === 4;
                hook.cell.styles.textColor = (current > previous) !== lowerIsBetter ? GREEN : RED;
            }
        });
    } else paragraph('المقارنة بالشهر السابق متاحة عند اختيار شهر ميلادي كامل.');

    title('قراءة سريعة للأداء');
    paragraph(`صافي نتيجة التشغيل ${net >= 0 ? 'ربح' : 'خسارة'} بقيمة ${money(Math.abs(net))} ج.م، وصافي حركة النقد ${money(cashNet)} ج.م. اختلافهما طبيعي لاختلاف أساس الاحتساب.`, net >= 0 ? DARK : RED);
    paragraph(`المصروفات التشغيلية تمثل ${pct(percentage(s.operating_expenses, s.total_sales_value))} من المبيعات. ${d.expenses[0] ? `أكبر بند هو ${d.expenses[0].category} بقيمة ${money(d.expenses[0].amount)} ج.م.` : 'لا توجد مصروفات تفصيلية مسجلة.'}`);
    paragraph(`التحصيلات النقدية للأطباء مقارنة بمبيعات الشهر: ${pct(percentage(s.cash_doctor_collections, s.total_sales_value))}. قد تشمل سداد أرصدة قديمة أو دفعات مقدمة؛ ليست نسبة سداد فواتير الشهر.`);

    section('التحليل المالي وأرصدة نهاية الفترة');
    title('قائمة الدخل - أساس الاستحقاق');
    table(['المبلغ - ج.م', 'البند'], [
        [money(s.total_sales_value), 'المبيعات المسجلة خلال الفترة'],
        [money(s.total_cost_of_goods_suppliers), 'تكلفة معامل الموردين'],
        [money(s.total_cost_of_goods_designers), 'تكلفة التصميم'],
        [money(s.total_cost_of_goods), 'إجمالي تكلفة الإنتاج'],
        [money(gross), `مجمل الربح - هامش ${pct(percentage(gross, s.total_sales_value))}`],
        [money(s.operating_expenses), 'المصروفات التشغيلية'],
        [money(net), `صافي الربح التشغيلي - هامش ${pct(percentage(net, s.total_sales_value))}`]
    ], financialOptions);
    title('التدفقات النقدية - بتاريخ حركة النقد');
    table(['المبلغ - ج.م', 'البند'], [
        [money(s.cash_doctor_collections), 'تحصيلات الأطباء'],
        [money(s.cash_total_income - s.cash_doctor_collections), 'مقبوضات أخرى'],
        [money(s.cash_total_income), 'إجمالي المقبوضات'],
        [money(s.cash_supplier_payments), 'مدفوعات الموردين'],
        [money(s.cash_designer_payments), 'مدفوعات المصممين'],
        [money(s.cash_other_expenses), 'مدفوعات تشغيلية وأخرى'],
        [money(s.cash_total_expenses), 'إجمالي المدفوعات'],
        [money(cashNet), 'صافي التدفق النقدي']
    ], financialOptions);
    title(`الأرصدة المعاد احتسابها حتى ${dateLabel(d.closing.cutoff)}`);
    table(['المبلغ - ج.م', 'البند'], [
        [money(d.closing.total), 'إجمالي مديونيات الأطباء الموجبة'],
        [money(d.closing.periodUnpaid), 'المتبقي من مبيعات الفترة - سداد الأقدم أولاً'],
        [money(d.closing.advances), 'دفعات مقدمة / أرصدة دائنة للأطباء'],
        ...d.closing.aging.map((amount, index) => [money(amount), ['أعمار الذمم: حتى 30 يوم', 'من 31 إلى 60 يوم', 'من 61 إلى 90 يوم', 'أكثر من 90 يوم'][index]])
    ], financialOptions);
    paragraph('تُستبعد التحصيلات والتسويات المؤرخة بعد نهاية الفترة. تسويات الحالات وقيمها تُقرأ من البيانات الحالية؛ هذه إعادة احتساب وليست نسخة إقفال مالي معتمدة ومحفوظة وقتها. يُوزع التحصيل على أقدم المديونيات أولاً، وتُجمع فروع الطبيب في حسابه الرئيسي.');

    section('العملاء وعائلات الخدمات');
    title('أعلى خمسة أطباء حسب الإيراد');
    table(['الإيراد - ج.م', 'الحالات', 'الطبيب', '#'], model.topDoctors.slice(0, 5).map((doctor, index) => [money(doctor.revenue), doctor.count, doctor.name, index + 1]), { columnStyles: { 0: { cellWidth: 38, halign: 'center' }, 1: { cellWidth: 21, halign: 'center' }, 3: { cellWidth: 10 } } });
    title(model.families.familyCount > 0 ? 'أكثر عائلات الخدمات طلباً' : 'الخدمات الأكثر طلباً - لم تُضبط عائلات الخدمات');
    table(['الإيراد - ج.م', 'الوحدات', 'العائلة / الخدمة', '#'], model.families.families.slice(0, 5).map((family, index) => [money(family.revenue), family.count, family.name, index + 1]), { columnStyles: { 0: { cellWidth: 38, halign: 'center' }, 1: { cellWidth: 21, halign: 'center' }, 3: { cellWidth: 10 } } });
    if (Math.abs(model.families.itemlessRevenue) >= 0.01) paragraph(`إيراد حالات بلا بنود خدمات ولا يمكن نسبته لعائلة: ${money(model.families.itemlessRevenue)} ج.م.`);
    title('أعلى خمس خدمات حسب عدد الوحدات');
    table(['الإيراد - ج.م', 'الوحدات', 'الخدمة', '#'], model.topServices.slice(0, 5).map((service, index) => [money(service.revenue), service.count, service.name, index + 1]), { columnStyles: { 0: { cellWidth: 38, halign: 'center' }, 1: { cellWidth: 21, halign: 'center' }, 3: { cellWidth: 10 } } });
    paragraph('الجداول أعلاه تعرض أعلى خمسة فقط. جدول الأداء التالي يعرض جميع الخدمات مع مطابقة الإجماليات.');

    section('أداء الخدمات - الإيراد والتكلفة والربحية');
    paragraph(`عدد الخدمات: ${d.serviceCount}. كل المبالغ بالجنيه المصري. توزيع إيراد وتكلفة الحالة على البنود وفق أسعارها النسبية.`);
    const serviceBody = d.services.map((row, index) => [pct(row.share), pct(row.margin), money(row.profit), money(row.cost), money(row.revenue), row.name, index + 1]);
    table(['المساهمة %', 'الهامش %', 'مجمل الربح', 'التكلفة', 'الإيراد', 'الخدمة', '#'], serviceBody, {
        styles: { font: 'ReportArabic', fontSize: 9.5, halign: 'right', valign: 'middle', cellPadding: 2, lineColor: '#DFE7EE', lineWidth: 0.15 },
        columnStyles: { 0: { cellWidth: 23, halign: 'center' }, 1: { cellWidth: 19, halign: 'center' }, 2: { cellWidth: 25, halign: 'center' }, 3: { cellWidth: 25, halign: 'center' }, 4: { cellWidth: 25, halign: 'center' }, 5: { cellWidth: 55 }, 6: { cellWidth: 10, halign: 'center' } },
        foot: [[s.total_sales_value > 0 ? '100%' : 'غير متاح', pct(percentage(gross, s.total_sales_value)), money(gross), money(s.total_cost_of_goods), money(s.total_sales_value), 'الإجمالي الكامل', '']],
        didParseCell: hook => {
            if (hook.section === 'body' && d.services[hook.row.index]?.isReconciliation) hook.cell.styles.fillColor = '#FFF1D8';
            const row = d.services[hook.row.index];
            if (hook.section === 'body' && hook.column.index === 2 && row) hook.cell.styles.textColor = row.profit >= 0 ? GREEN : RED;
        }
    });
    if (d.services.some(row => row.isReconciliation)) paragraph(`صف «غير موزع / فرق نطاق التسوية» يوضح المبالغ التي لم تصل إلى بنود الخدمات أو اختلاف نطاق التسوية مع الملخص: إيراد ${money(d.revenueDifference)} ج.م، وتكلفة ${money(d.costDifference)} ج.م. يلزم مراجعته قبل اعتماد التقرير.`, RED);

    section('أداء الخدمات - الوحدات والحالات والعملاء');
    table(['أعلى طبيب حسب إيراد الخدمة', 'الحالات', 'الوحدات', 'الخدمة', '#'], d.services.filter(row => !row.isReconciliation).map((row, index) => [row.topDoctor, row.cases, row.units, row.name, index + 1]), { columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' }, 3: { cellWidth: 70 }, 4: { cellWidth: 10 } } });
    paragraph(`عدد الحالات المنتهية المستقلة: ${d.closedCases}. هي الحالات التي انتهت بالتسليم أو الرفض أو الإلغاء، باستثناء الحالات الراجعة للتعديل. يُحدد شهرها بتاريخ القيد المعتمد في كشف الحساب.`);
    paragraph(`إجمالي الوحدات: ${d.units}. الحالة التي تحتوي أكثر من خدمة تظهر في كل خدمة؛ أعداد حالات الصفوف غير قابلة للجمع.`);
    paragraph(`حالات بمحددات سعر أو تكلفة يدوية: ${d.manualOrders}. متوسط إيراد الوحدة: ${d.units > 0 ? money(s.total_sales_value / d.units) : 'غير متاح'} ج.م.`);

    section('المصروفات التشغيلية ومشاكل الجودة');
    title('تفصيل المصروفات - بتاريخ الاستحقاق');
    table(['النسبة %', 'الحركات', 'المبلغ - ج.م', 'فئة المصروف'], d.expenses.map(row => [pct(percentage(row.amount, d.expenseTotal)), row.count, money(row.amount), row.category]), {
        columnStyles: { 0: { cellWidth: 25, halign: 'center' }, 1: { cellWidth: 22, halign: 'center' }, 2: { cellWidth: 38, halign: 'center' } },
        foot: [[d.expenseTotal > 0 ? '100%' : '-', d.expenseCount, money(d.expenseTotal), 'إجمالي التفاصيل']]
    });
    if (Math.abs(d.expenseDifference) >= 0.01) paragraph(`فرق بين مصروفات الملخص والتفاصيل: ${money(d.expenseDifference)} ج.م. يعرض الملخص ${money(s.operating_expenses)} ج.م؛ لا تُخفى فروق نطاق السجل أو الاستحقاق.`, RED);
    title('المشاكل - أحداث مسجلة وحالات مستقلة');
    paragraph(`سجل الشهر يحتوي ${d.issues.events} حدث مشكلة تخص ${d.issues.affectedCases} حالة مستقلة، منها ${d.issues.closedAffectedCases} حالة منتهية محسوبة في هذا الشهر. النسبة من الحالات المنتهية: ${pct(d.issues.rate)}.`);
    paragraph(`حالات منتهية سجلت رفض طبيب أو إعادة خلال الشهر: ${d.issues.rejectionCases} حالة دون تكرار، بنسبة ${pct(d.issues.rejectionRate)}. تاريخ المشاكل هو تاريخ تسجيل الحدث بتوقيت القاهرة، وتُستبعد الأحداث الملغاة والحالات المحذوفة.`);
    const issueLabels: Record<string, string> = { returned: 'إرجاع للتعديل', doctor_rejected: 'رفض الطبيب', rejected: 'رفض الطبيب', lab_rejected: 'رفض المعمل', cancelled: 'إلغاء', redo: 'إعادة تصنيع' };
    table(['عدد الأحداث', 'نوع المشكلة'], d.issues.byType.map(([type, count]) => [count, issueLabels[type] || 'نوع غير محدد']), { columnStyles: { 0: { cellWidth: 35, halign: 'center' } } });
    title('أسباب المشاكل المسجلة');
    table(['عدد الأحداث', 'السبب'], d.issues.byCause.sort((a, b) => b[1] - a[1]).map(([cause, count]) => [count, issueCauseLabel(cause)]), { columnStyles: { 0: { cellWidth: 35, halign: 'center' } } });
    paragraph('الحالة قد تحمل عدة أحداث أو أسباب؛ مجموع أحداث الأنواع لا يمثل عدد حالات مستقلة. النسب غير المتاحة تُعرض صراحة عند غياب مقام صالح.');

    // Stamp after layout so every page, including automatic table continuations, has a header and X/Y.
    const pages = doc.getNumberOfPages();
    const timestamp = new Date(model.generatedAt).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', hour12: false });
    for (let page = 1; page <= pages; page++) {
        doc.setPage(page);
        doc.setFillColor('#FFFFFF');
        doc.rect(0, 0, 210, 34, 'F');
        text('التقرير الشهري للأداء المالي والتشغيلي', RIGHT, 12, 16, true, DARK);
        text(model.label, RIGHT, 20, 11, true, BLUE);
        if (fonts.logoData) doc.addImage(fonts.logoData, 'PNG', 14, 7, 15, 15, 'orca-lab-logo');
        const brandX = fonts.logoData ? 32 : 14;
        text(lab.name, brandX, 12, 11, true, DARK, 'left');
        text(lab.phone, brandX, 20, 9, false, GRAY, 'left');
        text(sections.get(page) || '', RIGHT, 29, 9, false, GRAY);
        doc.setDrawColor(BLUE);
        doc.setLineWidth(0.6);
        doc.line(14, 33, RIGHT, 33);
        doc.setFillColor('#FFFFFF');
        doc.rect(0, 278, 210, 19, 'F');
        doc.setDrawColor('#CEE0EB');
        doc.setLineWidth(0.2);
        doc.line(14, 280, RIGHT, 280);
        text(`صفحة ${page} من ${pages}`, RIGHT, 286, 9, false, GRAY);
        text(`ORCA | ${timestamp} | Africa/Cairo`, 14, 286, 8, false, GRAY, 'left');
        text('أرصدة معاد احتسابها وفق السجل الحالي - لا تمثل إقفالاً معتمداً', RIGHT, 292, 8, false, GRAY);
    }
    return doc;
}
