import type { ProductionStatus } from './workflow';

/** UI preview only; the audited database RPC applies this rule under row lock. */
export function productionStatusAfterDeliveryTypeChange(
    status: ProductionStatus,
    previousType: string | null | undefined,
    targetType: 'Final' | 'TryIn',
): ProductionStatus {
    if (previousType === targetType) return status;
    if (targetType === 'Final' && ['try_in_ready', 'waiting_doctor', 'finalization'].includes(status)) {
        return 'in_production';
    }
    if (targetType === 'TryIn' && status === 'final_ready') return 'try_in_ready';
    return status;
}
