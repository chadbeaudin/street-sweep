// Starts loading code-split chunks once the page has settled, so they don't
// compete with first paint but are already in place when someone opens them (#182).
export function preloadAfter(delayMs: number, loaders: (() => Promise<unknown>)[], onLoaded?: () => void): () => void {
    let cancelled = false;
    const timer = setTimeout(() => {
        // A failed preload is harmless: the component loads again when it renders.
        Promise.all(loaders.map(load => load())).then(() => { if (!cancelled) onLoaded?.(); }, () => {});
    }, delayMs);
    return () => { cancelled = true; clearTimeout(timer); };
}
