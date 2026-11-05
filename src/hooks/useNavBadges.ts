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
import { LEGACY_EXTERNAL_REGISTRATION_ENABLED } from '../constants/externalRegistration';
import type { BadgeKey } from '../lib/navigation';
import type { Capability } from '../lib/userRoles';
import {getPendingDesignQcCount} from '../services/supabase/designQc';
import {DESIGN_QC_CHANGED} from '../lib/designQcQueue';

export type BadgeCounts = Partial<Record<BadgeKey, number>>;

let cache: BadgeCounts | null = null;
let inFlight: Promise<BadgeCounts> | null = null;
let cacheScope='';
let generation=0;
let refreshTimer:number|null=null;
const scopeKey=(caps:Set<Capability>,userId:string)=>`${userId}:${Array.from(caps).sort().join(',')}`;
const listeners = new Set<(counts: BadgeCounts) => void>();
/** Kept so a refresh can re-run the same query without a mounted component. */
let lastArgs: { caps: Set<Capability>; userId: string } | null = null;

async function fetchCounts(caps: Set<Capability>, userId: string): Promise<BadgeCounts> {
    const counts: BadgeCounts = {};
    if(caps.has('view_design_qc')){
        try{counts.pendingDesignQc=await getPendingDesignQcCount();}
        catch(error){console.error('Failed to count waiting Design QC',error);}
    }

    if (LEGACY_EXTERNAL_REGISTRATION_ENABLED && caps.has('view_finance')) {
        try {
            // Optimized: replaces heavy getOrdersForAccountingRegistration() full table download.
            // The count is computed via getUnregisteredCasesCount() which evaluates
            // isAccountingRegistrationCandidate(order, 'pending') on candidate rows.
            counts.unregisteredCases = await db.getUnregisteredCasesCount();
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
    const scope=scopeKey(caps,userId);
    if(scope!==cacheScope){cacheScope=scope;cache=null;inFlight=null;generation++;}
    if (cache) return Promise.resolve(cache);
    if (inFlight) return inFlight;
    const requestGeneration=generation;
    inFlight = fetchCounts(caps, userId).then(counts => {
        if(requestGeneration===generation){cache = counts;inFlight = null;listeners.forEach(listener => listener(counts));}
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
    generation++;
    if (!lastArgs) return;
    void loadCounts(lastArgs.caps, lastArgs.userId);
}

function refreshWhenVisible(){if(document.visibilityState==='visible')refreshNavBadges();}
function startRefresh(){
    window.addEventListener('focus',refreshWhenVisible);
    window.addEventListener(DESIGN_QC_CHANGED,refreshNavBadges);
    document.addEventListener('visibilitychange',refreshWhenVisible);
    refreshTimer=window.setInterval(refreshWhenVisible,30000);
}
function stopRefresh(){
    window.removeEventListener('focus',refreshWhenVisible);
    window.removeEventListener(DESIGN_QC_CHANGED,refreshNavBadges);
    document.removeEventListener('visibilitychange',refreshWhenVisible);
    if(refreshTimer!==null)window.clearInterval(refreshTimer);
    refreshTimer=null;
}

export function useNavBadges(caps: Set<Capability>, userId: string | undefined): BadgeCounts {
    const scope=scopeKey(caps,userId??'');
    const [snapshot, setSnapshot] = useState(()=>({scope,counts:cacheScope===scope?cache??{}:{}}));

    // The capability set is rebuilt on every render, so the effect keys off
    // a stable string instead of the Set identity.
    const capKey = Array.from(caps).sort().join(',');

    useEffect(() => {
        if (!userId) return;
        let alive = true;
        const listener = (next: BadgeCounts) => { if (alive) setSnapshot({scope,counts:next}); };
        listeners.add(listener);
        if(listeners.size===1)startRefresh();
        void loadCounts(caps, userId).then(listener);
        return () => { alive = false; listeners.delete(listener);if(listeners.size===0)stopRefresh(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [capKey, userId]);

    return snapshot.scope===scope?snapshot.counts:{};
}
