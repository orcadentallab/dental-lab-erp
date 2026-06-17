import type { IssueState } from '../../constants/workflow';
import { ISSUE_STATE_LABELS_AR } from '../../constants/workflow';

const ISSUE_COLORS: Record<IssueState, string> = {
    none: '',
    returned: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    doctor_rejected: 'bg-red-100 text-red-800 border-red-300',
    lab_rejected: 'bg-rose-100 text-rose-800 border-rose-300',
    cancelled: 'bg-gray-200 text-gray-700 border-gray-300',
    on_hold: 'bg-orange-100 text-orange-800 border-orange-300',
    redo: 'bg-purple-100 text-purple-800 border-purple-300',
};

interface Props {
    state: IssueState;
    size?: 'sm' | 'md';
}

export default function IssueStateBadge({ state, size = 'sm' }: Props) {
    if (state === 'none') return null;

    const colors = ISSUE_COLORS[state] || '';
    const sizeClass = size === 'sm'
        ? 'text-[10px] px-1.5 py-0.5'
        : 'text-xs px-2 py-1';

    return (
        <span className={`inline-flex items-center rounded-full border font-bold ${colors} ${sizeClass}`}>
            {ISSUE_STATE_LABELS_AR[state]}
        </span>
    );
}
