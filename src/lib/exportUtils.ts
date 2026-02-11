/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import * as XLSX from 'xlsx';

/**
 * Export data to Excel file (.xlsx)
 * @param data Array of objects to export
 * @param filename Name of the file (without extension)
 * @param sheetName Name of the sheet in Excel
 */
export function exportToExcel<T extends Record<string, unknown>>(
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
export function exportToExcelWithHeaders<T extends Record<string, unknown>>(
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


