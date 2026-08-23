/**
 * Pinned destinations -- "شغلي".
 *
 * Stored in localStorage rather than the database on purpose: this ships
 * without a migration, and a pin list is a per-device convenience, not a
 * business record. Moving it to a user_preferences column later only
 * changes `read` and `write` at the top of this file.
 *
 * Two rules keep it honest:
 *   - Pins are validated against capabilities on every read, so losing
 *     access removes the chip instead of leaving a dead link.
 *   - Each role is seeded with the destinations it opens daily, because a
 *     favourites bar that starts empty never gets used.
 */
import { useCallback, useEffect, useState } from 'react';
import {
    DEFAULT_FAVOURITES, MAX_FAVOURITES, findDestination,
    activeWorkspace, activeSidebarEntry, REPORT_CATEGORIES,
    type Destination,
} from '../lib/navigation';
import type { Capability } from '../lib/userRoles';

const storageKey = (userId: string) => `nav:favourites:${userId}`;

function read(userId: string, role: string): string[] {
    try {
        const raw = localStorage.getItem(storageKey(userId));
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
        }
    } catch {
        // Corrupt storage falls back to the role defaults rather than throwing.
    }
    return DEFAULT_FAVOURITES[role] || [];
}

function write(userId: string, ids: string[]): void {
    try {
        localStorage.setItem(storageKey(userId), JSON.stringify(ids));
    } catch {
        // Private mode and full quotas both land here; pins are not critical.
    }
}

export interface FavouritesApi {
    /** Resolved, capability-filtered destinations, in pin order. */
    favourites: Destination[];
    isPinned: (id: string) => boolean;
    toggle: (id: string) => void;
    canPinMore: boolean;
}

export function useFavourites(
    userId: string | undefined,
    role: string | undefined,
    caps: Set<Capability>,
): FavouritesApi {
    // Derived from the identity during render rather than in an effect:
    // reading storage in an effect would render one frame with no pins and
    // then flash them in.
    const identity = `${userId || ''}|${role || ''}`;
    const [state, setState] = useState(() => ({
        identity,
        ids: userId ? read(userId, role || '') : [],
    }));
    if (state.identity !== identity) {
        setState({ identity, ids: userId ? read(userId, role || '') : [] });
    }
    const ids = state.ids;
    const setIds = (updater: (previous: string[]) => string[]) =>
        setState(previous => ({ ...previous, ids: updater(previous.ids) }));

    const toggle = useCallback((id: string) => {
        if (!userId) return;
        setIds(previous => {
            const next = previous.includes(id)
                ? previous.filter(item => item !== id)
                // Pinning a fifth drops the oldest rather than refusing.
                : [...previous, id].slice(-MAX_FAVOURITES);
            write(userId, next);
            return next;
        });
    }, [userId]);

    const favourites = ids
        .map(id => findDestination(id))
        .filter((destination): destination is Destination =>
            destination !== null && caps.has(destination.capability))
        .slice(0, MAX_FAVOURITES);

    return {
        favourites,
        isPinned: (id: string) => ids.includes(id),
        toggle,
        canPinMore: ids.length < MAX_FAVOURITES,
    };
}


/* ------------------------------------------------------------------ *
 * Recents
 *
 * Favourites need someone to decide, and most people never do. Recents
 * cost the user nothing and cover the same need for the first week --
 * which is exactly when the new layout feels least familiar.
 * ------------------------------------------------------------------ */

const MAX_RECENTS = 5;
const recentsKey = (userId: string) => `nav:recents:${userId}`;

export function useRecents(
    userId: string | undefined,
    pathname: string,
    caps: Set<Capability>,
    pinnedIds: string[],
): Destination[] {
    // Recorded during render, persisted in an effect. Doing both in an effect
    // costs an extra render on every navigation; doing both in render would
    // write to storage from a render pass.
    const [state, setState] = useState(() => ({
        owner: userId || '',
        path: '',
        ids: userId ? readList(recentsKey(userId)) : [],
    }));

    if (state.owner !== (userId || '')) {
        setState({ owner: userId || '', path: '', ids: userId ? readList(recentsKey(userId)) : [] });
    }

    const visited = userId ? currentDestinationId(pathname) : null;
    if (visited && state.path !== pathname) {
        setState(previous => (previous.path === pathname ? previous : {
            ...previous,
            path: pathname,
            ids: previous.ids[0] === visited
                ? previous.ids
                : [visited, ...previous.ids.filter(id => id !== visited)].slice(0, MAX_RECENTS),
        }));
    }

    const ids = state.ids;

    useEffect(() => {
        if (userId) writeList(recentsKey(userId), ids);
    }, [userId, ids]);

    return ids
        .map(id => findDestination(id))
        .filter((destination): destination is Destination =>
            destination !== null
            && caps.has(destination.capability)
            // A pinned destination is already one click away; showing it
            // twice just costs a row.
            && !pinnedIds.includes(destination.id))
        .slice(0, MAX_RECENTS);
}

/** The most specific thing the current URL identifies. */
function currentDestinationId(pathname: string): string | null {
    const workspace = activeWorkspace(pathname);
    if (workspace) return workspace.tab.id;

    const report = REPORT_CATEGORIES
        .flatMap(category => category.reports)
        .find(item => [item.path, ...(item.matches || [])].includes(pathname));
    if (report) return report.id;

    return activeSidebarEntry(pathname)?.id ?? null;
}

function readList(key: string): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
        // Corrupt storage is not worth an error boundary.
    }
    return [];
}

function writeList(key: string, ids: string[]): void {
    try {
        localStorage.setItem(key, JSON.stringify(ids));
    } catch {
        // Private mode and full quotas both land here.
    }
}
