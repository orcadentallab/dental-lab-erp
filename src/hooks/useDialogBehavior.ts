import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])', '[href]', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogBehavior(isOpen: boolean, onClose: () => void) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);

    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const mainContent = document.getElementById('dashboard-main');
        const previousMainOverflow = mainContent?.style.overflow;
        const previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        if (mainContent) mainContent.style.overflow = 'hidden';

        const focusTimer = window.setTimeout(() => {
            const focusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
            (focusable || dialogRef.current)?.focus();
        }, 0);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
            if (focusable.length === 0) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.clearTimeout(focusTimer);
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousBodyOverflow;
            if (mainContent) mainContent.style.overflow = previousMainOverflow || '';
            previouslyFocused?.focus();
        };
    }, [isOpen]);

    return dialogRef;
}
