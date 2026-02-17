import { format } from 'date-fns';

export function generateCaseId(doctorCode: string): string {
    const now = new Date();
    const dateStr = format(now, 'ddMM');
    const timeStr = format(now, 'HHmm');
    return `${doctorCode}-${dateStr}-${timeStr}`;
}
