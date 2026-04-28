import type { Order } from '../services/db';

const DESIGN_HISTORY_STATUSES = ['New Case', 'Under Design', 'Waiting Dr Approval', 'Under Production'] as const;
const DESIGN_COMPLETION_STATUSES = ['Waiting Dr Approval', 'Under Production'] as const;
const DESIGN_COMMENT_MARKERS = [
    'تم إضافة/تحديث رابط التصميم',
    'تم رفع التصميم',
    'تم تسليم التصميم',
    'رابط التصميم',
];
const SAME_DAY_SUBMISSION_FALLBACK_MS = 60 * 60 * 1000;

function toTimestamp(value?: string | null): number | null {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
}

function isSameLocalDay(firstTimestamp: number, secondTimestamp: number): boolean {
    const firstDate = new Date(firstTimestamp);
    const secondDate = new Date(secondTimestamp);

    return firstDate.getFullYear() === secondDate.getFullYear()
        && firstDate.getMonth() === secondDate.getMonth()
        && firstDate.getDate() === secondDate.getDate();
}

function findFirstHistoryTimestamp(order: Order, statuses: readonly string[]): number | null {
    if (!order.statusHistory || order.statusHistory.length === 0) return null;

    const matches = order.statusHistory
        .filter(entry => statuses.includes(entry.status))
        .map(entry => toTimestamp(entry.enteredAt))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);

    return matches[0] ?? null;
}

export function getDesignerAssignedAt(order: Order): string | null {
    const historyTimestamp = findFirstHistoryTimestamp(order, DESIGN_HISTORY_STATUSES);
    if (historyTimestamp !== null) {
        return new Date(historyTimestamp).toISOString();
    }

    return order.createdAt || null;
}

export function getDesignSubmittedAt(order: Order): string | null {
    if (!order.designUrl) return null;

    const commentTimestamp = [...(order.comments || [])]
        .reverse()
        .find(comment => DESIGN_COMMENT_MARKERS.some(marker => comment.text.includes(marker)));

    if (commentTimestamp?.createdAt) {
        return commentTimestamp.createdAt;
    }

    const historyTimestamp = findFirstHistoryTimestamp(order, DESIGN_COMPLETION_STATUSES);
    if (historyTimestamp !== null) {
        return new Date(historyTimestamp).toISOString();
    }

    return null;
}

export function isDesignSubmitted(order: Order): boolean {
    return Boolean(order.designUrl || getDesignSubmittedAt(order));
}

export function getDesignerWorkDurationMs(order: Order, nowMs: number = Date.now()): number | null {
    const startedAt = toTimestamp(getDesignerAssignedAt(order));
    if (startedAt === null) return null;

    const submittedAt = toTimestamp(getDesignSubmittedAt(order));
    if (submittedAt !== null && isSameLocalDay(submittedAt, nowMs)) {
        return SAME_DAY_SUBMISSION_FALLBACK_MS;
    }

    const endTimestamp = submittedAt ?? nowMs;

    return Math.max(0, endTimestamp - startedAt);
}

export function formatDesignerDuration(ms: number): string {
    const totalMinutes = Math.max(0, Math.floor(ms / (1000 * 60)));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    const parts: string[] = [];

    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ');
}
