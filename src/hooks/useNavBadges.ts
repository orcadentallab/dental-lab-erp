/**
 * One fetch for every navigation badge.
 *
 * The sidebar used to run its own unregistered-cases query on mount. The
 * registry now attaches badges to several destinations, and one query per
 * badge per navigation would be a query storm on a screen the user is not
 * even looking at. Counts are fetched once per session, shared through a
 * module-level cache, and refreshed on demand.
 */
import { useEffect, useState } from 'react';
import { db } from '../services/db';
import { isAccountingRegistrationCandidate } from '../constants/accountingRegistration';
import type { BadgeKey } from '../lib/navigation';
import type { Capability } from '../lib/userRoles';

export type BadgeCounts = Partial<Record<BadgeKey, number>>;

let cache: BadgeCounts | null = null;
let inFlight: Promise<BadgeCounts> | null = null;
const listeners = new Set<(counts: BadgeCounts) => void>();
/** Kept so a refresh can re-run the same query without a mounted component. */
let lastArgs: { caps: Set<Capability>; userId: string } | null = null;

async function fetchCounts(caps: Set<Capability>, userId: string): Promise<BadgeCounts> {
    const counts: BadgeCounts = {};

    if (caps.has('view_finance')) {
        try {
            const orders = await db.getOrdersForAccountingRegistration();
            counts.unregisteredCases = orders.filter(order =>
                isAccountingRegistrationCandidate(order, 'pending')
            ).length;
        } catch (error) {
            // A badge is never worth breaking navigation over.
            console.error('Failed to count unregistered cases', error);
        }
    }

    if (caps.has('view_production') && userId) {
        try {
            const { getMyTasks } = await import('../services/supabase/production');
            const tasks = await getMyTasks(userId);
            counts.myOpenTasks = tasks.length;
        } catch (error) {
            console.error('Failed to count open production tasks', error);
        }
    }

    return counts;
}

function loadCounts(caps: Set<Capability>, userId: string): Promise<BadgeCounts> {
    lastArgs = { caps, userId };
    if (cache) return Promise.resolve(cache);
    if (inFlight) return inFlight;
    inFlight = fetchCounts(caps, userId).then(counts => {
        cache = counts;
        inFlight = null;
        listeners.forEach(listener => listener(counts));
        return counts;
    });
    return inFlight;
}

/**
 * Re-count now and push the new numbers to every mounted badge.
 *
 * Call this after anything that changes a count. Dropping the cache alone is
 * not enough: nothing re-reads it until a full page load, so an accountant
 * who registered a case would keep staring at the old number. A badge that
 * lies is worse than no badge -- people stop trusting the whole menu.
 */
export function refreshNavBadges(): void {
    cache = null;
    inFlight = null;
    if (!lastArgs) return;
    void loadCounts(lastArgs.caps, lastArgs.userId);
}

export function useNavBadges(caps: Set<Capability>, userId: string | undefined): BadgeCounts {
    const [counts, setCounts] = useState<BadgeCounts>(cache || {});

    // The capability set is rebuilt on every render, so the effect keys off
    // a stable string instead of the Set identity.
    const capKey = Array.from(caps).sort().join(',');

    useEffect(() => {
        if (!userId) return;
        let alive = true;
        const listener = (next: BadgeCounts) => { if (alive) setCounts(next); };
        listeners.add(listener);
        void loadCounts(caps, userId).then(listener);
        return () => { alive = false; listeners.delete(listener); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [capKey, userId]);

    return counts;
}
