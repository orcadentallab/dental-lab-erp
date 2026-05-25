import type { ProductionStatus } from '../../constants/workflow';
import { PRODUCTION_STATUS_LABELS_AR } from '../../constants/workflow';

const STATUS_COLORS: Record<ProductionStatus, string> = {
    not_started: 'bg-gray-100 text-gray-700 border-gray-200',
    designing: 'bg-purple-100 text-purple-700 border-purple-200',
    in_production: 'bg-blue-100 text-blue-700 border-blue-200',
    try_in_ready: 'bg-amber-100 text-amber-700 border-amber-200',
    waiting_doctor: 'bg-orange-100 text-orange-700 border-orange-200',
    finalization: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    final_ready: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    final_delivered: 'bg-green-100 text-green-800 border-green-300',
};

interface Props {
    status: ProductionStatus;
    size?: 'sm' | 'md';
}

export default function ProductionStatusBadge({ status, size = 'sm' }: Props) {
    const colors = STATUS_COLORS[status] || STATUS_COLORS.not_started;
    const sizeClass = size === 'sm'
        ? 'text-[10px] px-1.5 py-0.5'
        : 'text-xs px-2 py-1';

    return (
        <span className={`inline-flex items-center rounded-full border font-bold ${colors} ${sizeClass}`}>
            {PRODUCTION_STATUS_LABELS_AR[status]}
        </span>
    );
}
