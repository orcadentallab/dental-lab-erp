import { useId, type ReactNode } from 'react';
import clsx from 'clsx';

interface ResponsiveTableProps {
    children: ReactNode;
    label: string;
    className?: string;
}

export function ResponsiveTable({ children, label, className }: ResponsiveTableProps) {
    const hintId = useId();

    return (
        <div className="min-w-0 max-w-full">
            <p id={hintId} className="px-3 pb-2 text-[11px] text-surface-500 sm:hidden">
                مرّر أفقياً لعرض باقي الأعمدة
            </p>
            <div
                role="region"
                aria-label={label}
                aria-describedby={hintId}
                tabIndex={0}
                className={clsx(
                    'max-w-full overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 focus-visible:ring-inset',
                    className
                )}
            >
                {children}
            </div>
        </div>
    );
}
