import { describe, expect, it, vi } from 'vitest';
import { watchForAppUpdate } from '../../src/lib/appUpdates';

describe('deployment update recovery', () => {
    it('notifies on a missing chunk without swallowing the form initialization error', () => {
        const target = new EventTarget();
        const notify = vi.fn();
        const unsubscribe = watchForAppUpdate(target, notify);
        const failure = new Event('vite:preloadError', { cancelable: true });
        target.dispatchEvent(failure);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(failure.defaultPrevented).toBe(false);
        unsubscribe();
    });

    it('ignores unrelated application errors and cleans up on unmount', () => {
        const target = new EventTarget();
        const notify = vi.fn();
        const unsubscribe = watchForAppUpdate(target, notify);
        target.dispatchEvent(new Event('error'));
        unsubscribe();
        target.dispatchEvent(new Event('vite:preloadError'));
        expect(notify).not.toHaveBeenCalled();
    });
});
