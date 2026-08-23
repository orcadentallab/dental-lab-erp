/**
 * "+ جديد" -- starting a task, as opposed to going somewhere.
 *
 * Navigation and task initiation were the same system before: to create an
 * order you first navigated to Orders, to record a payment you first
 * entered Finance. This menu holds verbs only, never ordinary
 * destinations, and only the ones the user is allowed to perform.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCapabilities } from '../lib/userRoles';
import { QUICK_ACTIONS, type QuickAction } from '../lib/navigation';

export default function QuickActions() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const caps = getCapabilities(user);
    const actions = QUICK_ACTIONS.filter(action => caps.has(action.capability));

    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target;
            if (target instanceof Node && containerRef.current?.contains(target)) return;
            setIsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen]);

    if (actions.length === 0) return null;

    const groups = actions.reduce<Record<string, QuickAction[]>>((accumulator, action) => {
        (accumulator[action.groupAr] ||= []).push(action);
        return accumulator;
    }, {});

    return (
        <div ref={containerRef} className="relative print:hidden" dir="rtl">
            <button
                type="button"
                onClick={() => setIsOpen(open => !open)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-cyan-600 px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-cyan-700"
            >
                <Plus size={16} />
                <span className="hidden sm:inline">جديد</span>
            </button>

            {isOpen && (
                <div
                    role="menu"
                    className="absolute left-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl"
                >
                    {Object.entries(groups).map(([group, groupActions]) => (
                        <div key={group} className="border-t border-slate-100 py-1 first:border-t-0">
                            <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
                            {groupActions.map(action => (
                                <button
                                    key={action.id}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setIsOpen(false); navigate(action.path); }}
                                    className="flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-right text-[13px] font-medium text-slate-700 transition-colors hover:bg-cyan-50 hover:text-cyan-800"
                                >
                                    {action.labelAr}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
