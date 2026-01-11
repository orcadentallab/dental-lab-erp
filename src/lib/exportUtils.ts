import * as XLSX from 'xlsx';

/**
 * Export data to Excel file (.xlsx)
 * @param data Array of objects to export
 * @param filename Name of the file (without extension)
 * @param sheetName Name of the sheet in Excel
 */
export function exportToExcel<T extends Record<string, any>>(
    data: T[],
    filename: string,
    sheetName: string = 'Sheet1'
): void {
    if (!data || data.length === 0) {
        alert('لا توجد بيانات للتصدير');
        return;
    }

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Auto-size columns
    const maxWidth = 50;
    const colWidths: { wch: number }[] = [];

    // Get headers
    const headers = Object.keys(data[0]);
    headers.forEach((header, i) => {
        // Calculate max width for each column
        let maxLen = header.length;
        data.forEach(row => {
            const cellValue = String(row[header] || '');
            maxLen = Math.max(maxLen, cellValue.length);
        });
        colWidths[i] = { wch: Math.min(maxLen + 2, maxWidth) };
    });

    worksheet['!cols'] = colWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    // Generate and download file
    XLSX.writeFile(workbook, `${filename}.xlsx`);
}

/**
 * Export data with Arabic column headers
 * @param data Array of objects with original keys
 * @param columnMap Mapping of original keys to Arabic headers
 * @param filename Name of the file
 */
export function exportToExcelWithHeaders<T extends Record<string, any>>(
    data: T[],
    columnMap: Record<keyof T, string>,
    filename: string
): void {
    if (!data || data.length === 0) {
        alert('لا توجد بيانات للتصدير');
        return;
    }

    // Transform data to use Arabic headers
    const transformedData = data.map(row => {
        const newRow: Record<string, any> = {};
        Object.keys(columnMap).forEach(key => {
            const arabicKey = columnMap[key as keyof T];
            newRow[arabicKey] = row[key as keyof T];
        });
        return newRow;
    });

    exportToExcel(transformedData, filename, 'البيانات');
}

/**
 * Print specific content on the page
 * Opens print dialog with only the specified content
 * @param elementId ID of the element to print (optional, prints whole page if not specified)
 * @param title Title to show in print header
 */
export function printContent(elementId?: string, title?: string): void {
    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) {
        alert('يرجى السماح بالنوافذ المنبثقة للطباعة');
        return;
    }

    let content: string;
    if (elementId) {
        const element = document.getElementById(elementId);
        if (!element) {
            alert('لم يتم العثور على المحتوى المطلوب');
            printWindow.close();
            return;
        }
        content = element.innerHTML;
    } else {
        content = document.body.innerHTML;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>${title || 'طباعة'}</title>
            <style>
                * {
                    box-sizing: border-box;
                    font-family: 'Segoe UI', Tahoma, sans-serif;
                }
                body {
                    padding: 20px;
                    direction: rtl;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 10px;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: right;
                }
                th {
                    background-color: #f5f5f5;
                    font-weight: bold;
                }
                h1, h2, h3 {
                    color: #333;
                }
                .print-header {
                    text-align: center;
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 2px solid #333;
                }
                .logo {
                    max-width: 60px;
                    margin-bottom: 10px;
                }
                .no-print {
                    display: none !important;
                }
                @media print {
                    button, .no-print {
                        display: none !important;
                    }
                }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h2>ORCA Dental Lab</h2>
                ${title ? `<h3>${title}</h3>` : ''}
                <p style="color: #666; font-size: 12px;">${new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            ${content}
        </body>
        </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    // Wait for content to load then print
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
}

/**
 * Quick print for a table element
 * @param tableData Array of objects representing table rows
 * @param columns Column definitions with key and Arabic label
 * @param title Report title
 */
export function printTable<T extends Record<string, any>>(
    tableData: T[],
    columns: { key: keyof T; label: string }[],
    title: string
): void {
    const printWindow = window.open('', '', 'width=900,height=700');
    if (!printWindow) {
        alert('يرجى السماح بالنوافذ المنبثقة للطباعة');
        return;
    }

    const tableHeaders = columns.map(col => `<th>${col.label}</th>`).join('');
    const tableRows = tableData.map(row => {
        const cells = columns.map(col => `<td>${row[col.key] ?? '-'}</td>`).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <style>
                * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, sans-serif; }
                body { padding: 20px; direction: rtl; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #333; padding: 10px 8px; text-align: right; font-size: 12px; }
                th { background-color: #f0f0f0; font-weight: bold; }
                tr:nth-child(even) { background-color: #fafafa; }
                h1 { text-align: center; color: #333; margin-bottom: 5px; }
                .subtitle { text-align: center; color: #666; margin-bottom: 20px; font-size: 14px; }
                .footer { text-align: center; margin-top: 30px; color: #999; font-size: 11px; }
            </style>
        </head>
        <body>
            <h1>ORCA Dental Lab</h1>
            <div class="subtitle">${title} - ${new Date().toLocaleDateString('ar-EG')}</div>
            <table>
                <thead><tr>${tableHeaders}</tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
            <div class="footer">عدد السجلات: ${tableData.length}</div>
        </body>
        </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
}
