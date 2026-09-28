// Ticks the internal ridden-roads worker endpoint on a loop. Run only on the
// isolated `worker` Fly machine (see fly.toml [processes].worker) -- never
// receives public traffic itself, just repeatedly asks the Next.js server
// running alongside it (same machine, loopback only) to process one queued
// recompute job to completion. Zero non-dotenv dependencies (uses Node's
// built-in fetch) so it needs no build step and can run directly in the
// production image. Locally (see start-worker.sh), .env.local isn't loaded
// automatically the way Next.js loads it for `npm run dev` -- load it here
// so INTERNAL_WORKER_SECRET matches between the two processes.
try { require('dotenv').config({ path: '.env.local' }); } catch { /* fine in prod -- env vars come from Fly secrets */ }

const PORT = process.env.PORT || 3888;
const URL = `http://localhost:${PORT}/api/internal/ridden-roads-tick`;
const SECRET = process.env.INTERNAL_WORKER_SECRET;
const POLL_INTERVAL_MS = 5000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tick() {
    try {
        await fetch(URL, { method: 'POST', headers: { 'x-internal-secret': SECRET || '' } });
    } catch (e) {
        console.warn(`[worker-tick-loop] tick failed: ${e.message}`);
    }
}

async function main() {
    if (!SECRET) console.warn('[worker-tick-loop] INTERNAL_WORKER_SECRET is not set -- every tick will be rejected');
    // eslint-disable-next-line no-constant-condition
    while (true) {
        await tick();
        await delay(POLL_INTERVAL_MS);
    }
}

main();
