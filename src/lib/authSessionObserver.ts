import type { Session } from '@supabase/supabase-js';

interface AuthSessionSource {
    getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
    onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        data: { subscription: { unsubscribe: () => void } };
    };
}

/** Keep profile requests outside Supabase's exclusive auth lock. */
export function observeAuthSession(
    auth: AuthSessionSource,
    onSession: (session: Session | null) => Promise<void>,
    onError: (error: unknown) => void,
    onSettled: () => void,
): () => void {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { unsubscribe: () => void } | undefined;
    const schedule = (session: Session | null) => {
        if (!active) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (!active) return;
            void onSession(session).catch(error => {
                if (active) onError(error);
            }).finally(() => {
                if (active) onSettled();
            });
        }, 0);
    };

    void (async () => {
        try {
            // Registering a listener during initialization can also re-enter
            // the refresh-token lock on older auth-js clients.
            const { data, error } = await auth.getSession();
            if (!active) return;
            if (error) throw error;
            subscription = auth.onAuthStateChange((_event, session) => { schedule(session); }).data.subscription;
            schedule(data.session);
        } catch (error) {
            if (active) {
                onError(error);
                onSettled();
            }
        }
    })();
    return () => {
        active = false;
        clearTimeout(timer);
        subscription?.unsubscribe();
    };
}
