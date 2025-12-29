export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const version = process.env.APP_VERSION || process.env.npm_package_version || 'unknown';
        console.log(`\n\x1b[32m ✓\x1b[0m StreetSweep version: \x1b[36m${version}\x1b[0m\n`);
    }
}
