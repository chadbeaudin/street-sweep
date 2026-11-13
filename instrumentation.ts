const HEAP_SAMPLE_MS = 60 * 1000;

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const version = process.env.APP_VERSION || process.env.npm_package_version || 'unknown';
        console.log(`\n\x1b[32m ✓\x1b[0m StreetSweep version: \x1b[36m${version}\x1b[0m\n`);

        // Warns ahead of an out-of-memory crash, which Fly only reports afterwards (#117).
        const { getHeapStatistics } = await import('v8');
        const { processLabel, recordHeapSample } = await import('./lib/metrics');
        const label = processLabel();
        setInterval(() => {
            const { used_heap_size, heap_size_limit } = getHeapStatistics();
            recordHeapSample(label, (used_heap_size / heap_size_limit) * 100);
        }, HEAP_SAMPLE_MS).unref();
    }
}
