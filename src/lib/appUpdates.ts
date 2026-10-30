/** Observe stale deployment chunks without discarding unsaved form edits. */
export function watchForAppUpdate(target: EventTarget, onUpdate: () => void): () => void {
    const listener = () => onUpdate();
    target.addEventListener('vite:preloadError', listener);
    return () => target.removeEventListener('vite:preloadError', listener);
}
