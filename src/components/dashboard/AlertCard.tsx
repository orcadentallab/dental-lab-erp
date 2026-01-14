import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

interface AlertCardProps {
    title: string;
    count: number;
    icon: LucideIcon;
    colorClass: 'red' | 'yellow' | 'blue' | 'green' | 'purple';
    children?: ReactNode;
    onAction?: () => void;
    actionLabel?: string;
    expandable?: boolean;
    onExpand?: () => void;
    useModal?: boolean;
}

const colorClasses = {
    red: {
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-200 dark:border-red-800',
        text: 'text-red-800 dark:text-red-300',
        icon: 'text-red-600 dark:text-red-400',
        badge: 'bg-red-600 text-white',
        button: 'bg-red-600 hover:bg-red-700 text-white'
    },
    yellow: {
        bg: 'bg-yellow-50 dark:bg-yellow-900/20',
        border: 'border-yellow-200 dark:border-yellow-800',
        text: 'text-yellow-800 dark:text-yellow-300',
        icon: 'text-yellow-600 dark:text-yellow-400',
        badge: 'bg-yellow-600 text-white',
        button: 'bg-yellow-600 hover:bg-yellow-700 text-white'
    },
    blue: {
        bg: 'bg-blue-50 dark:bg-blue-900/20',
        border: 'border-blue-200 dark:border-blue-800',
        text: 'text-blue-800 dark:text-blue-300',
        icon: 'text-blue-600 dark:text-blue-400',
        badge: 'bg-blue-600 text-white',
        button: 'bg-blue-600 hover:bg-blue-700 text-white'
    },
    green: {
        bg: 'bg-green-50 dark:bg-green-900/20',
        border: 'border-green-200 dark:border-green-800',
        text: 'text-green-800 dark:text-green-300',
        icon: 'text-green-600 dark:text-green-400',
        badge: 'bg-green-600 text-white',
        button: 'bg-green-600 hover:bg-green-700 text-white'
    },
    purple: {
        bg: 'bg-purple-50 dark:bg-purple-900/20',
        border: 'border-purple-200 dark:border-purple-800',
        text: 'text-purple-800 dark:text-purple-300',
        icon: 'text-purple-600 dark:text-purple-400',
        badge: 'bg-purple-600 text-white',
        button: 'bg-purple-600 hover:bg-purple-700 text-white'
    }
};

export default function AlertCard({
    title,
    count,
    icon: Icon,
    colorClass,
    children,
    onAction,
    actionLabel,
    expandable = true,
    onExpand,
    useModal = false
}: AlertCardProps) {
    const colors = colorClasses[colorClass];
    const [isExpanded, setIsExpanded] = useState(false);

    if (count === 0 && !children) return null;

    // Card is clickable if: (1) using modal with onExpand, OR (2) has children for inline expansion
    const isClickable = expandable && (useModal ? onExpand : children);

    const handleClick = () => {
        if (!isClickable) return;

        if (useModal && onExpand) {
            onExpand();
        } else if (children) {
            setIsExpanded(!isExpanded);
        }
    };

    return (
        <div className={`${colors.bg} ${colors.border} border rounded-xl shadow-sm`}>
            <div
                className={`flex items-center justify-between p-4 ${isClickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                onClick={handleClick}
            >
                <div className="flex items-center gap-2">
                    <Icon className={`${colors.icon} w-5 h-5`} />
                    <h3 className={`${colors.text} font-bold text-sm`}>{title}</h3>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`${colors.badge} px-2.5 py-1 rounded-full text-xs font-bold`}>
                        {count}
                    </span>
                    {isClickable && !useModal && (
                        isExpanded ?
                            <ChevronUp className={`${colors.icon} w-4 h-4`} /> :
                            <ChevronDown className={`${colors.icon} w-4 h-4`} />
                    )}
                    {isClickable && useModal && (
                        <ExternalLink className={`${colors.icon} w-4 h-4`} />
                    )}
                </div>
            </div>

            {children && isExpanded && !useModal && (
                <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700 pt-3">
                    {children}
                </div>
            )}

            {onAction && actionLabel && (
                <div className="px-4 pb-4">
                    <button
                        onClick={onAction}
                        className={`w-full ${colors.button} px-4 py-2 rounded-lg text-sm font-medium transition-colors`}
                    >
                        {actionLabel}
                    </button>
                </div>
            )}
        </div>
    );
}
