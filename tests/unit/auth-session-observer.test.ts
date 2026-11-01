import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { observeAuthSession } from '../../src/lib/authSessionObserver';

describe('auth session observer', () => {
    afterEach(() => vi.useRealTimers());

    it('subscribes only after initialization and runs profile queries outside the auth callback', async () => {
        vi.useFakeTimers();
        let callback: (event: string, session: Session | null) => void = () => {};
        let insideAuthCallback = false;
        let finishInitialization!: (value: { data: { session: null }; error: null }) => void;
        const auth = {
            getSession: () => new Promise<{ data: { session: null }; error: null }>(resolve => { finishInitialization = resolve; }),
            onAuthStateChange: vi.fn((cb: typeof callback) => {
                callback = cb;
                return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
        };
        const onSession = vi.fn(async () => { expect(insideAuthCallback).toBe(false); });
        const stop = observeAuthSession(auth, onSession, vi.fn(), vi.fn());
        expect(auth.onAuthStateChange).not.toHaveBeenCalled();
        finishInitialization({ data: { session: null }, error: null });
        await Promise.resolve();
        expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1);
        insideAuthCallback = true;
        callback('SIGNED_IN', null);
        expect(onSession).not.toHaveBeenCalled();
        insideAuthCallback = false;
        await vi.runAllTimersAsync();
        expect(onSession).toHaveBeenCalledTimes(1);
        stop();
    });

    it('handles rejected initialization and releases the loading state', async () => {
        const error = new Error('AbortError: signal is aborted without reason');
        const onError = vi.fn();
        const onSettled = vi.fn();
        const auth = {
            getSession: vi.fn().mockRejectedValue(error),
            onAuthStateChange: vi.fn(),
        };
        observeAuthSession(auth, vi.fn(), onError, onSettled);
        await Promise.resolve();
        await Promise.resolve();
        expect(onError).toHaveBeenCalledWith(error);
        expect(onSettled).toHaveBeenCalledTimes(1);
        expect(auth.onAuthStateChange).not.toHaveBeenCalled();
    });

    it('unsubscribes and cancels queued work on unmount', async () => {
        vi.useFakeTimers();
        const unsubscribe = vi.fn();
        const onSession = vi.fn();
        const stop = observeAuthSession({
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
        }, onSession, vi.fn(), vi.fn());
        await Promise.resolve();
        stop();
        await vi.runAllTimersAsync();
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(onSession).not.toHaveBeenCalled();
    });

    it('contains profile request failures and ends loading', async () => {
        vi.useFakeTimers();
        const error = new Error('profile unavailable');
        const onError = vi.fn();
        const onSettled = vi.fn();
        const stop = observeAuthSession({
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
        }, vi.fn().mockRejectedValue(error), onError, onSettled);
        await vi.runAllTimersAsync();
        expect(onError).toHaveBeenCalledWith(error);
        expect(onSettled).toHaveBeenCalledOnce();
        stop();
    });

    it('ignores initialization that completes after unmount', async () => {
        let finish!: (value: { data: { session: null }; error: null }) => void;
        const subscribe = vi.fn();
        const stop = observeAuthSession({
            getSession: () => new Promise(resolve => { finish = resolve; }),
            onAuthStateChange: subscribe,
        }, vi.fn(), vi.fn(), vi.fn());
        stop();
        finish({ data: { session: null }, error: null });
        await Promise.resolve();
        expect(subscribe).not.toHaveBeenCalled();
    });
});
