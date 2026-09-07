import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Popover plumbing shared by DateField and DateRangeField.
 *
 * These live outside the component files so both controls open their calendar
 * with identical positioning and dismissal behaviour — and so neither component
 * file exports something that is not a component.
 */

/**
 * Anchors a fixed-position popover to an element, flipping above it when there
 * is not enough room below. Fixed positioning (with a portal) is what keeps the
 * calendar from being clipped by the filter bars it opens inside.
 */
export function useAnchoredPopover(open: boolean, anchorRef: React.RefObject<HTMLElement | null>) {
    const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const el = anchorRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const flipUp = spaceBelow < 380 && rect.top > spaceBelow;
            setStyle({
                position: 'fixed',
                top: flipUp ? undefined : rect.bottom + 8,
                bottom: flipUp ? window.innerHeight - rect.top + 8 : undefined,
                // RTL: align the popover's right edge with the field's right edge.
                right: Math.max(8, window.innerWidth - rect.right),
                zIndex: 60,
            });
        };
        update();
        // `true` captures scrolls inside any container the field is nested in.
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [open, anchorRef]);

    return style;
}

/** Closes the popover on Escape or a pointer press outside every given node. */
export function useDismissOnOutside(
    open: boolean,
    close: () => void,
    nodes: Array<React.RefObject<HTMLElement | null>>
) {
    const nodesRef = useRef(nodes);
    useEffect(() => { nodesRef.current = nodes; });

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (nodesRef.current.some(ref => ref.current?.contains(target))) return;
            close();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, close]);
}
