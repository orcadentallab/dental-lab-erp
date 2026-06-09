/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import clsx from 'clsx';


export type FilterType = 'day' | 'week' | 'month' | 'year' | 'all';

interface DateFilterProps {
    activeFilter: FilterType;
    onFilterChange: (filter: FilterType) => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({ activeFilter, onFilterChange }) => {
    const filters: { id: FilterType; label: string }[] = [
        { id: 'day', label: 'يوم' },
        { id: 'week', label: 'أسبوع' },
        { id: 'month', label: 'شهر' },
        { id: 'year', label: 'سنة' },
        { id: 'all', label: 'الكل' },
    ];

    return (
        <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-lg w-fit">
            {filters.map(f => (
                <button
                    key={f.id}
                    onClick={() => onFilterChange(f.id)}
                    className={clsx(
                        "px-3 py-1 text-xs font-bold rounded-md transition-all",
                        activeFilter === f.id
                            ? "bg-white text-blue-600 shadow-sm ring-1 ring-gray-200"
                            : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                    )}
                >
                    {f.label}
                </button>
            ))}
        </div>
    );
};

export function filterEntries<T extends { date: string }>(entries: T[], filter: FilterType): T[] {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // Calculate start of week (Saturday as start of week in Egypt/Middle East?)
    // Or Sunday? Standard ISO is Monday. Let's stick to standard 7 days ago for "Week" or simple "Current Week"? 
    // Usually "Week" means "Last 7 Days" or "Current Week". 
    // "Month" means "Current Month".
    // Let's implement "Current X".

    return entries.filter(entry => {
        const entryDate = new Date(entry.date);
        const entryTime = entryDate.getTime();

        switch (filter) {
            case 'day': {
                const entryStartOfDay = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate()).getTime();
                return entryStartOfDay === startOfDay;
            }
            case 'week': {
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                return entryTime >= weekAgo.getTime();
            }
            case 'month':
                return entryDate.getMonth() === now.getMonth() && entryDate.getFullYear() === now.getFullYear();
            case 'year':
                return entryDate.getFullYear() === now.getFullYear();
            case 'all':
            default:
                return true;
        }
    });
}

export function calculateTotal(entries: { amount: number }[]): number {
    return entries.reduce((sum, entry) => sum + entry.amount, 0);
}
