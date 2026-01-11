import { format } from 'date-fns';

export function generateCaseId(doctorCode: string, existingOrders: Array<{ caseId: string }> = []): string {
    const dateStr = format(new Date(), 'ddMMyy');
    // Format: DRCODE-DDMMYY-SEQ

    // Filter by doctor code date prefix to sequence properly per doctor/day
    const relevantOrders = (existingOrders || []).filter(o => o.caseId && o.caseId.startsWith(`${doctorCode}-${dateStr}`));
    const sequence = (relevantOrders.length + 1).toString().padStart(3, '0');

    return `${doctorCode}-${dateStr}-${sequence}`;
}
