import { format } from 'date-fns';

const CASE_SEQUENCE_OFFSET = 500;

export function getCaseIdYearRange(date = new Date()): { startDate: string; endDate: string } {
    const year = date.getFullYear();
    return {
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
    };
}

export function getDisplayCaseSequence(yearlySequence: number): number {
    return CASE_SEQUENCE_OFFSET + Math.max(1, yearlySequence);
}

export function generateCaseId(entityCode: string, yearlySequence: number, date = new Date()): string {
    const dateStr = format(date, 'yyMMdd');
    return `${entityCode}-${dateStr}-${getDisplayCaseSequence(yearlySequence)}`;
}
